import { resolveTaskLanguage } from "./language.js";
import { isConsultationRequest, shouldUseConsultationMode } from "./prompt-engine.js";

export const runningTasks = new Map();

function describePendingAction(permissionRequest, language = "ru") {
    const toolName = permissionRequest?.name || "";
    const params = permissionRequest?.params || {};
    const path = params.path || params.targetPath || params.targetFile || "";
    const command = params.command || "";
    const paths = Array.isArray(params.paths) ? params.paths.filter(Boolean).join(", ") : "";

    if (["code_write_file", "code_write_file_lines", "code_write_json"].includes(toolName)) {
        if (language === "ru") {
            return path ? `изменением файла ${path}` : "изменением файла";
        }
        return path ? `modifying file ${path}` : "modifying a file";
    }

    if (["code_patch_file", "code_replace_text", "code_insert_block"].includes(toolName)) {
        if (language === "ru") {
            return path ? `правкой файла ${path}` : "правкой файла";
        }
        return path ? `editing file ${path}` : "editing a file";
    }

    if (toolName === "code_make_dirs") {
        if (language === "ru") {
            return paths ? `созданием каталогов ${paths}` : "созданием каталогов";
        }
        return paths ? `creating directories ${paths}` : "creating directories";
    }

    if (toolName === "code_run_command") {
        if (language === "ru") {
            return command ? `запуском команды ${command}` : "запуском команды";
        }
        return command ? `running command ${command}` : "running a command";
    }

    if (toolName === "code_install_dependencies") {
        return language === "ru" ? "установкой зависимостей" : "installing dependencies";
    }

    if (toolName === "code_delete_path" || toolName === "code_move_path") {
        if (language === "ru") {
            return path ? `изменением пути ${path}` : "изменением файлов проекта";
        }
        return path ? `changing path ${path}` : "changing project files";
    }

    return language === "ru" ? "следующим рабочим шагом" : "the next work step";
}

function looksLikeCapabilityOrConsultingQuestion(prompt) {
    const source = String(prompt || "");
    if (shouldUseConsultationMode(source) || isConsultationRequest(source)) {
        return true;
    }

    return /(what can you|what are you able|what kind of projects|what can you build|what can you create|tell me what you can|can you help me choose|что ты можешь|какие проекты|что умеешь|что лучше выбрать|можешь подсказать|что можно сделать)/i.test(
        source
    );
}

function findPermissionRequest(steps = []) {
    return [...steps]
        .reverse()
        .find(
            (step) =>
                step?.type === "tool_finished" &&
                step?.result?.requiresPermission === true
        ) || null;
}

export function looksLikeActionTask(prompt) {
    const source = String(prompt || "");
    if (looksLikeCapabilityOrConsultingQuestion(source)) {
        return false;
    }

    return /(build|create|implement|write|fix|update|add|develop|scaffold|setup|refactor|edit|change|patch|generate|run|test|install|lint|delete|remove|move|rename|созда|сдела|напиш|реализ|исправ|обнов|добав|запуст|проверь|тест|установ|удал|перемест|переимен)/i.test(
        source
    );
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

            const initialStepCount = Array.isArray(stateStore.getTask(task.id)?.steps)
                ? stateStore.getTask(task.id).steps.length
                : 0;

            const result = await runtimeAdapter.processSessionPrompt(
                sessionId,
                prompt,
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
            );

            const taskAfterRun = stateStore.getTask(task.id);
            const freshSteps = Array.isArray(taskAfterRun?.steps)
                ? taskAfterRun.steps.slice(initialStepCount)
                : [];
            const permissionRequest = findPermissionRequest(freshSteps);

            if (permissionRequest) {
                const language = resolveTaskLanguage(prompt, settings);
                const waitingTask = stateStore.updateTask(task.id, {
                    status: "awaiting_approval",
                    response: result.content,
                    permissionScope:
                        permissionRequest?.result?.approvalScope ||
                        taskAfterRun?.permissionScope ||
                        "task",
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
                    toolCalls: result.toolCalls,
                    blocks: buildPermissionBlocks(waitingTask, language, {
                        continuation: true,
                        blockedTool: permissionRequest?.name || null,
                        blockedParams: permissionRequest?.params || null,
                        approvalScope:
                            permissionRequest?.result?.approvalScope ||
                            permissionRequest?.approvalScope ||
                            "task",
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

            const completedTask = stateStore.completeTask(task.id, {
                status: "completed",
                toolCalls: result.toolCalls,
                response: result.content,
                workspaceName: workspace?.name || null
            });

            const assistantMessage = stateStore.appendMessage(sessionId, "agent", result.content, {
                taskId: task.id,
                toolCalls: result.toolCalls,
                blocks: buildAssistantBlocks({
                    task: completedTask,
                    content: result.content,
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
            const failedTask = stateStore.completeTask(task.id, {
                status: "failed",
                response: message
            });
            const language = resolveTaskLanguage(prompt, settings);
            const failureText =
                language === "ru" ? `Ошибка выполнения: ${message}` : `Runtime error: ${message}`;
            const assistantMessage = stateStore.appendMessage(sessionId, "agent", failureText, {
                taskId: task.id,
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
