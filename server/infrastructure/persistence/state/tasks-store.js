import { randomUUID } from "node:crypto";
import { nowIso } from "./state-helpers.js";

export function getLatestTask(store, sessionId) {
    const tasks = store.state.tasks.filter((task) => task.sessionId === sessionId);
    return tasks.length > 0 ? tasks[tasks.length - 1] : null;
}

export function getTask(store, taskId) {
    return store.state.tasks.find((task) => task.id === taskId) || null;
}

export function createTask(store, sessionId, prompt, meta = {}) {
    const task = {
        id: randomUUID(),
        sessionId,
        prompt,
        status: meta.status || "running",
        startedAt: nowIso(),
        completedAt: null,
        toolCalls: [],
        steps: [],
        response: null,
        settings: meta.settings || {},
        permissionScope: meta.permissionScope || null,
        approval: meta.approval || null,
        attachments: Array.isArray(meta.attachments) ? meta.attachments : []
    };
    store.state.tasks.push(task);
    store.updateSession(sessionId, {
        status: task.status === "awaiting_approval" ? "idle" : "running"
    });
    store.save();
    return task;
}

export function updateTask(store, taskId, patch) {
    const task = getTask(store, taskId);
    if (!task) {
        return null;
    }

    Object.assign(task, patch);
    store.save();
    return task;
}

export function appendTaskStep(store, taskId, step) {
    const task = getTask(store, taskId);
    if (!task) {
        return null;
    }

    if (step.toolCallId) {
        const existingIndex = task.steps.findIndex((entry) => entry.toolCallId === step.toolCallId);
        if (existingIndex !== -1) {
            task.steps[existingIndex] = {
                ...task.steps[existingIndex],
                ...step,
                updatedAt: nowIso()
            };
            store.save();
            return task;
        }
    }

    task.steps.push({
        id: randomUUID(),
        createdAt: nowIso(),
        ...step
    });
    store.save();
    return task;
}

export function completeTask(store, taskId, patch) {
    const task = getTask(store, taskId);
    if (!task) {
        return null;
    }

    Object.assign(task, patch, {
        status: patch.status || "completed",
        completedAt: nowIso()
    });
    const session = store.getSession(task.sessionId);
    if (session) {
        store.updateSession(task.sessionId, { status: "idle" });
    }
    store.save();
    return task;
}
