import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { buildWorkspacePath } from "../../../config/service-config.js";
import { nowIso } from "./state-helpers.js";

function allocateWorkspacePath(config, requestedPath) {
    const basePath = requestedPath || buildWorkspacePath(config, "workspace");
    if (!existsSync(basePath)) {
        return basePath;
    }

    try {
        if (readdirSync(basePath).length === 0) {
            return basePath;
        }
    } catch (_error) {
        return basePath;
    }

    const parent = dirname(basePath);
    const name = basename(basePath);
    let index = 2;

    while (true) {
        const candidate = join(parent, `${name}-${index}`);
        if (!existsSync(candidate)) {
            return candidate;
        }
        index += 1;
    }
}

function isManagedWorkspacePath(config, workspacePath) {
    const baseRoot = resolve(config.runtime.workspaceBaseRoot);
    const target = resolve(workspacePath);
    const relativePath = relative(baseRoot, target);
    return (
        target !== resolve(config.runtime.appRoot) &&
        !relativePath.startsWith("..") &&
        relativePath !== ""
    );
}

export function defaultState(config) {
    return {
        workspaces: [],
        sessions: [],
        messages: {},
        tasks: [],
        activeWorkspaceId: null,
        activeSessionId: null
    };
}

export function getWorkspace(store, workspaceId) {
    return store.state.workspaces.find((workspace) => workspace.id === workspaceId) || null;
}

export function listWorkspaces(store) {
    return store.state.workspaces.filter(
        (workspace) => workspace.kind === "project" && !workspace.archived
    );
}

export function listArchivedWorkspaces(store) {
    return store.state.workspaces.filter(
        (workspace) => workspace.kind === "project" && workspace.archived
    );
}

export function createWorkspace(store, { name, path, icon }) {
    const workspacePath = allocateWorkspacePath(
        store.config,
        path || buildWorkspacePath(store.config, name)
    );
    mkdirSync(workspacePath, { recursive: true });

    const workspace = {
        id: randomUUID(),
        name,
        path: workspacePath,
        kind: "project",
        icon: icon || "folder",
        archived: false,
        createdAt: nowIso(),
        updatedAt: nowIso()
    };
    store.state.workspaces.push(workspace);
    store.state.activeWorkspaceId = workspace.id;
    store.save();
    return workspace;
}

export function updateWorkspace(store, workspaceId, patch) {
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
        return null;
    }

    Object.assign(workspace, patch, { updatedAt: nowIso() });
    store.save();
    return workspace;
}

export function archiveWorkspace(store, workspaceId) {
    return updateWorkspace(store, workspaceId, { archived: true });
}

export function restoreWorkspace(store, workspaceId) {
    return updateWorkspace(store, workspaceId, { archived: false });
}

export function deleteWorkspace(store, workspaceId) {
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) {
        return;
    }

    store.state.workspaces = store.state.workspaces.filter((item) => item.id !== workspaceId);
    const sessionsToDelete = store.state.sessions.filter((session) => session.workspaceId === workspaceId);
    store.state.sessions = store.state.sessions.filter((session) => session.workspaceId !== workspaceId);
    const deletedSessionIds = new Set(sessionsToDelete.map((session) => session.id));

    for (const session of sessionsToDelete) {
        delete store.state.messages[session.id];
    }

    // Remove orphan tasks for deleted sessions and tasks directly bound to this workspace.
    store.state.tasks = store.state.tasks.filter(
        (task) => !deletedSessionIds.has(task.sessionId) && task.workspaceId !== workspaceId
    );

    if (!store.getWorkspace(store.state.activeWorkspaceId)) {
        const nextWorkspace = store.listWorkspaces()[0] || null;
        store.state.activeWorkspaceId = nextWorkspace?.id || null;
        store.state.activeSessionId = nextWorkspace ? store.listSessions(nextWorkspace.id)[0]?.id || null : null;
    }

    if (
        workspace.kind === "project" &&
        isManagedWorkspacePath(store.config, workspace.path) &&
        existsSync(workspace.path)
    ) {
        rmSync(workspace.path, { recursive: true, force: true });
    }

    store.save();
}
