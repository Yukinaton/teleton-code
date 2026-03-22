import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { ensureCodeAgentWorkspace } from "./code-agent-workspace.js";

function appDataPath() {
    return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
}

function teletonHomePath() {
    return process.env.TELETON_HOME || join(homedir(), ".teleton");
}

function envPort(name) {
    const raw = process.env[name];
    if (!raw) {
        return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function envValue(name) {
    const raw = process.env[name];
    return raw ? String(raw) : null;
}

function normalizeServerConfig(serverConfig = {}) {
    const port = Number.parseInt(serverConfig.port, 10) || 9999;
    const previewPort = Number.parseInt(serverConfig.previewPort, 10) || port + 1;

    return {
        host: serverConfig.host || "127.0.0.1",
        port,
        previewPort
    };
}

function canonicalTeletonRoot(configPath) {
    return resolve(configPath ? dirname(configPath) : teletonHomePath());
}

function buildIdeDataRoot(teletonRoot) {
    return join(teletonRoot, "ide", "teleton-code");
}

function buildLegacyProjectsRoot(teletonWorkspaceRoot) {
    return join(teletonWorkspaceRoot, "projects");
}

function buildIdeProjectsRoot(ideWorkspaceRoot) {
    return join(ideWorkspaceRoot, "projects");
}

function legacyDataRoots(repoRoot) {
    return [join(repoRoot, ".teleton-code"), join(repoRoot, "server", ".teleton-code")].map(
        (path) => resolve(path)
    );
}

function isLegacyRepoDataRoot(repoRoot, candidate) {
    if (!candidate) {
        return false;
    }

    const resolvedCandidate = resolve(candidate);
    return legacyDataRoots(repoRoot).includes(resolvedCandidate);
}

function copyDirectoryContents(source, target) {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        cpSync(join(source, entry.name), join(target, entry.name), {
            recursive: true,
            force: false,
            errorOnExist: false
        });
    }
}

function migrateLegacyDataRoot(repoRoot, targetDataRoot) {
    const target = resolve(targetDataRoot);
    const sources = legacyDataRoots(repoRoot).filter(
        (candidate) => candidate !== target && existsSync(candidate)
    );

    if (sources.length === 0) {
        return;
    }

    const targetIsEmpty = !existsSync(target) || readdirSync(target).length === 0;
    if (!targetIsEmpty) {
        return;
    }

    const sourceWithState =
        sources.find((candidate) => existsSync(join(candidate, "state.json"))) || sources[0];

    mkdirSync(target, { recursive: true });
    copyDirectoryContents(sourceWithState, target);
}

function migrateLegacyProjectsRoot(legacyProjectsRoot, targetProjectsRoot) {
    const source = resolve(legacyProjectsRoot);
    const target = resolve(targetProjectsRoot);

    if (source === target || !existsSync(source)) {
        return;
    }

    mkdirSync(target, { recursive: true });

    const entries = readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of entries) {
        const sourceProjectPath = join(source, entry.name);
        const targetProjectPath = join(target, entry.name);
        if (existsSync(targetProjectPath)) {
            continue;
        }

        cpSync(sourceProjectPath, targetProjectPath, {
            recursive: true,
            force: false,
            errorOnExist: true
        });
    }
}

function detectNpmGlobalRoot() {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    try {
        const output = execFileSync(npmCommand, ["root", "-g"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();

        return output || null;
    } catch (_error) {
        return null;
    }
}

function globalTeletonPackageCandidates() {
    const candidates = new Set();
    const npmGlobalRoot = detectNpmGlobalRoot();
    const prefix = process.env.npm_config_prefix || process.env.PREFIX || null;

    if (npmGlobalRoot) {
        candidates.add(resolve(join(npmGlobalRoot, "teleton")));
    }

    if (prefix) {
        candidates.add(resolve(join(prefix, "node_modules", "teleton")));
        candidates.add(resolve(join(prefix, "lib", "node_modules", "teleton")));
    }

    candidates.add(resolve(join(appDataPath(), "npm", "node_modules", "teleton")));
    candidates.add(resolve(join("/usr/local/lib/node_modules", "teleton")));
    candidates.add(resolve(join("/usr/lib/node_modules", "teleton")));

    return [...candidates];
}

function detectTeletonPackage(repoRoot) {
    const envPath = process.env.TELETON_CODE_TELETON_PACKAGE;
    const siblingClone = resolve(join(repoRoot, "..", "teleton-agent"));
    const localClone = resolve(join(repoRoot, "teleton-agent"));

    if (envPath && existsSync(envPath)) {
        return envPath;
    }

    if (existsSync(siblingClone)) {
        return siblingClone;
    }

    if (existsSync(localClone)) {
        return localClone;
    }

    for (const globalPath of globalTeletonPackageCandidates()) {
        if (existsSync(globalPath)) {
            return globalPath;
        }
    }

    throw new Error(
        "Teleton package was not found. Install teleton globally or set TELETON_CODE_TELETON_PACKAGE."
    );
}

function isGlobalTeletonPackage(candidate) {
    if (!candidate) {
        return false;
    }

    const resolvedCandidate = resolve(candidate);
    return globalTeletonPackageCandidates().some((globalPath) => resolve(globalPath) === resolvedCandidate);
}

function defaultServiceConfig(repoRoot) {
    const teletonRoot = teletonHomePath();
    const teletonWorkspaceRoot = join(teletonRoot, "workspace");
    const ideWorkspaceRoot = join(teletonWorkspaceRoot, "ide");
    const dataRoot = buildIdeDataRoot(teletonRoot);
    const workspaceBaseRoot = buildIdeProjectsRoot(ideWorkspaceRoot);
    return {
        version: 1,
        server: normalizeServerConfig({
            host: "127.0.0.1",
            port: 9999
        }),
        security: {
            ownerOnly: true,
            loopbackOnly: true,
            authToken: null
        },
        teleton: {
            configPath: join(teletonHomePath(), "config.yaml"),
            packagePath: detectTeletonPackage(repoRoot)
        },
        runtime: {
            teletonRoot,
            teletonWorkspaceRoot,
            ideWorkspaceRoot,
            ideCodeAgentRoot: join(ideWorkspaceRoot, "code-agent"),
            ideProjectsMetaRoot: join(ideWorkspaceRoot, "projects"),
            ideChatsMetaRoot: join(ideWorkspaceRoot, "chats"),
            dataRoot,
            appRoot: repoRoot,
            workspaceBaseRoot,
            maxShellTimeoutMs: 120000,
            maxShellOutputChars: 60000,
            maxTaskRuntimeMs: 90000
        }
    };
}

export function loadServiceConfig(repoRoot) {
    const configPath = join(repoRoot, "teleton-code.config.json");
    let config = defaultServiceConfig(repoRoot);

    if (existsSync(configPath)) {
        const raw = JSON.parse(readFileSync(configPath, "utf-8"));
        config = {
            ...config,
            ...raw,
            server: normalizeServerConfig({ ...config.server, ...(raw.server || {}) }),
            security: { ...config.security, ...(raw.security || {}) },
            teleton: { ...config.teleton, ...(raw.teleton || {}) },
            runtime: { ...config.runtime, ...(raw.runtime || {}) }
        };
    }

    const detectedPackagePath = detectTeletonPackage(repoRoot);
    const packagePath =
        config.teleton?.packagePath &&
        existsSync(config.teleton.packagePath) &&
        !(isGlobalTeletonPackage(config.teleton.packagePath) && resolve(detectedPackagePath) !== resolve(config.teleton.packagePath))
            ? config.teleton.packagePath
            : detectedPackagePath;
    const teletonRoot = config.runtime?.teletonRoot || canonicalTeletonRoot(config.teleton?.configPath);
    const teletonWorkspaceRoot =
        config.runtime?.teletonWorkspaceRoot || join(teletonRoot, "workspace");
    const ideWorkspaceRoot =
        config.runtime?.ideWorkspaceRoot || join(teletonWorkspaceRoot, "ide");
    const dataRoot =
        !config.runtime?.dataRoot || isLegacyRepoDataRoot(repoRoot, config.runtime.dataRoot)
            ? buildIdeDataRoot(teletonRoot)
            : config.runtime.dataRoot;
    const legacyProjectsRoot = buildLegacyProjectsRoot(teletonWorkspaceRoot);
    const defaultProjectsRoot = buildIdeProjectsRoot(ideWorkspaceRoot);
    const workspaceBaseRootCandidate = config.runtime?.workspaceBaseRoot;
    const workspaceBaseRoot =
        !workspaceBaseRootCandidate || resolve(workspaceBaseRootCandidate) === resolve(legacyProjectsRoot)
            ? defaultProjectsRoot
            : workspaceBaseRootCandidate;
    const ideCodeAgentRoot =
        config.runtime?.ideCodeAgentRoot || join(ideWorkspaceRoot, "code-agent");
    const ideProjectsMetaRoot =
        config.runtime?.ideProjectsMetaRoot || join(ideWorkspaceRoot, "projects");
    const ideChatsMetaRoot =
        config.runtime?.ideChatsMetaRoot || join(ideWorkspaceRoot, "chats");

    mkdirSync(dirname(configPath), { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    migrateLegacyDataRoot(repoRoot, dataRoot);
    mkdirSync(teletonWorkspaceRoot, { recursive: true });
    mkdirSync(ideWorkspaceRoot, { recursive: true });
    mkdirSync(workspaceBaseRoot, {
        recursive: true
    });
    migrateLegacyProjectsRoot(legacyProjectsRoot, workspaceBaseRoot);
    mkdirSync(ideCodeAgentRoot, { recursive: true });
    mkdirSync(ideProjectsMetaRoot, { recursive: true });
    mkdirSync(ideChatsMetaRoot, { recursive: true });

    const normalized = {
        ...config,
        server: normalizeServerConfig(config.server),
        teleton: {
            ...config.teleton,
            packagePath
        },
        runtime: {
            teletonRoot,
            teletonWorkspaceRoot,
            ideWorkspaceRoot,
            ideCodeAgentRoot,
            ideProjectsMetaRoot,
            ideChatsMetaRoot,
            appRoot: config.runtime.appRoot || repoRoot,
            dataRoot,
            workspaceBaseRoot,
            maxShellTimeoutMs: config.runtime.maxShellTimeoutMs,
            maxShellOutputChars: config.runtime.maxShellOutputChars,
            maxTaskRuntimeMs: config.runtime.maxTaskRuntimeMs || 90000
        }
    };

    ensureCodeAgentWorkspace(normalized);

    const envHost = process.env.TELETON_CODE_HOST;
    const envPortValue = envPort("TELETON_CODE_PORT");
    const envPreviewPortValue = envPort("TELETON_CODE_PREVIEW_PORT");
    const envAuthToken = envValue("TELETON_CODE_AUTH_TOKEN");
    const runtimeConfig = {
        ...normalized,
        server: {
            ...normalized.server,
            ...(envHost ? { host: envHost } : {}),
            ...(envPortValue ? { port: envPortValue } : {}),
            ...(envPreviewPortValue ? { previewPort: envPreviewPortValue } : {}),
            ...(!envPreviewPortValue && envPortValue ? { previewPort: envPortValue + 1 } : {})
        },
        security: {
            ...normalized.security,
            ...(envAuthToken ? { authToken: envAuthToken } : {})
        }
    };

    return {
        configPath,
        config: runtimeConfig
    };
}

export function slugifyWorkspaceName(name) {
    const normalized = String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || `workspace-${randomUUID().slice(0, 8)}`;
}

export function buildWorkspacePath(config, name) {
    return join(config.runtime.workspaceBaseRoot, slugifyWorkspaceName(name));
}
