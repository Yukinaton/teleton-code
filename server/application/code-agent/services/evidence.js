import { existsSync } from "node:fs";
import { join } from "node:path";
import { collectChangedFilesFromToolCalls, hasConfirmedFileWrites } from "../tool-call-utils.js";

export function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/").trim();
}

export function extractExplicitRequestedPaths(prompt) {
    const source = String(prompt || "");
    if (!source.trim()) {
        return [];
    }

    const allowedExtensions = new Set([
        "html",
        "htm",
        "css",
        "js",
        "jsx",
        "ts",
        "tsx",
        "mjs",
        "cjs",
        "json",
        "md",
        "txt",
        "yaml",
        "yml",
        "toml",
        "lock",
        "sh",
        "py",
        "rb",
        "go",
        "rs",
        "java",
        "kt",
        "swift",
        "sql",
        "env"
    ]);
    const matches = [];
    const patterns = [
        /`([^`\n]+)`/g,
        /"([^"\n]+)"/g,
        /'([^'\n]+)'/g,
        /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g,
        /\b[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12}\b/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const candidate = normalizePath(match[1] || match[0]);
            if (!candidate || candidate.includes("://") || candidate.startsWith("data:")) {
                continue;
            }
            if (!/[./\\]/.test(candidate)) {
                continue;
            }

            const extension = candidate.includes(".") ? candidate.split(".").pop().toLowerCase() : "";
            const looksLikeFilePath = candidate.includes("/") || candidate.includes("\\") || allowedExtensions.has(extension);

            if (!looksLikeFilePath) {
                continue;
            }
            matches.push(candidate);
        }
    }

    const uniqueMatches = [...new Set(matches)];

    return uniqueMatches.filter((candidate) => {
        if (candidate.includes("/")) {
            return true;
        }

        return !uniqueMatches.some(
            (other) => other !== candidate && other.endsWith(`/${candidate}`)
        );
    });
}

export function pathExistsInWorkspace(workspace, relativePath) {
    if (!workspace?.path || !relativePath) {
        return false;
    }

    const normalized = normalizePath(relativePath);
    if (!normalized) {
        return false;
    }

    return existsSync(join(workspace.path, normalized));
}

export function resolveRequiredArtifactsPresent({ mode, workspace, requestedFiles = [] } = {}) {
    if (String(mode || "") !== "act") {
        return null;
    }

    const normalizedRequested = requestedFiles
        .map((value) => normalizePath(value))
        .filter(Boolean);

    if (normalizedRequested.length === 0) {
        return null;
    }

    return normalizedRequested.every((relativePath) => pathExistsInWorkspace(workspace, relativePath));
}

export function buildEvidence({
    mode,
    toolCalls = [],
    changedFiles = null,
    workspace = null,
    requestedFiles = [],
    verification = null,
    verificationMode = "best_effort",
    claimMatchesEvidence = true
} = {}) {
    const resolvedChangedFiles = Array.isArray(changedFiles)
        ? changedFiles
        : collectChangedFilesFromToolCalls(toolCalls);
    const checksPassed =
        verification?.status === "passed" ? true : verification?.status === "failed" ? false : null;

    return {
        writesConfirmed: hasConfirmedFileWrites(toolCalls),
        requiredArtifactsPresent: resolveRequiredArtifactsPresent({
            mode,
            workspace,
            requestedFiles
        }),
        checksPassed,
        claimMatchesEvidence: claimMatchesEvidence !== false,
        verificationMode
    };
}

export function hasUserRelevantProgress({ mode, changedFiles = [], content = "" } = {}) {
    if (String(mode || "") === "answer" || String(mode || "") === "inspect") {
        return String(content || "").trim().length > 0;
    }

    return Array.isArray(changedFiles) && changedFiles.length > 0;
}
