import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultState as buildDefaultState } from "./projects-store.js";
import { nowIso } from "./state-helpers.js";
import { resolveTaskEngine, STANDARD_TASK_ENGINE } from "../../../application/code-agent/task-engine.js";

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

function ensureLoopVersions(state) {
    state.sessions = (state.sessions || []).map((session) => {
        const { agentLoopVersion, ...rest } = session || {};
        return {
            ...rest,
            taskEngine: resolveTaskEngine(session, STANDARD_TASK_ENGINE)
        };
    });

    state.tasks = (state.tasks || []).map((task) => {
        const session = state.sessions.find((entry) => entry.id === task.sessionId);
        const { agentLoopVersion, ...rest } = task || {};
        return {
            ...rest,
            taskEngine: resolveTaskEngine(task, resolveTaskEngine(session, STANDARD_TASK_ENGINE)),
            phase: task?.phase || "idle",
            stage: task?.stage || null,
            currentAction: task?.currentAction || null,
            resultSummary: task?.resultSummary || null,
            approvalScope: task?.approvalScope || null,
            evidenceState: task?.evidenceState || "none",
            verify: task?.verify || null,
            mode: task?.mode || null,
            approval: task?.approval || null,
            evidence: task?.evidence || null,
            scope: task?.scope || null,
            repairAttempts: Number.isInteger(task?.repairAttempts) ? task.repairAttempts : 0,
            changedFiles: Array.isArray(task?.changedFiles) ? task.changedFiles : [],
            failures: Array.isArray(task?.failures) ? task.failures : [],
            turn: task?.turn || null
        };
    });
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

function isLegacyBootstrapSandbox(workspace) {
    return (
        workspace &&
        workspace.kind === "project" &&
        (workspace.name === "project-sandbox" ||
            basename(resolve(workspace.path || "")) === "project-sandbox")
    );
}

function isEmptyBootstrapFolder(workspacePath) {
    if (!workspacePath || !existsSync(workspacePath)) {
        return true;
    }

    const entries = readdirSync(workspacePath).filter(
        (entry) => entry !== ".teleton-workspace" && entry !== ".DS_Store" && entry !== "Thumbs.db"
    );

    return entries.length === 0;
}

function pruneLegacyBootstrapSandbox(state) {
    const activeProjects = state.workspaces.filter(
        (workspace) => workspace.kind === "project" && !workspace.archived
    );

    if (activeProjects.length !== 1) {
        return;
    }

    const [workspace] = activeProjects;
    if (!isLegacyBootstrapSandbox(workspace)) {
        return;
    }

    const sessions = state.sessions.filter((session) => session.workspaceId === workspace.id);
    const hasMessages = sessions.some((session) => (state.messages[session.id] || []).length > 0);
    const hasTasks = (state.tasks || []).some((task) => sessions.some((session) => session.id === task.sessionId));

    if (hasMessages || hasTasks || !isEmptyBootstrapFolder(workspace.path)) {
        return;
    }

    state.workspaces = state.workspaces.filter((item) => item.id !== workspace.id);
    state.sessions = state.sessions.filter((session) => session.workspaceId !== workspace.id);

    for (const session of sessions) {
        delete state.messages[session.id];
    }

    if (existsSync(workspace.path)) {
        rmSync(workspace.path, { recursive: true, force: true });
    }
}

function ensureWorkspaceSessions(state) {
    if (!state.activeSessionId && state.activeWorkspaceId) {
        const sessionId = randomUUID();
        state.sessions.push({
            id: sessionId,
            workspaceId: state.activeWorkspaceId,
            title: "Code Session",
            taskEngine: STANDARD_TASK_ENGINE,
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
                taskEngine: STANDARD_TASK_ENGINE,
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
    syncWorkspaceFolders(state, config);
    pruneLegacyBootstrapSandbox(state);
    ensureLoopVersions(state);
    ensureActiveSelection(state, fallback);
    ensureWorkspaceSessions(state);
    recoverStaleRunningState(state);

    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
    return state;
}
