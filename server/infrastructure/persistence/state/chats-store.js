import { randomUUID } from "node:crypto";
import { nowIso } from "./state-helpers.js";

export function listSessions(store, workspaceId) {
    return store.state.sessions
        .filter((session) => session.workspaceId === workspaceId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getSession(store, sessionId) {
    return store.state.sessions.find((session) => session.id === sessionId) || null;
}

export function getMessages(store, sessionId) {
    return store.state.messages[sessionId] || [];
}

export function createSession(store, workspaceId, title = "New chat") {
    const session = {
        id: randomUUID(),
        workspaceId,
        title,
        status: "idle",
        createdAt: nowIso(),
        updatedAt: nowIso()
    };
    store.state.sessions.push(session);
    store.state.messages[session.id] = [];
    store.state.activeWorkspaceId = workspaceId;
    store.state.activeSessionId = session.id;
    store.save();
    return session;
}

export function updateSession(store, sessionId, patch) {
    const session = store.getSession(sessionId);
    if (!session) {
        return null;
    }

    Object.assign(session, patch, { updatedAt: nowIso() });
    store.save();
    return session;
}

export function deleteSession(store, sessionId) {
    const session = store.getSession(sessionId);
    if (!session) {
        return;
    }

    store.state.sessions = store.state.sessions.filter((item) => item.id !== sessionId);
    delete store.state.messages[sessionId];
    store.state.tasks = store.state.tasks.filter((task) => task.sessionId !== sessionId);

    const sibling = store.listSessions(session.workspaceId)[0] || null;
    store.state.activeSessionId = sibling?.id || null;
    store.save();
}

export function appendMessage(store, sessionId, role, text, meta = {}) {
    if (!store.state.messages[sessionId]) {
        store.state.messages[sessionId] = [];
    }

    const message = {
        id: randomUUID(),
        role,
        text,
        createdAt: nowIso(),
        ...meta
    };
    store.state.messages[sessionId].push(message);
    store.updateSession(sessionId, { updatedAt: nowIso() });
    return message;
}

export function setActiveSelection(store, workspaceId, sessionId) {
    store.state.activeWorkspaceId = workspaceId;
    store.state.activeSessionId = sessionId;
    store.save();
}
