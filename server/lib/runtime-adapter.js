import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CodeToolRegistry } from "./code-tool-registry.js";
import { buildCodingTools } from "./coding-tools.js";
import { buildCodeSoul } from "./prompt-engine.js";
import { buildCodeAgentProfile } from "./code-agent-profile.js";
import {
    buildCodeAgentRuntimeConfig,
    clampStructuredChatOptions,
    deriveRetryOutputTokenLimit
} from "./code-agent-runtime-policy.js";
import { processCodeTurn, resumeCodeTurn } from "../application/code-agent/index.js";

function timestamp() {
    return new Date().toTimeString().slice(0, 8);
}

function logLine(level, message) {
    const stream = level === "ERROR" ? process.stderr : process.stdout;
    stream.write(`[${timestamp()}] ${level}: [TeletonCode] ${message}\n`);
}

const logInfo = (message) => logLine("INFO", message);
const logWarn = (message) => logLine("WARN", message);
const logError = (message) => logLine("ERROR", message);

function extractStructuredChatText(response) {
    if (typeof response === "string") {
        return response;
    }

    const directCandidates = [
        response?.text,
        response?.content,
        response?.message,
        response?.outputText,
        response?.output
    ];

    for (const candidate of directCandidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate;
        }
    }

    const listCandidates = [response?.content, response?.parts, response?.messages, response?.output];
    for (const list of listCandidates) {
        if (!Array.isArray(list)) {
            continue;
        }

        const pieces = list
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (typeof item?.text === "string") {
                    return item.text;
                }

                if (typeof item?.content === "string") {
                    return item.content;
                }

                if (typeof item?.value === "string") {
                    return item.value;
                }

                return "";
            })
            .filter(Boolean);

        if (pieces.length > 0) {
            return pieces.join("\n").trim();
        }
    }

    return "";
}

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
        try {
            const module = await import(pathToFileURL(candidate).href);
            if (validator(module)) {
                return {
                    path: candidate,
                    module
                };
            }
        } catch (_error) {
            // Ignore unrelated chunks while scanning Teleton's dist output.
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

    const configCandidates = distFiles
        .filter((name) => !/^memory-.*\.js$/i.test(name) && !/^client-.*\.js$/i.test(name))
        .map((name) => join(distRoot, name));
    const configMatch = await importTeletonModuleCandidates(
        configCandidates,
        (module) => typeof module.loadConfig === "function"
    );

    if (!configMatch) {
        throw new Error(`Teleton config module was not found in ${distRoot}`);
    }

    const entryCandidates = [
        join(distRoot, "index.js"),
        ...distFiles
            .filter((name) => name !== "index.js" && !/^memory-.*\.js$/i.test(name))
            .map((name) => join(distRoot, name))
    ];
    const appEntryMatch = await importTeletonModuleCandidates(
        entryCandidates,
        (module) => typeof module.TeletonApp === "function"
    );

    if (!appEntryMatch) {
        throw new Error(`Teleton app entrypoint was not found in ${distRoot}`);
    }

    const runtimeCandidates = configCandidates.filter((candidate) => candidate !== configMatch.path);
    const runtimeMatch = await importTeletonModuleCandidates(
        runtimeCandidates,
        (module) => typeof module.AgentRuntime === "function"
    );

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
        appModules: appEntryMatch.module,
        configModules: configMatch.module,
        runtimeModules: runtimeMatch?.module || {},
        memoryModules: memoryMatch.module,
        clientModules: clientMatch.module,
        resolvedPaths: {
            app: appEntryMatch.path,
            config: configMatch.path,
            runtime: runtimeMatch?.path || "(derived from TeletonApp)",
            memory: memoryMatch.path,
            client: clientMatch.path
        }
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
        this.codeAgentRuntimeConfig = null;
        this.codeAgentOutputLimit = null;
        this.activeTaskCallbacks = new Map();
        this.requestTimestamps = [];
        this.seenSessionIds = new Set();
        this.coreConfigSignature = null;
        this.runtimeConfigSignature = null;
        this.coreLoadPromise = null;
        this.fullLoadPromise = null;
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

    applyCodeAgentOutputLimit(limit) {
        if (!limit) {
            return;
        }

        this.codeAgentOutputLimit = limit;

        if (this.codeAgentRuntimeConfig?.agent) {
            this.codeAgentRuntimeConfig.agent.max_tokens = limit;
        }

        if (this.agent?.config?.agent) {
            this.agent.config.agent.max_tokens = limit;
        }
    }

    async processAgentMessageWithBudget(request, { retryLabel = "Agent execution" } = {}) {
        try {
            return await this.agent.processMessage(request);
        } catch (error) {
            const retryLimit = deriveRetryOutputTokenLimit(this.codeAgentOutputLimit, error);
            if (!retryLimit || retryLimit >= this.codeAgentOutputLimit) {
                throw error;
            }

            const previousLimit = this.codeAgentOutputLimit;
            logWarn(
                `${retryLabel} hit provider token budget. Retrying with lower output cap ${retryLimit} (was ${previousLimit}).`
            );
            this.applyCodeAgentOutputLimit(retryLimit);

            try {
                return await this.agent.processMessage(request);
            } finally {
                this.applyCodeAgentOutputLimit(previousLimit);
            }
        }
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

    async ensureCoreLoaded() {
        const signature = this.readTeletonConfigSignature();
        if (this.modules && this.teletonConfig && this.coreConfigSignature === signature) {
            return;
        }

        if (this.coreLoadPromise) {
            return this.coreLoadPromise;
        }

        this.coreLoadPromise = (async () => {
            logInfo("Initializing Teleton core runtime...");
            process.env.TELETON_HOME = this.serviceConfig.runtime.teletonRoot;

            if (this.coreConfigSignature !== signature) {
                this.agent = null;
                this.db = null;
                this.memory = null;
                this.runtimeConfigSignature = null;
            }

            const pkgRoot = this.serviceConfig.teleton.packagePath;
            const { appModules, configModules, runtimeModules, memoryModules, clientModules, resolvedPaths } =
                await resolveTeletonModules(pkgRoot);

            logInfo(`Resolved Teleton modules from ${pkgRoot}`);
            logInfo(`App entry: ${resolvedPaths.app}`);
            logInfo(`Config module: ${resolvedPaths.config}`);
            logInfo(`Runtime module: ${resolvedPaths.runtime}`);
            logInfo(`Memory module: ${resolvedPaths.memory}`);
            logInfo(`Client module: ${resolvedPaths.client}`);

            this.modules = { ...appModules, ...configModules, ...runtimeModules, ...memoryModules, ...clientModules };
            this.teletonConfig = configModules.loadConfig(this.serviceConfig.teleton.configPath);
            const runtimePolicy = buildCodeAgentRuntimeConfig(this.teletonConfig);
            this.codeAgentRuntimeConfig = runtimePolicy.config;
            this.codeAgentOutputLimit = runtimePolicy.outputLimit;
            const allowWebSearch = Boolean(this.teletonConfig?.tavily_api_key);
            this.toolRegistry.setPolicy({
                allowWebSearch
            });
            this.coreConfigSignature = signature;

            logInfo(
                `Teleton core ready (provider: ${this.teletonConfig?.agent?.provider || "unknown"}, model: ${this.teletonConfig?.agent?.model || "unknown"})`
            );
            logInfo(`Code-agent output token cap: ${this.codeAgentOutputLimit}`);
        })()
            .catch((error) => {
                logError(`Teleton core initialization failed: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            })
            .finally(() => {
                this.coreLoadPromise = null;
            });

        return this.coreLoadPromise;
    }

    async ensureLoaded() {
        const signature = this.readTeletonConfigSignature();
        if (this.agent && this.runtimeConfigSignature === signature) {
            return;
        }

        if (this.fullLoadPromise) {
            return this.fullLoadPromise;
        }

        this.fullLoadPromise = (async () => {
            await this.ensureCoreLoaded();

            const runtimeModules = this.modules;
            const memoryModules = this.modules;
            const config = this.codeAgentRuntimeConfig || this.teletonConfig;
            const embeddingProvider = config.embedding?.provider || "none";
            const vectorEnabled = embeddingProvider !== "none";
            const teletonMemoryPath = join(this.serviceConfig.runtime.teletonRoot, "memory.db");

            logInfo(`Initializing code-agent memory (embeddings: ${embeddingProvider})...`);
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
            logInfo("Memory layer ready.");

            const baseCodeAgentProfile = buildCodeAgentProfile({
                allowWebSearch: Boolean(config?.tavily_api_key),
                loopVersion: 3
            });

            let AgentRuntimeCtor = runtimeModules.AgentRuntime;
            if (typeof AgentRuntimeCtor !== "function") {
                if (typeof this.modules.TeletonApp !== "function") {
                    throw new Error("Teleton AgentRuntime export is missing and TeletonApp entrypoint is unavailable");
                }

                logInfo("Deriving AgentRuntime constructor from TeletonApp entrypoint...");
                const tempApp = new this.modules.TeletonApp(this.serviceConfig.teleton.configPath);
                AgentRuntimeCtor = tempApp?.agent?.constructor;

                if (typeof AgentRuntimeCtor !== "function") {
                    throw new Error("Failed to derive AgentRuntime constructor from TeletonApp");
                }

                this.modules.AgentRuntime = AgentRuntimeCtor;
            }

            logInfo("Creating Teleton code-agent runtime...");
            this.agent = new AgentRuntimeCtor(
                config,
                buildCodeSoul(
                    this.serviceConfig,
                    process.cwd(),
                    baseCodeAgentProfile.contextPolicy
                ),
                this.toolRegistry
            );

            if (this.memory?.embedder && typeof this.agent.initializeContextBuilder === "function") {
                logInfo("Initializing context builder...");
                this.agent.initializeContextBuilder(
                    this.memory.embedder,
                    typeof memoryModules.getDatabase().isVectorSearchReady === "function"
                        ? memoryModules.getDatabase().isVectorSearchReady()
                        : false
                );
            }

            this.runtimeConfigSignature = signature;
            logInfo("Agent runtime ready.");
        })()
            .catch((error) => {
                logError(`Agent runtime initialization failed: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            })
            .finally(() => {
                this.fullLoadPromise = null;
            });

        return this.fullLoadPromise;
    }

    async callStructuredChat(systemPrompt, userPrompt, options = {}) {
        await this.ensureCoreLoaded();

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

        const structuredOptions = clampStructuredChatOptions(options, this.teletonConfig);
        const executeStructuredChat = (maxTokens) =>
            this.modules.chatWithContext((this.codeAgentRuntimeConfig || this.teletonConfig).agent, {
                systemPrompt,
                context,
                temperature: structuredOptions.temperature ?? 0.2,
                maxTokens,
                persistTranscript: false
            });

        let response;
        try {
            response = await executeStructuredChat(structuredOptions.maxTokens ?? 4000);
        } catch (error) {
            const retryLimit = deriveRetryOutputTokenLimit(structuredOptions.maxTokens, error);
            if (!retryLimit || retryLimit >= (structuredOptions.maxTokens ?? 4000)) {
                throw error;
            }
            logWarn(
                `Structured chat hit provider token budget. Retrying with lower output cap ${retryLimit} (was ${structuredOptions.maxTokens}).`
            );
            response = await executeStructuredChat(retryLimit);
        }

        return extractStructuredChatText(response);
    }

    async processSessionPrompt(sessionId, prompt, onTaskEvent, settings = {}) {
        return processCodeTurn({
            adapter: this,
            sessionId,
            prompt,
            onTaskEvent,
            settings
        });
    }

    async resumeSessionPrompt(sessionId, prompt, pausedTurn, onTaskEvent, settings = {}) {
        return resumeCodeTurn({
            adapter: this,
            sessionId,
            prompt,
            pausedTurn,
            onTaskEvent,
            settings
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
                allowWebSearch: webSearchEnabled,
                loopVersion: 3
            }).allowedModules,
            webSearch: {
                provider: "tavily",
                enabled: webSearchEnabled,
                configured: webSearchEnabled
            }
        };
    }
}
