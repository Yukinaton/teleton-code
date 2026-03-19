import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultState as buildDefaultState } from "./projects-store.js";
import { nowIso } from "./state-helpers.js";

function recoverStaleRunningState(state) {
    state.tasks = (state.tasks || []).map((task) =>
        task.status !== "running"
            ? task
            : {
                  ...task,
                  status: "failed",
                  completedAt: nowIso(),
                  response: task.response || "Task was interrupted before completion."
              }
    );

    state.sessions = (state.sessions || []).map((session) =>
        session.status !== "running"
            ? session
            : {
                  ...session,
                  status: "idle",
                  updatedAt: nowIso()
              }
    );
}

function normalizeWorkspaceKinds(state, config) {
    state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        kind:
            workspace.kind ||
            (workspace.path === config.runtime.appRoot ? "service" : "project")
    }));
}

function dedupeWorkspaceIds(state) {
    const seenWorkspaceIds = new Set();
    state.workspaces = state.workspaces.map((workspace) => {
        if (!seenWorkspaceIds.has(workspace.id)) {
            seenWorkspaceIds.add(workspace.id);
            return workspace;
        }

        const nextWorkspace = {
            ...workspace,
            id: randomUUID()
        };
        seenWorkspaceIds.add(nextWorkspace.id);
        state.sessions = state.sessions.map((session) =>
            session.workspaceId === workspace.id
                ? { ...session, workspaceId: nextWorkspace.id }
                : session
        );
        return nextWorkspace;
    });
}

function ensureProjectWorkspace(state, config) {
    const hasProjectWorkspace = state.workspaces.some(
        (workspace) => workspace.kind === "project" && !workspace.archived
    );

    if (!hasProjectWorkspace) {
        state.workspaces.push(buildDefaultState(config).workspaces[0]);
    }
}

function ensureActiveSelection(state, fallback) {
    const activeWorkspace = state.workspaces.find(
        (workspace) => workspace.id === state.activeWorkspaceId && !workspace.archived
    );

    if (!activeWorkspace || activeWorkspace.kind !== "project") {
        const nextProjectWorkspace = state.workspaces.find(
            (workspace) => workspace.kind === "project" && !workspace.archived
        );
        state.activeWorkspaceId = nextProjectWorkspace?.id || fallback.activeWorkspaceId;
    }

    const activeSessions = state.sessions.filter(
        (session) => session.workspaceId === state.activeWorkspaceId
    );

    if (!activeSessions.some((session) => session.id === state.activeSessionId)) {
        state.activeSessionId = activeSessions[0]?.id || null;
    }
}

function ensureWorkspaceSessions(state) {
    if (!state.activeSessionId && state.activeWorkspaceId) {
        const sessionId = randomUUID();
        state.sessions.push({
            id: sessionId,
            workspaceId: state.activeWorkspaceId,
            title: "Code Session",
            status: "idle",
            createdAt: nowIso(),
            updatedAt: nowIso()
        });
        state.messages[sessionId] = [];
        state.activeSessionId = sessionId;
    }

    for (const workspace of state.workspaces) {
        const hasSession = state.sessions.some((session) => session.workspaceId === workspace.id);
        if (!hasSession && !workspace.archived) {
            const sessionId = randomUUID();
            state.sessions.push({
                id: sessionId,
                workspaceId: workspace.id,
                title: "Code Session",
                status: "idle",
                createdAt: nowIso(),
                updatedAt: nowIso()
            });
            state.messages[sessionId] = [];
            if (workspace.id === state.activeWorkspaceId) {
                state.activeSessionId = sessionId;
            }
        }
    }
}

function syncWorkspaceFolders(state, config) {
    const projectsDir = config.runtime.workspaceBaseRoot;
    if (!existsSync(projectsDir)) {
        return;
    }

    const folders = readdirSync(projectsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

    for (const folderName of folders) {
        const fullPath = join(projectsDir, folderName);
        const existsInState = state.workspaces.find(
            (workspace) => workspace.path === fullPath || resolve(workspace.path) === resolve(fullPath)
        );

        if (!existsInState) {
            state.workspaces.push({
                id: `auto-${randomUUID().slice(0, 8)}`,
                name: folderName,
                path: fullPath,
                kind: "project",
                icon: "folder",
                archived: false,
                createdAt: nowIso(),
                updatedAt: nowIso()
            });
        }
    }
}

export function loadStateSnapshot(path, config) {
    if (!existsSync(path)) {
        const initial = buildDefaultState(config);
        writeFileSync(path, JSON.stringify(initial, null, 2), "utf-8");
        return initial;
    }

    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const fallback = buildDefaultState(config);
    const state = {
        ...fallback,
        ...raw,
        workspaces: raw.workspaces || fallback.workspaces,
        sessions: raw.sessions || fallback.sessions,
        messages: raw.messages || fallback.messages,
        tasks: raw.tasks || fallback.tasks
    };

    normalizeWorkspaceKinds(state, config);
    dedupeWorkspaceIds(state);
    ensureProjectWorkspace(state, config);
    ensureActiveSelection(state, fallback);
    ensureWorkspaceSessions(state);
    recoverStaleRunningState(state);
    syncWorkspaceFolders(state, config);

    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
    return state;
}
