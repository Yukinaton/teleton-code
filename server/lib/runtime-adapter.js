import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CodeToolRegistry } from "./code-tool-registry.js";
import { buildCodingTools } from "./coding-tools.js";
import { buildCodeSoul } from "./prompt-engine.js";
import { buildCodeAgentProfile } from "./code-agent-profile.js";
import { runClarificationFlow as runClarificationFlowService } from "../application/agent/clarification-flow.js";
import { runStructuredBuildFlowV2 as runStructuredBuildFlowV2Service } from "../application/agent/structured-build-flow.js";
import { processSessionPrompt as processSessionPromptService } from "../application/agent/session-prompt-service.js";

function timestamp() {
    return new Date().toTimeString().slice(0, 8);
}

function logLine(level, message) {
    const stream = level === "ERROR" ? process.stderr : process.stdout;
    stream.write(`[${timestamp()}] ${level}: [TeletonCode] ${message}\n`);
}

const logInfo = (message) => logLine("INFO", message);
const logWarn = (message) => logLine("WARN", message);

function detectTeletonWebSearchConfig(configPath) {
    try {
        const source = readFileSync(configPath, "utf-8");
        const match = source.match(/^\s*tavily_api_key\s*:\s*(.+?)\s*$/m);
        if (!match) {
            return false;
        }

        const value = String(match[1] || "")
            .replace(/\s+#.*$/, "")
            .trim()
            .replace(/^['"]|['"]$/g, "");
        return Boolean(value);
    } catch {
        return false;
    }
}

async function importTeletonModuleCandidates(candidates, validator) {
    for (const candidate of candidates) {
        const module = await import(pathToFileURL(candidate).href);
        if (validator(module)) {
            return {
                path: candidate,
                module
            };
        }
    }

    return null;
}

async function resolveTeletonModules(pkgRoot) {
    const distRoot = join(pkgRoot, "dist");
    if (!existsSync(distRoot)) {
        throw new Error(`Teleton dist directory was not found: ${distRoot}`);
    }

    const distFiles = readdirSync(distRoot)
        .filter((name) => name.endsWith(".js"))
        .sort();

    const memoryCandidates = distFiles
        .filter((name) => /^memory-.*\.js$/i.test(name))
        .map((name) => join(distRoot, name));
    const memoryMatch = await importTeletonModuleCandidates(
        memoryCandidates,
        (module) =>
            typeof module.getDatabase === "function" &&
            typeof module.initializeMemory === "function"
    );

    if (!memoryMatch) {
        throw new Error(`Teleton memory module was not found in ${distRoot}`);
    }

    const runtimeCandidates = distFiles
        .filter(
            (name) =>
                name !== "index.js" &&
                !/^memory-.*\.js$/i.test(name) &&
                !/^client-.*\.js$/i.test(name)
        )
        .map((name) => join(distRoot, name));
    const runtimeMatch = await importTeletonModuleCandidates(
        runtimeCandidates,
        (module) =>
            typeof module.loadConfig === "function" &&
            typeof module.AgentRuntime === "function"
    );

    if (!runtimeMatch) {
        throw new Error(`Teleton runtime module was not found in ${distRoot}`);
    }

    const clientCandidates = distFiles
        .filter((name) => /^client-.*\.js$/i.test(name))
        .map((name) => join(distRoot, name));
    const clientMatch = await importTeletonModuleCandidates(
        clientCandidates,
        (module) => typeof module.chatWithContext === "function"
    );

    if (!clientMatch) {
        throw new Error(`Teleton client module with chatWithContext was not found in ${distRoot}`);
    }

    return {
        runtimeModules: runtimeMatch.module,
        memoryModules: memoryMatch.module,
        clientModules: clientMatch.module
    };
}

export class RuntimeAdapter {
    constructor(serviceConfig, stateStore) {
        this.serviceConfig = serviceConfig;
        this.stateStore = stateStore;
        this.modules = null;
        this.agent = null;
        this.db = null;
        this.memory = null;
        this.teletonConfig = null;
        this.activeTaskCallbacks = new Map();
        this.requestTimestamps = [];
        this.seenSessionIds = new Set();
        this.runtimeConfigSignature = null;
        this.toolRegistry = this.createToolRegistry();
    }

    createToolRegistry() {
        return new CodeToolRegistry(
            buildCodingTools({
                resolveWorkspace: (chatId) => this.resolveWorkspaceForChatId(chatId),
                shellTimeoutMs: this.serviceConfig.runtime.maxShellTimeoutMs,
                shellOutputLimit: this.serviceConfig.runtime.maxShellOutputChars
            }),
            {
                onToolStart: (event) => this.notifyToolEvent("tool_started", event),
                onToolFinish: (event) => this.notifyToolEvent("tool_finished", event)
            }
        );
    }

    sessionChatId(sessionId) {
        return `teleton-code:${sessionId}`;
    }

    resolveWorkspaceForChatId(chatId) {
        const sessionId = chatId.replace(/^teleton-code:/, "");
        const session = this.stateStore.getSession(sessionId);
        return session ? this.stateStore.getWorkspace(session.workspaceId) : null;
    }

    registerTaskCallback(chatId, callback) {
        this.activeTaskCallbacks.set(chatId, callback);
    }

    clearTaskCallback(chatId) {
        this.activeTaskCallbacks.delete(chatId);
    }

    async notifyToolEvent(type, event) {
        if (type === "tool_finished") {
            logInfo(`Tool finish: ${event.name} (${event.result?.success ? "ok" : "failed"})`);
        }

        const callback = this.activeTaskCallbacks.get(event.chatId);
        if (callback) {
            await callback({ type, ...event });
        }
    }

    ensureQuotaAvailable() {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter((timestampValue) => now - timestampValue < 60_000);
        if (this.requestTimestamps.length >= 5) {
            throw new Error("Quota reached: max 5 calls per minute");
        }
        this.requestTimestamps.push(now);
    }

    readTeletonConfigSignature() {
        const configPath = this.serviceConfig.teleton.configPath;
        const stats = statSync(configPath);
        return `${stats.mtimeMs}:${stats.size}:${readFileSync(configPath, "utf-8")}`;
    }

    async ensureLoaded() {
        const signature = this.readTeletonConfigSignature();
        if (this.agent && this.runtimeConfigSignature === signature) {
            return;
        }

        logInfo("Initializing agent runtime...");
        process.env.TELETON_HOME = this.serviceConfig.runtime.teletonRoot;

        const pkgRoot = this.serviceConfig.teleton.packagePath;
        const { runtimeModules, memoryModules, clientModules } = await resolveTeletonModules(pkgRoot);

        this.modules = { ...runtimeModules, ...memoryModules, ...clientModules };
        const config = runtimeModules.loadConfig(this.serviceConfig.teleton.configPath);
        const embeddingProvider = config.embedding?.provider || "none";
        const vectorEnabled = embeddingProvider !== "none";
        const teletonMemoryPath = join(this.serviceConfig.runtime.teletonRoot, "memory.db");

        this.memory = memoryModules.initializeMemory({
            database: {
                path: teletonMemoryPath,
                enableVectorSearch: vectorEnabled,
                vectorDimensions: 384
            },
            embeddings: {
                provider: embeddingProvider,
                model: config.embedding?.model,
                apiKey: embeddingProvider === "anthropic" ? config.agent?.api_key : undefined
            },
            workspaceDir: this.serviceConfig.runtime.teletonRoot
        });

        this.db = memoryModules.getDatabase().getDb();
        this.teletonConfig = config;
        const allowWebSearch = Boolean(config?.tavily_api_key);
        this.toolRegistry.setPolicy({
            allowWebSearch
        });
        const baseCodeAgentProfile = buildCodeAgentProfile({
            allowWebSearch
        });

        this.agent = new runtimeModules.AgentRuntime(
            config,
            buildCodeSoul(
                this.serviceConfig,
                process.cwd(),
                baseCodeAgentProfile.contextPolicy
            ),
            this.toolRegistry
        );

        if (this.memory?.embedder && typeof this.agent.initializeContextBuilder === "function") {
            this.agent.initializeContextBuilder(
                this.memory.embedder,
                typeof memoryModules.getDatabase().isVectorSearchReady === "function"
                    ? memoryModules.getDatabase().isVectorSearchReady()
                    : false
            );
        }

        this.runtimeConfigSignature = signature;
    }

    async callStructuredChat(systemPrompt, userPrompt, options = {}) {
        if (typeof this.modules?.chatWithContext !== "function") {
            throw new Error("Teleton chat client is not available for structured execution");
        }

        const context = {
            systemPrompt,
            messages: [
                {
                    role: "user",
                    content: String(userPrompt || ""),
                    timestamp: Date.now()
                }
            ]
        };

        const response = await this.modules.chatWithContext(this.teletonConfig.agent, {
            systemPrompt,
            context,
            temperature: options.temperature ?? 0.2,
            maxTokens: options.maxTokens ?? 4000,
            persistTranscript: false
        });

        return String(response?.text || "");
    }

    async runStructuredBuildFlowV2({
        sessionId,
        prompt,
        settings,
        language,
        languageName,
        workspace,
        codeAgentProfile,
        onTaskEvent
    }) {
        return runStructuredBuildFlowV2Service({
            serviceConfig: this.serviceConfig,
            toolRegistry: this.toolRegistry,
            callStructuredChat: this.callStructuredChat.bind(this),
            sessionId,
            prompt,
            settings,
            language,
            languageName,
            workspace,
            codeAgentProfile,
            onTaskEvent,
            sessionChatId: this.sessionChatId.bind(this),
            logger: {
                warn: logWarn
            }
        });
    }

    async runClarificationFlow({
        prompt,
        language,
        languageName,
        workspace
    }) {
        return runClarificationFlowService({
            callStructuredChat: this.callStructuredChat.bind(this),
            prompt,
            language,
            languageName,
            workspace
        });
    }

    async processSessionPrompt(sessionId, prompt, onTaskEvent, settings = {}) {
        return processSessionPromptService({
            adapter: this,
            sessionId,
            prompt,
            onTaskEvent,
            settings,
            logger: {
                info: logInfo,
                warn: logWarn
            }
        });
    }

    getRuntimeStatus() {
        const webSearchEnabled = this.teletonConfig
            ? Boolean(this.teletonConfig?.tavily_api_key)
            : detectTeletonWebSearchConfig(this.serviceConfig.teleton.configPath);

        return {
            loaded: !!this.agent,
            provider: this.teletonConfig?.agent?.provider || null,
            model: this.teletonConfig?.agent?.model || null,
            activeTasks: this.activeTaskCallbacks.size,
            packagePath: this.serviceConfig.teleton.packagePath,
            teletonRoot: this.serviceConfig.runtime.teletonRoot,
            memoryPath: join(this.serviceConfig.runtime.teletonRoot, "memory.db"),
            profile: "teleton-code",
            teletonWorkspaceRoot: this.serviceConfig.runtime.teletonWorkspaceRoot,
            ideCodeAgentRoot: this.serviceConfig.runtime.ideCodeAgentRoot,
            previewPort: this.serviceConfig.server.previewPort,
            enabledModules: buildCodeAgentProfile({
                allowWebSearch: webSearchEnabled
            }).allowedModules,
            webSearch: {
                provider: "tavily",
                enabled: webSearchEnabled,
                configured: webSearchEnabled
            }
        };
    }
}
