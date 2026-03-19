import { json, notFound, badRequest } from "../lib/http-utils.js";
import { executeTask } from "../lib/task-orchestrator.js";
import { subscribeTaskStream, publishTaskEvent } from "../lib/sse-manager.js";
import { buildDecisionBlocks } from "../lib/chat-blocks.js";
import { resolveTaskLanguage } from "../lib/language.js";

export function handleGetTask(taskId, stateStore, response) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");
    json(response, 200, { success: true, data: task });
}

export function handleTaskStream(taskId, stateStore, runtimeAdapter, response) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");

    subscribeTaskStream(taskId, response, (id) => {
        const t = stateStore.getTask(id);
        const sid = t?.sessionId;
        return {
            task: t,
            latestTask: t,
            sessionId: sid,
            messages: sid ? stateStore.getMessages(sid) : [],
            contextInfo: sid ? stateStore.getSessionContext(sid) : null,
            runtime: runtimeAdapter.getRuntimeStatus()
        };
    });
}

export async function handleTaskApproval(taskId, stateStore, runtimeAdapter, body, buildAssistantBlocks, buildPermissionBlocks, response) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");
    if (task.status !== "awaiting_approval") return badRequest(response, "Task does not require approval");

    const decision = String(body.decision || "").toLowerCase();
    const language = resolveTaskLanguage(task.prompt, task.settings || {});

    if (!["accept", "reject", "accept_all", "reject_all"].includes(decision)) {
        return badRequest(response, "Invalid approval decision");
    }

    if (decision === "reject" || decision === "reject_all") {
        stateStore.appendTaskStep(task.id, { type: "permission_decision", decision });
        const updatedTask = stateStore.completeTask(task.id, {
            status: "failed",
            approval: { decision, granted: false },
            response: language === "ru" ? "Выполнение отклонено владельцем." : "Execution rejected by owner."
        });
        const assistantMessage = stateStore.appendMessage(task.sessionId, "agent", language === "ru" ? "Разрешение отклонено." : "Permission rejected.", {
            taskId: task.id,
            blocks: buildDecisionBlocks(decision, language)
        });
        publishTaskEvent(task.id, "task.failed", { assistantMessage, task: updatedTask, latestTask: updatedTask, sessionId: task.sessionId });
        json(response, 200, { success: true, data: { task: updatedTask } });
        return;
    }

    const nextSettings =
        decision === "accept"
            ? {
                  ...(task.settings || {}),
                  fullAccess: false,
                  approvalMode: "single_step",
                  approvalGrant: {
                      mode: "single_step",
                      remainingActionSteps: 1
                  }
              }
            : {
                  ...(task.settings || {}),
                  fullAccess: true,
                  approvalMode: "all",
                  approvalGrant: null
              };

    const updatedTask = stateStore.updateTask(task.id, {
        status: "running",
        approval: { decision, granted: true },
        settings: nextSettings
    });
    stateStore.appendTaskStep(task.id, { type: "permission_decision", decision });
    stateStore.appendMessage(task.sessionId, "agent", language === "ru" ? "Разрешение получено. Начинаю выполнение." : "Approval received. Starting execution.", {
        taskId: task.id,
        blocks: buildDecisionBlocks(decision, language)
    });

    executeTask({
        task: updatedTask,
        sessionId: task.sessionId,
        prompt: task.prompt,
        settings: nextSettings,
        stateStore,
        runtimeAdapter,
        publishTaskEvent,
        buildAssistantBlocks,
        buildPermissionBlocks
    });

    json(response, 202, { success: true, data: { task: updatedTask } });
}

export async function handleTaskRecovery(taskId, stateStore, runtimeAdapter, body, buildAssistantBlocks, buildPermissionBlocks, response) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");

    const action = String(body.action || "fix").toLowerCase();
    const language = resolveTaskLanguage(task.prompt, task.settings || {});

    if (!["fix", "skip"].includes(action)) {
        return badRequest(response, "Invalid recovery action");
    }

    if (action === "skip") {
        const userText = language === "ru" ? "Пропускаем восстановление по этой ошибке." : "Skip recovery for this failure.";
        const agentText = language === "ru" ? "Восстановление пропущено." : "Recovery skipped.";
        const userMessage = stateStore.appendMessage(task.sessionId, "user", userText);
        const assistantMessage = stateStore.appendMessage(task.sessionId, "agent", agentText, {
            taskId: task.id,
            blocks: [{ type: "decision", status: "skipped", text: agentText }]
        });
        return json(response, 200, { success: true, data: { userMessage, assistantMessage, task } });
    }

    if (task.status !== "failed") {
        return badRequest(response, "Recovery is only available for failed tasks");
    }

    const recoveryPrompt =
        language === "ru"
            ? `Исправь предыдущую неудачную попытку в текущем проекте.
Исходная задача владельца:
${task.prompt}

Причина сбоя:
${task.response || "неизвестная ошибка"}

Используй текущее состояние workspace. Не начинай с нуля, а аккуратно исправь результат и доведи задачу до рабочего состояния.`
            : `Fix the previous failed attempt in the current project.
Original owner request:
${task.prompt}

Failure to resolve:
${task.response || "unknown error"}

Use the current workspace state. Do not restart from scratch. Repair the result, change only what is needed, and finish the task in a working state.`;

    const userText = language === "ru" ? "Исправь последнюю ошибку и продолжай." : "Fix the last failure and continue.";
    const assistantText = language === "ru" ? "Запускаю восстановление после ошибки." : "Starting a recovery pass.";

    const userMessage = stateStore.appendMessage(task.sessionId, "user", userText);
    const recoveryTask = stateStore.createTask(task.sessionId, recoveryPrompt, {
        status: "running",
        settings: task.settings || {},
        permissionScope: null,
        recoveryOf: task.id
    });
    const assistantMessage = stateStore.appendMessage(task.sessionId, "agent", assistantText, {
        taskId: recoveryTask.id,
        blocks: [{ type: "recovery", text: assistantText }]
    });

    executeTask({
        task: recoveryTask,
        sessionId: task.sessionId,
        prompt: recoveryPrompt,
        settings: task.settings || {},
        stateStore,
        runtimeAdapter,
        publishTaskEvent,
        buildAssistantBlocks,
        buildPermissionBlocks
    });

    json(response, 202, { success: true, data: { userMessage, assistantMessage, task: recoveryTask } });
}
