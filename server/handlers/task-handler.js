import { json, notFound, badRequest } from "../lib/http-utils.js";
import { executeTask } from "../lib/task-orchestrator.js";
import { subscribeTaskStream, publishTaskEvent } from "../lib/sse-manager.js";
import { buildDecisionBlocks } from "../lib/chat-blocks.js";
import { resolveTaskLanguage } from "../lib/language.js";
import { buildTaskStateView } from "../application/code-agent/task-state-view.js";
import {
    buildRejectedTurnResult,
    buildTaskPatchFromTurnResult
} from "../application/code-agent/task-projection.js";
import {
    COMPATIBILITY_TASK_ENGINE,
    STANDARD_TASK_ENGINE,
    isStandardTaskEngine,
    resolveTaskEngine
} from "../application/code-agent/task-engine.js";

function resolveTerminalTaskEvent(status) {
    if (status === "failed") {
        return "task.failed";
    }

    if (status === "partial") {
        return "task.partial";
    }

    if (status === "clarification_required") {
        return "task.clarification_required";
    }

    return "task.completed";
}

function buildRejectedTaskPatch(task, decision, language) {
    const response =
        language === "ru" ? "Выполнение отклонено владельцем." : "Execution rejected by owner.";

    if (!isStandardTaskEngine(task)) {
        return {
            status: "failed",
            approval: { decision, granted: false },
            response,
            taskEngine: COMPATIBILITY_TASK_ENGINE,
            mode: task?.mode || "execute",
            phase: "failed",
            currentAction: null,
            resultSummary: response,
            approvalScope: task?.approvalScope || null,
            evidenceState: task?.evidenceState || "none",
            verify: task?.verify || null
        };
    }

    const rejectedTurn = buildRejectedTurnResult(task?.turn || null, language);
    return {
        ...buildTaskPatchFromTurnResult(task, rejectedTurn),
        status: rejectedTurn.status,
        approval: { decision, granted: false },
        permissionScope: null,
        response: task?.response || response
    };
}

function buildAcceptedTaskPatch(task, decision, nextSettings) {
    const basePatch = {
        status: "running",
        approval: { decision, granted: true },
        settings: nextSettings,
        permissionScope: null
    };

    if (!isStandardTaskEngine(task)) {
        return {
            ...basePatch,
            taskEngine: COMPATIBILITY_TASK_ENGINE,
            mode: task?.mode || "execute",
            phase: "idle",
            currentAction: null,
            resultSummary: null,
            approvalScope: null,
            evidenceState: task?.evidenceState || "none",
            verify: task?.verify || null
        };
    }

    return {
        ...basePatch,
        taskEngine: STANDARD_TASK_ENGINE,
        phase: "idle",
        stage: "execute",
        currentAction: null,
        resultSummary: null,
        approvalScope: null
    };
}

export function handleGetTask(taskId, stateStore, response) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");
    json(response, 200, { success: true, data: task });
}

export function handleTaskStream(taskId, stateStore, runtimeAdapter, response) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");

    subscribeTaskStream(taskId, response, (id) => {
        const currentTask = stateStore.getTask(id);
        const sessionId = currentTask?.sessionId;
        return {
            task: currentTask,
            latestTask: currentTask,
            sessionId,
            messages: sessionId ? stateStore.getMessages(sessionId) : [],
            contextInfo: sessionId ? stateStore.getSessionContext(sessionId) : null,
            runtime: runtimeAdapter.getRuntimeStatus()
        };
    });
}

export async function handleTaskApproval(
    taskId,
    stateStore,
    runtimeAdapter,
    body,
    buildAssistantBlocks,
    buildPermissionBlocks,
    response
) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");
    if (task.status !== "awaiting_approval") {
        return badRequest(response, "Task does not require approval");
    }

    const decision = String(body.decision || "").toLowerCase();
    const language = resolveTaskLanguage(task.prompt, task.settings || {});

    if (!["accept", "reject", "accept_all", "reject_all"].includes(decision)) {
        return badRequest(response, "Invalid approval decision");
    }

    if (decision === "reject" || decision === "reject_all") {
        stateStore.appendTaskStep(task.id, { type: "permission_decision", decision });
        const updatedTask = stateStore.completeTask(task.id, buildRejectedTaskPatch(task, decision, language));
        const assistantMessage = stateStore.appendMessage(
            task.sessionId,
            "agent",
            language === "ru" ? "Разрешение отклонено." : "Permission rejected.",
            {
                taskId: task.id,
                taskState: buildTaskStateView(updatedTask),
                blocks: buildDecisionBlocks(decision, language)
            }
        );

        publishTaskEvent(task.id, resolveTerminalTaskEvent(updatedTask.status), {
            assistantMessage,
            task: updatedTask,
            latestTask: updatedTask,
            sessionId: task.sessionId,
            messages: stateStore.getMessages(task.sessionId),
            contextInfo: stateStore.getSessionContext(task.sessionId),
            runtime: runtimeAdapter.getRuntimeStatus()
        });
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

    const updatedTask = stateStore.updateTask(task.id, buildAcceptedTaskPatch(task, decision, nextSettings));
    stateStore.appendTaskStep(task.id, { type: "permission_decision", decision });
    stateStore.appendMessage(
        task.sessionId,
        "agent",
        language === "ru" ? "Разрешение получено. Продолжаю выполнение." : "Approval received. Continuing execution.",
        {
            taskId: task.id,
            taskState: buildTaskStateView(updatedTask),
            blocks: buildDecisionBlocks(decision, language)
        }
    );

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

export async function handleTaskRecovery(
    taskId,
    stateStore,
    runtimeAdapter,
    body,
    buildAssistantBlocks,
    buildPermissionBlocks,
    response
) {
    const task = stateStore.getTask(taskId);
    if (!task) return notFound(response, "Task not found");

    if (isStandardTaskEngine(task)) {
        return badRequest(
            response,
            "External recovery is not used for the standard task engine. Start a new turn instead."
        );
    }

    const action = String(body.action || "fix").toLowerCase();
    const language = resolveTaskLanguage(task.prompt, task.settings || {});

    if (!["fix", "skip"].includes(action)) {
        return badRequest(response, "Invalid recovery action");
    }

    if (action === "skip") {
        const userText =
            language === "ru" ? "Пропускаем восстановление по этой ошибке." : "Skip recovery for this failure.";
        const agentText = language === "ru" ? "Восстановление пропущено." : "Recovery skipped.";
        const userMessage = stateStore.appendMessage(task.sessionId, "user", userText);
        const assistantMessage = stateStore.appendMessage(task.sessionId, "agent", agentText, {
            taskId: task.id,
            taskState: buildTaskStateView(task),
            blocks: [{ type: "decision", status: "skipped", text: agentText }]
        });
        return json(response, 200, { success: true, data: { userMessage, assistantMessage, task } });
    }

    if (task.status !== "failed") {
        return badRequest(response, "Recovery is only available for failed tasks");
    }

    const recoverySettings = {
        ...(task.settings || {}),
        ownerPrompt: task.settings?.ownerPrompt || task.prompt
    };

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
        taskEngine: resolveTaskEngine(task, COMPATIBILITY_TASK_ENGINE),
        status: "running",
        phase: "editing",
        mode: "recover",
        currentAction: assistantText,
        settings: recoverySettings,
        permissionScope: null,
        recoveryOf: task.id
    });
    const assistantMessage = stateStore.appendMessage(task.sessionId, "agent", assistantText, {
        taskId: recoveryTask.id,
        taskState: buildTaskStateView(recoveryTask),
        blocks: [{ type: "recovery", text: assistantText }]
    });

    executeTask({
        task: recoveryTask,
        sessionId: task.sessionId,
        prompt: recoveryPrompt,
        settings: recoverySettings,
        stateStore,
        runtimeAdapter,
        publishTaskEvent,
        buildAssistantBlocks,
        buildPermissionBlocks
    });

    json(response, 202, { success: true, data: { userMessage, assistantMessage, task: recoveryTask } });
}
