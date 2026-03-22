import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const DEPENDENCY_MANIFESTS = new Set([
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "requirements.txt",
    "pyproject.toml",
    "pipfile",
    "cargo.toml",
    "cargo.lock",
    "go.mod",
    "go.sum"
]);

function normalizePath(value) {
    return String(value || "").replace(/\\/g, "/").trim();
}

export function captureBaselineWorkspaceState(workspace) {
    if (!workspace?.path || !existsSync(workspace.path)) {
        return {
            exists: false,
            topLevelEntries: [],
            dependencyManifests: []
        };
    }

    const topLevelEntries = readdirSync(workspace.path, { withFileTypes: true })
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith(".teleton-workspace"))
        .sort();

    return {
        exists: true,
        topLevelEntries,
        dependencyManifests: topLevelEntries.filter((name) => DEPENDENCY_MANIFESTS.has(name.toLowerCase()))
    };
}

function touchesDependencyManifest(changedFiles = []) {
    return changedFiles.some((relativePath) =>
        DEPENDENCY_MANIFESTS.has(basename(normalizePath(relativePath)).toLowerCase())
    );
}

function pathExistsInWorkspace(workspace, relativePath) {
    if (!workspace?.path || !relativePath) {
        return false;
    }

    const normalized = normalizePath(relativePath);
    if (!normalized) {
        return false;
    }

    return existsSync(join(workspace.path, normalized));
}

export function detectScopeIssues({
    workspace,
    changedFiles = [],
    approval = {},
    settings = {},
    baselineWorkspaceState = null
} = {}) {
    const issues = [];
    const normalizedChangedFiles = changedFiles.map((value) => normalizePath(value)).filter(Boolean);

    if (touchesDependencyManifest(normalizedChangedFiles) && settings?.fullAccess !== true) {
        issues.push("Dependency or manifest changes were attempted without an explicitly elevated execution mode.");
    }

    if (approval?.active === true && approval?.scope === "destructive") {
        issues.push("A destructive change is still awaiting owner approval.");
    }

    if (baselineWorkspaceState?.exists === true && (!workspace?.path || !existsSync(workspace.path))) {
        issues.push("The workspace became unavailable during the turn.");
    }

    if (baselineWorkspaceState?.exists === true && workspace?.path && existsSync(workspace.path)) {
        const currentTopLevelEntries = readdirSync(workspace.path, { withFileTypes: true })
            .map((entry) => entry.name)
            .filter((name) => !name.startsWith(".teleton-workspace"))
            .sort();
        const removedTopLevelEntries = (baselineWorkspaceState.topLevelEntries || []).filter(
            (name) => !currentTopLevelEntries.includes(name)
        );

        if (
            removedTopLevelEntries.length > 0 &&
            approval?.scope !== "destructive" &&
            settings?.fullAccess !== true
        ) {
            issues.push(
                `Top-level project entries were removed without explicit destructive approval: ${removedTopLevelEntries.slice(0, 4).join(", ")}`
            );
        }
    }

    for (const filePath of normalizedChangedFiles) {
        if (!pathExistsInWorkspace(workspace, filePath) && !/^(?:README\.md|docs\/)/i.test(filePath)) {
            // Missing changed paths are handled elsewhere as artifact failures, not scope violations.
            continue;
        }
    }

    return issues;
}
