import { resolveTaskLanguage } from "./language.js";
import {
    buildCompatibilityCompletionPatch,
    buildCompatibilityTaskPatchFromEvent
} from "../application/code-agent/compatibility-state.js";
import { buildTaskPatchFromTurnResult } from "../application/code-agent/task-projection.js";
import { buildTaskStateView } from "../application/code-agent/task-state-view.js";
import {
    COMPATIBILITY_TASK_ENGINE,
    STANDARD_TASK_ENGINE,
    isCompatibilityTaskEngine,
    isStandardTaskEngine
} from "../application/code-agent/task-engine.js";

export const runningTasks = new Map();

function coerceCompatibilityApprovalScope(scope) {
    return ["shell", "destructive"].includes(String(scope || "")) ? String(scope) : null;
}

function resolveFailureEvidenceState(task) {
    if (task?.evidenceState === "verify_failed") {
        return "verify_failed";
    }

    return "claim_mismatch";
}

function humanizeTaskFailureMessage(message, language = "ru") {
    const source = String(message || "").trim();
    const timeoutMatch = source.match(/timed out after\s+(\d+)ms/i);
    if (timeoutMatch) {
        return language === "ru"
            ? `Агент не успел завершить шаг за ${timeoutMatch[1]}мс.`
            : `The agent did not finish the step within ${timeoutMatch[1]}ms.`;
    }

    return source;
}

function describePendingAction(permissionRequest, language = "ru") {
    const toolName = permissionRequest?.name || "";
    const params = permissionRequest?.params || {};
    const path = params.path || params.targetPath || params.targetFile || "";
    const command = params.command || "";
    const paths = Array.isArray(params.paths) ? params.paths.filter(Boolean).join(", ") : "";

    if (["code_write_file", "code_write_file_lines", "code_write_json"].includes(toolName)) {
        return language === "ru"
            ? path
                ? `изменением файла ${path}`
                : "изменением файла"
            : path
              ? `modifying file ${path}`
              : "modifying a file";
    }

    if (["code_patch_file", "code_replace_text", "code_insert_block"].includes(toolName)) {
        return language === "ru"
            ? path
                ? `правкой файла ${path}`
                : "правкой файла"
            : path
              ? `editing file ${path}`
              : "editing a file";
    }

    if (toolName === "code_make_dirs") {
        return language === "ru"
            ? paths
                ? `созданием каталогов ${paths}`
                : "созданием каталогов"
            : paths
              ? `creating directories ${paths}`
              : "creating directories";
    }

    if (toolName === "code_run_command") {
        return language === "ru"
            ? command
                ? `запуском команды ${command}`
                : "запуском команды"
            : command
              ? `running command ${command}`
              : "running a command";
    }

    if (toolName === "code_install_dependencies") {
        return language === "ru" ? "установкой зависимостей" : "installing dependencies";
    }

    if (toolName === "code_delete_path" || toolName === "code_move_path") {
        return language === "ru"
            ? path
                ? `изменением пути ${path}`
                : "изменением файлов проекта"
            : path
              ? `changing path ${path}`
              : "changing project files";
    }

    return language === "ru" ? "следующим рабочим шагом" : "the next work step";
}

function findPermissionRequest(steps = []) {
    return (
        [...steps]
            .reverse()
            .find((step) => step?.type === "tool_finished" && step?.result?.requiresPermission === true) || null
    );
}

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

function resolveAssistantTerminalText(result) {
    return String(result?.content || result?.resultSummary || "").trim();
}

function buildStandardRuntimeFailurePatch(task, humanMessage) {
    const existingFailures = Array.isArray(task?.failures) ? task.failures : [];
    const runtimeFailure = {
        type: "tool_execution_failed",
        message: humanMessage,
        recoverable: false
    };
    const nextFailures = [...existingFailures, runtimeFailure];
    const currentTurn = task?.turn && typeof task.turn === "object" ? task.turn : null;
    const nextTurn = currentTurn
        ? {
              ...currentTurn,
              status: "failed",
              stage: "finalize",
              paused: false,
              approval: {
                  active: false,
                  scope: null,
                  pendingAction: null
              },
              currentAction: null,
              resultSummary: humanMessage,
              failures: nextFailures
          }
        : null;

    return {
        status: "failed",
        response: humanMessage,
        taskEngine: STANDARD_TASK_ENGINE,
        phase: "failed",
        stage: "finalize",
        mode: task?.mode || "act",
        currentAction: null,
        resultSummary: humanMessage,
        approvalScope: task?.approvalScope || null,
        evidenceState: task?.evidenceState || "claim_mismatch",
        verify: task?.verify || null,
        approval: task?.approval || null,
        evidence: task?.evidence || null,
        scope: task?.scope || null,
        repairAttempts: Number(task?.repairAttempts) || 0,
        changedFiles: Array.isArray(task?.changedFiles) ? task.changedFiles : [],
        failures: nextFailures,
        turn: nextTurn
    };
}

export async function executeTask({
    task,
    sessionId,
    prompt,
    settings,
    stateStore,
    runtimeAdapter,
    publishTaskEvent,
    buildAssistantBlocks,
    buildPermissionBlocks = () => []
}) {
    if (runningTasks.has(task.id)) {
        return runningTasks.get(task.id);
    }

    const session = stateStore.getSession(sessionId);
    const workspace = session ? stateStore.getWorkspace(session.workspaceId) : null;

    const runPromise = (async () => {
        publishTaskEvent(task.id, "task.accepted", {
            task,
            latestTask: task,
            sessionId,
            messages: stateStore.getMessages(sessionId),
            contextInfo: stateStore.getSessionContext(sessionId),
            runtime: runtimeAdapter.getRuntimeStatus(),
            workspace,
            phase: "accepted"
        });

        try {
            stateStore.updateTask(task.id, {
                status: "running",
                settings
            });

            if (isStandardTaskEngine(task)) {
                stateStore.updateTask(task.id, {
                    status: "running",
                    phase: "grounding",
                    stage: "grounding",
                    currentAction: null
                });
            }

            const initialStepCount = Array.isArray(stateStore.getTask(task.id)?.steps)
                ? stateStore.getTask(task.id).steps.length
                : 0;
            const shouldResumeTurn = isStandardTaskEngine(task) && task?.turn?.paused === true;

            const result = await (shouldResumeTurn
                ? runtimeAdapter.resumeSessionPrompt(
                      sessionId,
                      prompt,
                      task.turn,
                      async (event) => {
                          stateStore.appendTaskStep(task.id, event);

                          publishTaskEvent(task.id, "task.step", {
                              task: stateStore.getTask(task.id),
                              latestTask: stateStore.getTask(task.id),
                              sessionId,
                              messages: stateStore.getMessages(sessionId),
                              contextInfo: stateStore.getSessionContext(sessionId),
                              runtime: runtimeAdapter.getRuntimeStatus(),
                              step: event
                          });
                      },
                      settings
                  )
                : runtimeAdapter.processSessionPrompt(
                      sessionId,
                      prompt,
                      async (event) => {
                          stateStore.appendTaskStep(task.id, event);

                          if (isCompatibilityTaskEngine(task)) {
                              const executionContract = runtimeAdapter.toolRegistry.getChatExecutionContract(
                                  runtimeAdapter.sessionChatId(sessionId)
                              );
                              stateStore.updateTask(
                                  task.id,
                                  buildCompatibilityTaskPatchFromEvent(
                                      stateStore.getTask(task.id),
                                      event,
                                      executionContract || {}
                                  )
                              );
                          }

                          publishTaskEvent(task.id, "task.step", {
                              task: stateStore.getTask(task.id),
                              latestTask: stateStore.getTask(task.id),
                              sessionId,
                              messages: stateStore.getMessages(sessionId),
                              contextInfo: stateStore.getSessionContext(sessionId),
                              runtime: runtimeAdapter.getRuntimeStatus(),
                              step: event
                          });
                      },
                      settings
                  ));

            const taskAfterRun = stateStore.getTask(task.id);

            if (isStandardTaskEngine(task)) {
                const language = resolveTaskLanguage(prompt, settings);
                const nextTaskPatch = {
                    ...buildTaskPatchFromTurnResult(taskAfterRun, result),
                    workspaceName: workspace?.name || null
                };

                if (result?.paused === true || result?.approval?.active === true) {
                    const waitingTask = stateStore.updateTask(task.id, {
                        ...nextTaskPatch,
                        settings: {
                            ...(taskAfterRun?.settings || {}),
                            approvalGrant: null
                        },
                        permissionScope: result?.approval?.scope || taskAfterRun?.permissionScope || "task"
                    });

                    const pendingAction = describePendingAction(result?.approval?.pendingAction, language);
                    const permissionText =
                        language === "ru"
                            ? `Один рабочий шаг уже выполнен. Для продолжения нужно подтверждение перед ${pendingAction}.`
                            : `One step completed. I need approval before ${pendingAction}.`;

                    const assistantMessage = stateStore.appendMessage(sessionId, "agent", permissionText, {
                        taskId: task.id,
                        taskState: buildTaskStateView(waitingTask),
                        toolCalls: result.toolCalls,
                        blocks: buildPermissionBlocks(waitingTask, language, {
                            continuation: true,
                            blockedTool: result?.approval?.pendingAction?.name || null,
                            blockedParams: result?.approval?.pendingAction?.params || null,
                            approvalScope: result?.approval?.scope || "task",
                            summaryText: permissionText
                        })
                    });

                    publishTaskEvent(task.id, "task.awaiting_approval", {
                        assistantMessage,
                        task: waitingTask,
                        latestTask: waitingTask,
                        sessionId,
                        messages: stateStore.getMessages(sessionId),
                        contextInfo: stateStore.getSessionContext(sessionId),
                        runtime: runtimeAdapter.getRuntimeStatus()
                    });
                    return;
                }

                const terminalTask = stateStore.completeTask(task.id, nextTaskPatch);
                const assistantText = resolveAssistantTerminalText(result);
                const assistantMessage = stateStore.appendMessage(sessionId, "agent", assistantText, {
                    taskId: task.id,
                    taskState: buildTaskStateView(terminalTask),
                    toolCalls: result.toolCalls,
                    blocks: buildAssistantBlocks({
                        task: terminalTask,
                        content: assistantText,
                        toolCalls: result.toolCalls,
                        language,
                        workspace
                    })
                });

                publishTaskEvent(task.id, resolveTerminalTaskEvent(terminalTask.status), {
                    assistantMessage,
                    task: terminalTask,
                    latestTask: terminalTask,
                    sessionId,
                    messages: stateStore.getMessages(sessionId),
                    contextInfo: stateStore.getSessionContext(sessionId),
                    runtime: runtimeAdapter.getRuntimeStatus()
                });
                return;
            }

            const freshSteps = Array.isArray(taskAfterRun?.steps) ? taskAfterRun.steps.slice(initialStepCount) : [];
            const permissionRequest = findPermissionRequest(freshSteps);

            if (permissionRequest) {
                const language = resolveTaskLanguage(prompt, settings);
                const waitingTask = stateStore.updateTask(task.id, {
                    status: "awaiting_approval",
                    response: result.content,
                    taskEngine: COMPATIBILITY_TASK_ENGINE,
                    phase: "awaiting_approval",
                    currentAction: permissionRequest?.thought || permissionRequest?.title || null,
                    resultSummary: null,
                    approvalScope: coerceCompatibilityApprovalScope(
                        permissionRequest?.result?.approvalScope || taskAfterRun?.permissionScope
                    ),
                    evidenceState: taskAfterRun?.evidenceState || "none",
                    mode: taskAfterRun?.mode || "execute",
                    verify: taskAfterRun?.verify || null,
                    permissionScope: permissionRequest?.result?.approvalScope || taskAfterRun?.permissionScope || "task",
                    settings: {
                        ...(taskAfterRun?.settings || {}),
                        approvalGrant: null
                    }
                });

                const pendingAction = describePendingAction(permissionRequest, language);
                const permissionText =
                    language === "ru"
                        ? `Один рабочий шаг уже выполнен. Для продолжения нужно подтверждение перед ${pendingAction}.`
                        : `One step completed. I need approval before ${pendingAction}.`;

                const assistantMessage = stateStore.appendMessage(sessionId, "agent", permissionText, {
                    taskId: task.id,
                    taskState: buildTaskStateView(waitingTask),
                    toolCalls: result.toolCalls,
                    blocks: buildPermissionBlocks(waitingTask, language, {
                        continuation: true,
                        blockedTool: permissionRequest?.name || null,
                        blockedParams: permissionRequest?.params || null,
                        approvalScope: permissionRequest?.result?.approvalScope || permissionRequest?.approvalScope || "task",
                        summaryText: permissionText
                    })
                });

                publishTaskEvent(task.id, "task.awaiting_approval", {
                    assistantMessage,
                    task: waitingTask,
                    latestTask: waitingTask,
                    sessionId,
                    messages: stateStore.getMessages(sessionId),
                    contextInfo: stateStore.getSessionContext(sessionId),
                    runtime: runtimeAdapter.getRuntimeStatus()
                });
                return;
            }

            const assistantText = resolveAssistantTerminalText(result);
            const completedTask = stateStore.completeTask(task.id, {
                status: "completed",
                toolCalls: result.toolCalls,
                response: assistantText,
                workspaceName: workspace?.name || null,
                ...buildCompatibilityCompletionPatch(taskAfterRun, result)
            });

            const assistantMessage = stateStore.appendMessage(sessionId, "agent", assistantText, {
                taskId: task.id,
                taskState: buildTaskStateView(completedTask),
                toolCalls: result.toolCalls,
                blocks: buildAssistantBlocks({
                    task: completedTask,
                    content: assistantText,
                    toolCalls: result.toolCalls,
                    language: resolveTaskLanguage(prompt, settings),
                    workspace
                })
            });

            publishTaskEvent(task.id, "task.completed", {
                assistantMessage,
                task: completedTask,
                latestTask: completedTask,
                sessionId,
                messages: stateStore.getMessages(sessionId),
                contextInfo: stateStore.getSessionContext(sessionId),
                runtime: runtimeAdapter.getRuntimeStatus()
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const language = resolveTaskLanguage(prompt, settings);
            const humanMessage = humanizeTaskFailureMessage(message, language);
            const currentTask = stateStore.getTask(task.id);
            const failedTask = stateStore.completeTask(
                task.id,
                isStandardTaskEngine(task)
                    ? buildStandardRuntimeFailurePatch(currentTask, humanMessage)
                    : {
                          status: "failed",
                          response: message,
                          taskEngine: COMPATIBILITY_TASK_ENGINE,
                          phase: "failed",
                          mode: currentTask?.mode || "recover",
                          currentAction: null,
                          resultSummary: humanMessage,
                          evidenceState: resolveFailureEvidenceState(currentTask),
                          verify: currentTask?.verify || null
                      }
            );
            const failureText =
                language === "ru" ? `Ошибка выполнения: ${humanMessage}` : `Runtime error: ${humanMessage}`;
            const assistantMessage = stateStore.appendMessage(sessionId, "agent", failureText, {
                taskId: task.id,
                taskState: buildTaskStateView(failedTask),
                blocks: buildAssistantBlocks({
                    task: failedTask,
                    content: failureText,
                    toolCalls: [],
                    language,
                    workspace
                })
            });

            publishTaskEvent(task.id, "task.failed", {
                assistantMessage,
                task: failedTask,
                latestTask: failedTask,
                sessionId,
                messages: stateStore.getMessages(sessionId),
                contextInfo: stateStore.getSessionContext(sessionId),
                runtime: runtimeAdapter.getRuntimeStatus(),
                error: message
            });
        } finally {
            runningTasks.delete(task.id);
        }
    })();

    runningTasks.set(task.id, runPromise);
    return runPromise;
}
