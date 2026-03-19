import { json, badRequest, notFound } from "../lib/http-utils.js";
import { buildWorkspacePath } from "../lib/config.js";

export function handleWorkspaceBootstrap(stateStore, runtimeAdapter, response) {
    const workspaces = stateStore.listWorkspaces();
    const archivedWorkspaces = stateStore.listArchivedWorkspaces();
    const snapshot = stateStore.snapshot();
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === snapshot.activeWorkspaceId)
        ? snapshot.activeWorkspaceId
        : workspaces[0]?.id || null;
    const activeSessions = activeWorkspaceId ? stateStore.listSessions(activeWorkspaceId) : [];
    const activeSessionId = activeSessions.some((session) => session.id === snapshot.activeSessionId)
        ? snapshot.activeSessionId
        : activeSessions[0]?.id || null;
    const sessionsByWorkspace = {};

    if (activeWorkspaceId !== snapshot.activeWorkspaceId || activeSessionId !== snapshot.activeSessionId) {
        stateStore.setActive(activeWorkspaceId, activeSessionId);
    }

    for (const workspace of [...workspaces, ...archivedWorkspaces]) {
        sessionsByWorkspace[workspace.id] = stateStore.listSessions(workspace.id);
    }

    const payload = {
        workspaces,
        archivedWorkspaces,
        sessionsByWorkspace,
        activeWorkspaceId,
        activeSessionId,
        messages: activeSessionId ? stateStore.getMessages(activeSessionId) : [],
        latestTask: activeSessionId ? stateStore.getLatestTask(activeSessionId) : null,
        contextInfo: activeSessionId ? stateStore.getSessionContext(activeSessionId) : null,
        runtime: runtimeAdapter.getRuntimeStatus()
    };
    json(response, 200, { success: true, data: payload });
}

export async function handleCreateWorkspace(stateStore, config, body, response) {
    if (!body.name || typeof body.name !== "string") {
        badRequest(response, "Workspace name is required");
        return false;
    }
    const workspace = stateStore.createWorkspace({
        name: body.name.trim(),
        path: body.path || buildWorkspacePath(config, body.name.trim()),
        icon: body.icon || "folder"
    });
    stateStore.createSession(workspace.id, "New chat");
    return true;
}

export function handleUpdateWorkspace(stateStore, workspaceId, body, response) {
    const workspace = stateStore.getWorkspace(workspaceId);
    if (!workspace) {
        notFound(response, "Workspace not found");
        return false;
    }

    if (body.name) workspace.name = body.name.trim();
    if (body.icon) workspace.icon = body.icon;
    if (typeof body.isArchived === 'boolean') workspace.archived = body.isArchived;

    stateStore.save();
    return true;
}

export function handleDeleteWorkspace(stateStore, workspaceId) {
    stateStore.deleteWorkspace(workspaceId);
    return true;
}

export function handleArchiveWorkspace(stateStore, workspaceId) {
    stateStore.archiveWorkspace(workspaceId);
    stateStore.save();
    return true;
}

export function handleRestoreWorkspace(stateStore, workspaceId) {
    stateStore.restoreWorkspace(workspaceId);
    stateStore.save();
    return true;
}
