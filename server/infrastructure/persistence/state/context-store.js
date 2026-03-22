import { randomUUID } from "node:crypto";
import { buildContextSummary, nowIso } from "./state-helpers.js";

function buildRecentTranscript(messages = []) {
    return messages
        .slice(-6)
        .map((message) => {
            const role = String(message?.role || "unknown").toLowerCase() === "user" ? "Owner" : "Agent";
            const text = String(message?.text || "")
                .replace(/\r\n/g, "\n")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 280);
            return text ? `- ${role}: ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
}

function buildRecentOwnerTranscript(messages = []) {
    return messages
        .filter((message) => String(message?.role || "").toLowerCase() === "user")
        .slice(-6)
        .map((message) =>
            String(message?.text || "")
                .replace(/\r\n/g, "\n")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 280)
        )
        .filter(Boolean)
        .map((text) => `- Owner: ${text}`)
        .join("\n");
}

function getLatestSessionTask(store, sessionId) {
    const tasks = Array.isArray(store?.state?.tasks)
        ? store.state.tasks.filter((task) => task?.sessionId === sessionId)
        : [];

    if (tasks.length === 0) {
        return null;
    }

    const latestTask = tasks[tasks.length - 1];
    const failures = Array.isArray(latestTask?.failures) ? latestTask.failures : [];

    return {
        status: latestTask?.status || null,
        stage: latestTask?.stage || null,
        resultSummary: latestTask?.resultSummary || null,
        changedFiles: Array.isArray(latestTask?.changedFiles) ? latestTask.changedFiles.slice(0, 12) : [],
        verifyStatus: latestTask?.verify?.status || null,
        failureTypes: failures.slice(0, 4).map((item) => item?.type).filter(Boolean)
    };
}

function buildRecentTaskActivity(store, sessionIds = []) {
    const tasks = Array.isArray(store?.state?.tasks)
        ? store.state.tasks.filter((task) => sessionIds.includes(task?.sessionId))
        : [];

    if (tasks.length === 0) {
        return "";
    }

    const latestTasks = tasks.slice(-4);
    const lines = [];

    for (const task of latestTasks) {
        const changedFiles = Array.isArray(task?.changedFiles) ? task.changedFiles.slice(0, 4) : [];
        const summary = String(task?.resultSummary || "").trim();
        const status = String(task?.status || "unknown");

        if (changedFiles.length > 0) {
            lines.push(`- task ${status}: ${changedFiles.join(", ")}`);
            continue;
        }

        if (summary) {
            lines.push(`- task ${status}: ${summary.slice(0, 140)}`);
        }
    }

    return lines.join("\n");
}

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
        summary,
        recentTranscript: buildRecentTranscript(recentMessages),
        recentOwnerTranscript: buildRecentOwnerTranscript(recentMessages),
        lastTask: getLatestSessionTask(store, sessionId)
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
        recentTaskActivity: buildRecentTaskActivity(store, sessionIds),
        messageCount: recentHistory.length
    };
}
