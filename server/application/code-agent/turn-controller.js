import { normalizeAgentContent } from "../../lib/format-utils.js";
import { buildResponseLanguageInstruction, resolveTaskLanguage } from "../../lib/language.js";
import { collectProjectInstructions } from "./project-instructions.js";
import {
    withTimeout,
    toolCallFromExecutedEvent,
    failedToolEventFromExecutedEvent
} from "./runtime-utils.js";
import {
    createTaskState,
    withStage,
    withMode,
    withStatus,
    withApprovalPause,
    clearApprovalPause,
    withEvidence,
    withScope,
    withSummary,
    incrementRepairAttempts,
    patchTaskState
} from "./task-state.js";
import {
    MAX_REPAIR_ATTEMPTS,
    assertStageTransition,
    canAttemptRepair,
    canResumeFromApproval
} from "./transitions.js";
import { createToolsPolicy } from "./policy/tools.js";
import { resolveApprovalRequest } from "./policy/approval.js";
import { resolveRuntimeBudget } from "./policy/runtime-budget.js";
import { captureBaselineWorkspaceState } from "./services/scope.js";
import { composeTurnResult } from "./services/result-composer.js";
import { hasRecoverableFailures, summarizeFailures } from "./services/failures.js";
import { runGroundingStage } from "./stages/grounding.js";
import { runClarifyStage } from "./stages/clarify.js";
import { runExecuteStage } from "./stages/execute.js";
import { runVerifyStage } from "./stages/verify.js";
import { runRepairStage } from "./stages/repair.js";
import { runFinalizeStage } from "./stages/finalize.js";

function resolveOwnerPrompt(prompt, settings) {
    return String(settings?.ownerPrompt || prompt || "").trim() || String(prompt || "").trim();
}

function createStateFromTurnResult(turnResult = {}) {
    return createTaskState({
        mode: turnResult?.mode,
        status: turnResult?.status,
        stage: turnResult?.stage,
        repairAttempts: Number(turnResult?.repairAttempts) || 0,
        approval: turnResult?.approval || null,
        evidence: turnResult?.evidence || null,
        scope: turnResult?.scope || null,
        summary: {
            currentAction: turnResult?.currentAction || null,
            resultSummary: turnResult?.resultSummary || null
        }
    });
}

function mergeToolCalls(baseToolCalls = [], executedToolCalls = [], responseToolCalls = []) {
    const nextToolCalls = executedToolCalls.length > 0 ? executedToolCalls : responseToolCalls;
    return [...baseToolCalls, ...nextToolCalls];
}

function mergeFailedToolEvents(baseFailedToolEvents = [], nextFailedToolEvents = []) {
    const merged = [];
    const seen = new Set();

    for (const event of [...baseFailedToolEvents, ...nextFailedToolEvents]) {
        const key = JSON.stringify({
            name: event?.name || null,
            params: event?.params || event?.input || {},
            error: event?.result?.error || event?.message || null
        });

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        merged.push(event);
    }

    return merged;
}

function buildRuntimeFailure(error) {
    const message = String(error?.message || error || "").trim() || "Unknown runtime failure";
    const lower = message.toLowerCase();
    let type = "tool_execution_failed";
    let recoverable = true;

    if (lower.includes("timed out")) {
        type = "timed_out";
        recoverable = false;
    } else if (/(interrupted|terminated|aborted)/i.test(message)) {
        type = "interrupted";
        recoverable = false;
    }

    return {
        type,
        message,
        recoverable
    };
}

function ensureApprovalBlockedFailure(failures = []) {
    if (failures.some((failure) => failure?.type === "approval_blocked")) {
        return failures;
    }

    return [
        ...failures,
        {
            type: "approval_blocked",
            message: "Execution is paused pending owner approval.",
            recoverable: false
        }
    ];
}

function buildContinuationContext(pausedTurn = {}) {
    const parts = [];

    if (pausedTurn?.resultSummary) {
        parts.push(`Confirmed progress so far: ${pausedTurn.resultSummary}`);
    }

    if (Array.isArray(pausedTurn?.changedFiles) && pausedTurn.changedFiles.length > 0) {
        parts.push(`Confirmed changed files so far: ${pausedTurn.changedFiles.join(", ")}`);
    }

    if (pausedTurn?.approval?.pendingAction?.name) {
        parts.push(`Previously paused risky action: ${pausedTurn.approval.pendingAction.name}`);
    }

    return parts.join("\n");
}

function localizeRuntimeLabel(taskLanguage = "en", key) {
    const table = {
        waiting_for_approval: {
            ru: "Ожидаю подтверждение",
            en: "Waiting for approval"
        },
        repairing_failures: {
            ru: "Исправляю формальные ошибки",
            en: "Repairing contract failures"
        },
        executing_turn: {
            ru: "Выполняю задачу",
            en: "Executing turn"
        },
        resuming_turn: {
            ru: "Продолжаю приостановленный ход",
            en: "Resuming paused turn"
        }
    };

    return table[key]?.[taskLanguage === "ru" ? "ru" : "en"] || table[key]?.en || null;
}

function buildTurnEnvironment(adapter, sessionId, prompt, settings) {
    const ownerPrompt = resolveOwnerPrompt(prompt, settings);
    const taskLanguage = resolveTaskLanguage(ownerPrompt, settings);
    const responseLanguageInstruction = buildResponseLanguageInstruction(ownerPrompt, settings);
    const chatId = adapter.sessionChatId(sessionId);
    const workspace = adapter.resolveWorkspaceForChatId(chatId);
    const allowWebSearch = Boolean(adapter.teletonConfig?.tavily_api_key);
    const sessionContext = adapter.stateStore.getSessionContext(sessionId);
    const workspaceContext = workspace
        ? adapter.stateStore.getWorkspaceContext(workspace.id, sessionId)
        : null;
    const projectInstructions = collectProjectInstructions(workspace, {
        systemInstructionsRoot: adapter?.serviceConfig?.runtime?.ideCodeAgentRoot || null
    });
    const runtimeBudget = resolveRuntimeBudget(adapter, {
        maxRepairAttempts: MAX_REPAIR_ATTEMPTS
    });

    return {
        ownerPrompt,
        taskLanguage,
        responseLanguageInstruction,
        chatId,
        workspace,
        allowWebSearch,
        sessionContext,
        workspaceContext,
        projectInstructions,
        runtimeBudget
    };
}

function registerWrappedTaskCallback({
    adapter,
    chatId,
    onTaskEvent,
    executedToolCalls,
    failedToolEvents,
    approvalRef
}) {
    const wrappedTaskCallback = async (event) => {
        const toolCall = toolCallFromExecutedEvent(event);
        if (toolCall) {
            executedToolCalls.push(toolCall);
        }

        const failedToolEvent = failedToolEventFromExecutedEvent(event);
        if (failedToolEvent) {
            failedToolEvents.push(failedToolEvent);
        }

        const permission = resolveApprovalRequest(event);
        if (permission) {
            approvalRef.current = permission;
        }

        await onTaskEvent(event);
    };

    adapter.seenSessionIds.add(chatId.replace(/^teleton-code:/, ""));
    adapter.registerTaskCallback(chatId, wrappedTaskCallback);
}

async function pauseWithProgress({
    state,
    adapter,
    chatId,
    ownerPrompt,
    content,
    settings,
    workspace,
    projectInstructions,
    toolCalls,
    failedToolEvents,
    verificationMode,
    taskLanguage
}) {
    const verificationBundle = await runVerifyStage({
        adapter,
        chatId,
        prompt: ownerPrompt,
        content,
        settings,
        mode: state.mode,
        workspace,
        projectInstructions,
        toolCalls,
        failedToolEvents,
        verificationMode,
        approval: state.approval,
        baselineWorkspaceState: state?.scope?.baselineWorkspaceState || null
    });

    const pausedState = withScope(
        withEvidence(state, verificationBundle.evidence),
        {
            outOfScopeDetected: verificationBundle.scopeIssues.length > 0
        }
    );

    return composeTurnResult({
        status: "running",
        state: pausedState,
        content,
        toolCalls,
        changedFiles: verificationBundle.changedFiles,
        verification: verificationBundle.verification,
        failures: ensureApprovalBlockedFailure(verificationBundle.failures),
        failedToolEvents,
        taskLanguage
    });
}

async function runPostExecutionLifecycle({
    state,
    adapter,
    chatId,
    ownerPrompt,
    content,
    settings,
    workspace,
    projectInstructions,
    responseLanguageInstruction,
    codeAgentProfile,
    toolCalls,
    failedToolEvents,
    approvalRef,
    runtimeBudget,
    verificationMode,
    taskLanguage
}) {
    if (approvalRef.current) {
        const pausedState = withSummary(
            withApprovalPause(state, approvalRef.current),
            {
                currentAction: localizeRuntimeLabel(taskLanguage, "waiting_for_approval")
            }
        );

        return pauseWithProgress({
            state: pausedState,
            adapter,
            chatId,
            ownerPrompt,
            content,
            settings,
            workspace,
            projectInstructions,
            toolCalls,
            failedToolEvents,
            verificationMode,
            taskLanguage
        });
    }

    assertStageTransition(state.stage, "verify");
    state = withStage(state, "verify");

    let verificationBundle = await runVerifyStage({
        adapter,
        chatId,
        prompt: ownerPrompt,
        content,
        settings,
        mode: state.mode,
        workspace,
        projectInstructions,
        toolCalls,
        failedToolEvents,
        verificationMode,
        approval: state.approval,
        baselineWorkspaceState: state?.scope?.baselineWorkspaceState || null
    });

    state = withEvidence(state, verificationBundle.evidence);
    state = withScope(state, {
        outOfScopeDetected: verificationBundle.scopeIssues.length > 0
    });

    let previousFailureSignature = summarizeFailures(verificationBundle.failures);
    let previousChangedFiles = [...verificationBundle.changedFiles];

    while (
        verificationBundle.failures.length > 0 &&
        hasRecoverableFailures(verificationBundle.failures) &&
        canAttemptRepair(state, {
            maxRepairAttempts: runtimeBudget.maxRepairAttempts
        })
    ) {
        assertStageTransition(state.stage, "repair");
        state = withStage(state, "repair");
        state = incrementRepairAttempts(state);
        state = withSummary(state, {
            currentAction: localizeRuntimeLabel(taskLanguage, "repairing_failures")
        });

        const repairResult = await runRepairStage({
            adapter,
            chatId,
            prompt: ownerPrompt,
            settings,
            failures: verificationBundle.failures,
            responseLanguageInstruction,
            projectInstructions,
            codeAgentProfile,
            repairAttempts: state.repairAttempts - 1
        });

        content = normalizeAgentContent(repairResult.content);
        toolCalls = mergeToolCalls(toolCalls, [], repairResult.toolCalls);

        if (approvalRef.current) {
            const pausedState = withSummary(
                withApprovalPause(state, approvalRef.current),
                {
                    currentAction: localizeRuntimeLabel(taskLanguage, "waiting_for_approval")
                }
            );

            return pauseWithProgress({
                state: pausedState,
                adapter,
                chatId,
                ownerPrompt,
                content,
                settings,
                workspace,
                projectInstructions,
                toolCalls,
                failedToolEvents,
                verificationMode,
                taskLanguage
            });
        }

        assertStageTransition(state.stage, "verify");
        state = withStage(state, "verify");

        const nextBundle = await runVerifyStage({
            adapter,
            chatId,
            prompt: ownerPrompt,
            content,
            settings,
            mode: state.mode,
            workspace,
            projectInstructions,
            toolCalls,
            failedToolEvents,
            verificationMode,
            approval: clearApprovalPause(state).approval,
            baselineWorkspaceState: state?.scope?.baselineWorkspaceState || null
        });

        state = withEvidence(state, nextBundle.evidence);
        state = withScope(state, {
            outOfScopeDetected: nextBundle.scopeIssues.length > 0
        });

        const nextFailureSignature = summarizeFailures(nextBundle.failures);
        const changedFilesMoved =
            nextBundle.changedFiles.length !== previousChangedFiles.length ||
            nextBundle.changedFiles.some((file) => !previousChangedFiles.includes(file));

        verificationBundle = nextBundle;

        if (nextFailureSignature === previousFailureSignature && !changedFilesMoved) {
            break;
        }

        previousFailureSignature = nextFailureSignature;
        previousChangedFiles = [...nextBundle.changedFiles];
    }

    assertStageTransition(state.stage, "finalize");
    state = withStage(state, "finalize");
    state = withSummary(state, {
        currentAction: null
    });

    const finalized = runFinalizeStage({
        state,
        content,
        changedFiles: verificationBundle.changedFiles,
        verification: verificationBundle.verification,
        failures: verificationBundle.failures
    });

    state = withStatus(state, finalized.status);

    return composeTurnResult({
        status: finalized.status,
        state,
        content,
        toolCalls,
        changedFiles: verificationBundle.changedFiles,
        verification: verificationBundle.verification,
        failures: verificationBundle.failures,
        failedToolEvents,
        taskLanguage
    });
}

export function createCodeAgentTurnController() {
    return {
        async processTurn({
            adapter,
            sessionId,
            prompt,
            onTaskEvent = async () => {},
            settings = {}
        }) {
            adapter.ensureQuotaAvailable();
            await adapter.ensureLoaded();

            const environment = buildTurnEnvironment(adapter, sessionId, prompt, settings);
            const {
                ownerPrompt,
                taskLanguage,
                responseLanguageInstruction,
                chatId,
                workspace,
                allowWebSearch,
                sessionContext,
                workspaceContext,
                projectInstructions,
                runtimeBudget
            } = environment;

            let state = createTaskState({
                mode: "answer",
                status: "running",
                stage: "grounding",
                scope: {
                    baselineWorkspaceState: captureBaselineWorkspaceState(workspace)
                }
            });

            const executedToolCalls = [];
            const failedToolEvents = [];
            const approvalRef = { current: null };

            registerWrappedTaskCallback({
                adapter,
                chatId,
                onTaskEvent,
                executedToolCalls,
                failedToolEvents,
                approvalRef
            });

            try {
                const groundingResult = await withTimeout(
                    runGroundingStage({
                        callStructuredChat: adapter.callStructuredChat.bind(adapter),
                        prompt: ownerPrompt,
                        historyPrompt: sessionContext?.recentOwnerTranscript || "",
                        workspace,
                        taskLanguage
                    }),
                    runtimeBudget.maxStructuredStageRuntimeMs,
                    "Code agent grounding"
                );

                state = withMode(state, groundingResult.mode);
                state = withEvidence(state, {
                    verificationMode: groundingResult.verificationMode
                });

                const toolsPolicy = createToolsPolicy({
                    settings,
                    allowWebSearch,
                    mode: groundingResult.mode
                });
                const codeAgentProfile = toolsPolicy.codeAgentProfile;
                adapter.toolRegistry.setChatProfile(chatId, codeAgentProfile);
                adapter.toolRegistry.setChatExecutionContract(chatId, {
                    verifyCommands: projectInstructions.verifyCommands,
                    setupCommands: projectInstructions.setupCommands
                });

                if (groundingResult.clarificationNeeded) {
                    assertStageTransition(state.stage, "clarify");
                    state = withStage(state, "clarify");

                    const clarification = await withTimeout(
                        runClarifyStage({
                            callStructuredChat: adapter.callStructuredChat.bind(adapter),
                            prompt: ownerPrompt,
                            taskLanguage,
                            groundingResult
                        }),
                        runtimeBudget.maxStructuredStageRuntimeMs,
                        "Code agent clarification"
                    );

                    runFinalizeStage({
                        state,
                        content: clarification.content,
                        forcedStatus: "clarification_required"
                    });

                    assertStageTransition(state.stage, "finalize");
                    state = withStage(state, "finalize");
                    state = withStatus(state, "clarification_required");
                    state = withSummary(state, {
                        currentAction: null,
                        resultSummary: clarification.content
                    });

                    return composeTurnResult({
                        status: "clarification_required",
                        state,
                        content: clarification.content,
                        toolCalls: [],
                        changedFiles: [],
                        verification: null,
                        failures: [],
                        failedToolEvents: [],
                        taskLanguage
                    });
                }

                assertStageTransition(state.stage, "execute");
                state = withStage(state, "execute");
                state = withSummary(state, {
                    currentAction: localizeRuntimeLabel(taskLanguage, "executing_turn")
                });

                const executionResult = await runExecuteStage({
                    adapter,
                    chatId,
                    prompt: ownerPrompt,
                    settings,
                    mode: groundingResult.mode,
                    responseLanguageInstruction,
                    workspace,
                    sessionContext,
                    workspaceContext,
                    projectInstructions,
                    codeAgentProfile
                });

                const content = normalizeAgentContent(executionResult.content);
                const toolCalls = mergeToolCalls([], executedToolCalls, executionResult.toolCalls);

                return runPostExecutionLifecycle({
                    state,
                    adapter,
                    chatId,
                    ownerPrompt,
                    content,
                    settings,
                    workspace,
                    projectInstructions,
                    responseLanguageInstruction,
                    codeAgentProfile,
                    toolCalls,
                    failedToolEvents,
                    approvalRef,
                    runtimeBudget,
                    verificationMode: groundingResult.verificationMode,
                    taskLanguage
                });
            } catch (error) {
                state = patchTaskState(state, {
                    stage: "finalize",
                    status: "failed",
                    summary: {
                        currentAction: null
                    }
                });

                return composeTurnResult({
                    status: "failed",
                    state,
                    content: "",
                    toolCalls: [...executedToolCalls],
                    changedFiles: [],
                    verification: null,
                    failures: [buildRuntimeFailure(error)],
                    failedToolEvents,
                    taskLanguage
                });
            } finally {
                adapter.clearTaskCallback(chatId);
                adapter.toolRegistry.clearChatProfile(chatId);
                adapter.toolRegistry.clearChatExecutionContract(chatId);
            }
        },

        async resumeTurn({
            adapter,
            sessionId,
            prompt,
            pausedTurn,
            onTaskEvent = async () => {},
            settings = {}
        }) {
            adapter.ensureQuotaAvailable();
            await adapter.ensureLoaded();

            let state = createStateFromTurnResult(pausedTurn);
            if (!canResumeFromApproval(state)) {
                throw new Error("The provided code-agent turn is not in an approval-paused state.");
            }

            const environment = buildTurnEnvironment(adapter, sessionId, prompt, settings);
            const {
                ownerPrompt,
                responseLanguageInstruction,
                chatId,
                workspace,
                allowWebSearch,
                sessionContext,
                workspaceContext,
                projectInstructions,
                runtimeBudget,
                taskLanguage
            } = environment;

            const executedToolCalls = [];
            const failedToolEvents = mergeFailedToolEvents(
                Array.isArray(pausedTurn?.failedToolEvents) ? pausedTurn.failedToolEvents : [],
                []
            );
            const approvalRef = { current: null };

            registerWrappedTaskCallback({
                adapter,
                chatId,
                onTaskEvent,
                executedToolCalls,
                failedToolEvents,
                approvalRef
            });

            try {
                state = withStage(clearApprovalPause(state), "execute");
                state = withStatus(state, "running");
                state = withSummary(state, {
                    currentAction: localizeRuntimeLabel(taskLanguage, "resuming_turn")
                });

                const toolsPolicy = createToolsPolicy({
                    settings,
                    allowWebSearch,
                    mode: state.mode
                });
                const codeAgentProfile = toolsPolicy.codeAgentProfile;
                adapter.toolRegistry.setChatProfile(chatId, codeAgentProfile);
                adapter.toolRegistry.setChatExecutionContract(chatId, {
                    verifyCommands: projectInstructions.verifyCommands,
                    setupCommands: projectInstructions.setupCommands
                });

                const executionResult = await runExecuteStage({
                    adapter,
                    chatId,
                    prompt: ownerPrompt,
                    settings,
                    mode: state.mode,
                    responseLanguageInstruction,
                    workspace,
                    sessionContext,
                    workspaceContext,
                    projectInstructions,
                    codeAgentProfile,
                    continuationContext: buildContinuationContext(pausedTurn)
                });

                const content = normalizeAgentContent(executionResult.content);
                const toolCalls = mergeToolCalls(
                    Array.isArray(pausedTurn?.toolCalls) ? pausedTurn.toolCalls : [],
                    executedToolCalls,
                    executionResult.toolCalls
                );

                return runPostExecutionLifecycle({
                    state,
                    adapter,
                    chatId,
                    ownerPrompt,
                    content,
                    settings,
                    workspace,
                    projectInstructions,
                    responseLanguageInstruction,
                    codeAgentProfile,
                    toolCalls,
                    failedToolEvents,
                    approvalRef,
                    runtimeBudget,
                    verificationMode: state?.evidence?.verificationMode || "best_effort",
                    taskLanguage
                });
            } catch (error) {
                state = patchTaskState(state, {
                    stage: "finalize",
                    status: "failed",
                    approval: {
                        active: false,
                        scope: null,
                        pendingAction: null
                    },
                    summary: {
                        currentAction: null
                    }
                });

                return composeTurnResult({
                    status: "failed",
                    state,
                    content: "",
                    toolCalls: Array.isArray(pausedTurn?.toolCalls) ? pausedTurn.toolCalls : [],
                    changedFiles: Array.isArray(pausedTurn?.changedFiles) ? pausedTurn.changedFiles : [],
                    verification: pausedTurn?.verify || null,
                    failures: [buildRuntimeFailure(error)],
                    failedToolEvents,
                    taskLanguage
                });
            } finally {
                adapter.clearTaskCallback(chatId);
                adapter.toolRegistry.clearChatProfile(chatId);
                adapter.toolRegistry.clearChatExecutionContract(chatId);
            }
        }
    };
}

export async function processCodeTurn(args) {
    const controller = createCodeAgentTurnController();
    return controller.processTurn(args);
}

export async function resumeCodeTurn(args) {
    const controller = createCodeAgentTurnController();
    return controller.resumeTurn(args);
}
