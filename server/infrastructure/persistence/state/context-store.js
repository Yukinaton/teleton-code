import { randomUUID } from "node:crypto";
import { buildContextSummary, nowIso } from "./state-helpers.js";

export function getSessionContext(store, sessionId) {
    const messages = store.getMessages(sessionId);
    const totalChars = messages.reduce((sum, message) => sum + String(message.text || "").length, 0);
    const totalMessages = messages.length;
    const tailCount = 8;
    const headMessages = totalMessages > tailCount ? messages.slice(0, totalMessages - tailCount) : [];
    const recentMessages = totalMessages > tailCount ? messages.slice(-tailCount) : messages;
    const compressed = totalMessages > 12 || totalChars > 6000;
    const summary = compressed && headMessages.length ? buildContextSummary(headMessages.slice(-10)) : "";

    return {
        totalMessages,
        totalChars,
        compressed,
        summarizedMessages: headMessages.length,
        recentMessages: recentMessages.length,
        summary
    };
}

export async function updateProjectMemory(store, workspaceId, fact) {
    const workspace = store.getWorkspace(workspaceId);
    if (!workspace) return;

    if (!workspace.memory) workspace.memory = [];
    workspace.memory.push({
        id: randomUUID(),
        fact,
        createdAt: nowIso()
    });

    if (workspace.memory.length > 50) {
        workspace.memory = workspace.memory.slice(-50);
    }

    store.save();
}

export function getWorkspaceContext(store, workspaceId, excludeSessionId = null) {
    const workspace = store.getWorkspace(workspaceId);
    const sessionIds = store.state.sessions
        .filter((session) => session.workspaceId === workspaceId && session.id !== excludeSessionId)
        .map((session) => session.id);

    const recentHistory = sessionIds
        .flatMap((sessionId) => store.getMessages(sessionId).slice(-2))
        .slice(-6);

    const projectMemory = workspace?.memory || [];

    return {
        metadata: {
            name: workspace?.name,
            kind: workspace?.kind,
            path: workspace?.path
        },
        projectMemory: projectMemory.map((item) => item.fact),
        recentActivity: buildContextSummary(recentHistory),
        messageCount: recentHistory.length
    };
}
