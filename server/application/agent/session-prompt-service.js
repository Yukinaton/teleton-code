import { normalizeAgentContent, looksMostlyEnglishV2 } from "../../lib/format-utils.js";
import {
    buildTaskPrompt,
    extractRequestedFileNames,
    isConsultationRequest,
    isGeneralCapabilityQuestion,
    needsClarificationV2,
    shouldForceExecutionV2,
    shouldUseConsultationMode
} from "../../lib/prompt-engine.js";
import { buildCodeAgentProfile } from "../../lib/code-agent-profile.js";
import { languageLabel, resolveTaskLanguage } from "../../lib/language.js";
import { validatePromptAlignment, validateWrittenFiles } from "../../lib/validation-engine.js";
import { runClarificationFlow } from "./clarification-flow.js";
import { isGreenfieldBuildRequest, runStructuredBuildFlowV2 } from "./structured-build-flow.js";

function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        Promise.resolve(promise)
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function createDummyBridge() {
    const unsupported = async () => {
        throw new Error("Telegram bridge operations not available in Teleton Code");
    };

    return {
        sendMessage: unsupported,
        setTyping: async () => {},
        sendReaction: unsupported,
        getMessages: unsupported,
        getClient: unsupported
    };
}

function toolCallFromExecutedEvent(event) {
    if (event?.type !== "tool_finished" || !event?.name) {
        return null;
    }

    if (event?.result?.requiresPermission === true || event?.result?.success === false) {
        return null;
    }

    return {
        name: event.name,
        input: event.params || {},
        result: event.result || {}
    };
}

export async function processSessionPrompt({
    adapter,
    sessionId,
    prompt,
    onTaskEvent,
    settings = {},
    logger = {}
}) {
    const language = resolveTaskLanguage(prompt, settings);
    const languageName = languageLabel(language);
    const consultationRequest = isConsultationRequest(prompt);
    const clarificationRequired = needsClarificationV2(prompt);
    const consultationMode = shouldUseConsultationMode(prompt);
    await adapter.ensureLoaded();
    const allowWebSearch = Boolean(adapter.teletonConfig?.tavily_api_key);
    const codeAgentProfile = buildCodeAgentProfile({
        ...settings,
        allowWebSearch,
        consultationOnly: consultationMode
    });
    adapter.ensureQuotaAvailable();

    const chatId = adapter.sessionChatId(sessionId);
    const workspace = adapter.resolveWorkspaceForChatId(chatId);
    const sessionContext = adapter.stateStore.getSessionContext(sessionId);
    const workspaceContext = workspace
        ? adapter.stateStore.getWorkspaceContext(workspace.id, sessionId)
        : null;
    const isolatedSurface = codeAgentProfile.contextPolicy?.isolateFromTeletonMemory === true;

    if (clarificationRequired) {
        adapter.seenSessionIds.add(sessionId);
        return runClarificationFlow({
            callStructuredChat: adapter.callStructuredChat.bind(adapter),
            prompt,
            languageName,
            workspace
        });
    }

    let permissionBarrier = null;
    const executedToolCalls = [];
    const failedToolEvents = [];
    const wrappedTaskCallback = async (event) => {
        if (event?.type === "tool_finished" && event?.result?.requiresPermission === true) {
            permissionBarrier = {
                name: event.name,
                scope: event.result.approvalScope || "task"
            };
        }

        const executedToolCall = toolCallFromExecutedEvent(event);
        if (executedToolCall) {
            executedToolCalls.push(executedToolCall);
        }

        if (event?.type === "tool_finished" && event?.result?.success === false) {
            failedToolEvents.push({
                name: event.name,
                params: event.params || {},
                error: String(event?.result?.error || "")
            });
        }

        await onTaskEvent(event);
    };
    adapter.registerTaskCallback(chatId, wrappedTaskCallback);
    adapter.toolRegistry.setChatProfile(chatId, codeAgentProfile);
    adapter.seenSessionIds.add(sessionId);

    try {
        if (isGreenfieldBuildRequest(prompt, workspace)) {
            const structuredResult = await runStructuredBuildFlowV2({
                serviceConfig: adapter.serviceConfig,
                toolRegistry: adapter.toolRegistry,
                callStructuredChat: adapter.callStructuredChat.bind(adapter),
                sessionId,
                prompt,
                settings,
                language,
                languageName,
                workspace,
                onTaskEvent: wrappedTaskCallback,
                sessionChatId: adapter.sessionChatId.bind(adapter),
                logger
            });

            return {
                content: normalizeAgentContent(structuredResult.content),
                toolCalls: structuredResult.toolCalls
            };
        }

        const response = await withTimeout(
            adapter.agent.processMessage({
                chatId,
                userMessage: buildTaskPrompt(prompt, workspace, sessionContext, workspaceContext, settings),
                userName: "Owner",
                isGroup: isolatedSurface,
                toolContext: {
                    bridge: createDummyBridge(),
                    db: adapter.db,
                    config: adapter.teletonConfig,
                    settings,
                    codeAgentProfile
                }
            }),
            adapter.serviceConfig.runtime.maxTaskRuntimeMs,
            "Agent execution"
        );

        const enabledToolNames = new Set(adapter.toolRegistry.getAll(chatId).map((tool) => tool.name));
        const initialToolCalls = (response.toolCalls || []).filter((toolCall) =>
            enabledToolNames.has(toolCall?.name)
        );
        const unsupportedToolCalls = [
            ...new Set(
                (response.toolCalls || [])
                    .map((toolCall) => toolCall?.name)
                    .filter((name) => name && !enabledToolNames.has(name))
            )
        ];

        let result = response;
        let combinedToolCalls = executedToolCalls.length > 0 ? [...executedToolCalls] : [...initialToolCalls];
        const isCapabilityQuestion = isGeneralCapabilityQuestion(prompt);
        const isHallucinating = shouldForceExecutionV2(prompt, result);
        const initialPermissionBarrier = permissionBarrier !== null;
        const validation =
            !isCapabilityQuestion && workspace
                ? initialPermissionBarrier
                    ? { problems: [] }
                    : await validateWrittenFiles(workspace, combinedToolCalls, adapter.serviceConfig)
                : { problems: [] };
        const alignmentProblems =
            !isCapabilityQuestion && workspace
                ? initialPermissionBarrier
                    ? []
                    : await validatePromptAlignment(
                          prompt,
                          workspace,
                          combinedToolCalls,
                          extractRequestedFileNames
                      )
                : [];
        const consultationViolation =
            consultationMode &&
            (combinedToolCalls.some((toolCall) => {
                const toolName = toolCall?.name || "";
                return ![
                    "code_list_files",
                    "code_inspect_project",
                    "code_read_file",
                    "code_read_files",
                    "code_search_text",
                    "code_search_context",
                    "code_suggest_commands",
                    "code_git_status",
                    "code_git_diff",
                    "code_web_search"
                ].includes(toolName);
            }) ||
                /(now i(?:'ll| will)|i(?:'ll| will) (?:create|write|implement|prepare)|starting by creating|С‚РµРїРµСЂСЊ .*СЃРѕР·РґР°Рј|СЃРµР№С‡Р°СЃ .*СЃРѕР·РґР°Рј|РЅР°С‡РЅСѓ СЃ СЃРѕР·РґР°РЅРёСЏ|РїРѕРґРіРѕС‚РѕРІР»СЋ СЃС‚СЂСѓРєС‚СѓСЂСѓ)/i.test(
                    String(result.content || "")
                ));
        const genericOrEmptyResponse =
            !String(result.content || "").trim() ||
            /(couldn't generate a response|please try again|РЅРµ СѓРґР°Р»РѕСЃСЊ СЃС„РѕСЂРјРёСЂРѕРІР°С‚СЊ РѕС‚РІРµС‚|РїРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅРѕРІР°)/i.test(
                String(result.content || "")
            );

        const serializedPayloadFailures = failedToolEvents.filter((event) =>
            /serialized json structure|serialized json array|plain source code|wrapper arrays or object dumps/i.test(
                event.error
            )
        );
        const serializedFailureCounts = serializedPayloadFailures.reduce((acc, event) => {
            const targetPath = event.params?.path || event.params?.targetFile || "unknown";
            acc[targetPath] = (acc[targetPath] || 0) + 1;
            return acc;
        }, {});
        const needsRepair =
            !initialPermissionBarrier &&
            !isCapabilityQuestion &&
            (validation.problems.length > 0 ||
                alignmentProblems.length > 0 ||
                unsupportedToolCalls.length > 0 ||
                consultationViolation ||
                genericOrEmptyResponse ||
                serializedPayloadFailures.length > 0 ||
                isHallucinating ||
                (language === "ru" && looksMostlyEnglishV2(result.content)));

        if (needsRepair) {
            if (typeof logger.info === "function") {
                logger.info("Running repair pass...");
            }

            let repairPrompt = "";

            if (unsupportedToolCalls.length > 0) {
                repairPrompt = consultationRequest
                    ? `You referenced unsupported tool names: ${unsupportedToolCalls.join(", ")}.
This request is consultation-only. Do not call tools unless a small read-only inspection is truly necessary.
Answer directly in ${languageName} and do not claim file creation or implementation.`
                    : `You referenced unsupported tool names: ${unsupportedToolCalls.join(", ")}.
Use only the exact enabled tools available in this IDE surface.
Do not mention unavailable tools in the final answer. Continue using supported tools only. Response must be in ${languageName}.`;
            } else if (consultationViolation) {
                repairPrompt = `The owner asked for consultation only, without changing files.
Your previous response drifted into execution or claimed implementation. Rewrite the answer as direct guidance only.
Do not call action tools. Response must be in ${languageName}.`;
            } else if (serializedPayloadFailures.length > 0) {
                const affectedFiles = [
                    ...new Set(
                        serializedPayloadFailures
                            .map((event) => event.params?.path || event.params?.targetFile || "")
                            .filter(Boolean)
                    )
                ];
                const repeatedAffectedFiles = affectedFiles.filter(
                    (file) => (serializedFailureCounts[file] || 0) >= 2
                );
                repairPrompt = `CRITICAL: your previous write attempts produced serialized data instead of raw source code.
Affected files: ${affectedFiles.join(", ") || "unknown"}.
Do not send JSON-like arrays, object dumps, or wrapped structures.
${repeatedAffectedFiles.length > 0 ? `You already repeated this failure for: ${repeatedAffectedFiles.join(", ")}. Do not retry the same pattern.` : ""}
If quoting is difficult, use code_write_file_lines and provide one plain source line per array item.
Repair the affected files now and respond in ${languageName}.`;
            } else if (isHallucinating) {
                const filesInText = extractRequestedFileNames(result.content);
                const writtenFiles = new Set();
                for (const toolCall of combinedToolCalls) {
                    if (!["code_write_file", "code_write_file_lines", "code_patch_file"].includes(toolCall.name)) {
                        continue;
                    }

                    try {
                        const args =
                            typeof toolCall.arguments === "string"
                                ? JSON.parse(toolCall.arguments)
                                : toolCall.args || toolCall.parameters || toolCall.arguments || {};
                        const filePath =
                            args.path || args.targetFile || args.TargetFile || args.target_file || "";
                        const fileName = filePath.split(/[\\/]/).pop();
                        if (fileName) {
                            writtenFiles.add(fileName);
                        }
                    } catch {}
                }
                const missing = filesInText.filter((file) => !writtenFiles.has(file));

                repairPrompt = `CRITICAL: You promised to create/modify files but failed to call tools! 
MISSING FILES: ${missing.join(", ") || "Action tools were not called"}
You MUST implement them NOW using code_write_file. DO NOT research anymore. DO NOT explain. JUST WRITE THE CODE.
Response must be in ${languageName}.`;
            } else if (genericOrEmptyResponse) {
                repairPrompt = consultationRequest
                    ? `Your previous answer was empty or generic.
Reply directly to the owner in ${languageName} with a concrete consultation answer.
Do not use vague fallback phrases like "please try again".`
                    : `Your previous final answer was empty or generic after execution.
Summarize the actual work precisely in ${languageName}, mention the real changed files, and do not use vague fallback phrases.
If the task is incomplete, finish it first before answering.`;
            } else {
                repairPrompt = `Fix these issues: ${[...validation.problems, ...alignmentProblems].join(", ")}. Ensure final response is in ${languageName}.`;
            }

            const repairedResult = await adapter.agent.processMessage({
                chatId,
                userMessage: repairPrompt,
                userName: "Owner",
                isGroup: isolatedSurface,
                toolContext: {
                    bridge: createDummyBridge(),
                    db: adapter.db,
                    config: adapter.teletonConfig,
                    settings,
                    codeAgentProfile
                }
            });
            const repairedToolCalls = (repairedResult.toolCalls || []).filter((toolCall) =>
                enabledToolNames.has(toolCall?.name)
            );
            combinedToolCalls =
                executedToolCalls.length > 0
                    ? [...executedToolCalls]
                    : [...combinedToolCalls, ...repairedToolCalls];
            result = {
                ...repairedResult,
                toolCalls: combinedToolCalls
            };
        } else {
            result = {
                ...result,
                toolCalls: combinedToolCalls
            };
        }

        if (permissionBarrier) {
            return {
                content: normalizeAgentContent(result.content),
                toolCalls: combinedToolCalls
            };
        }

        const finalValidation =
            !isCapabilityQuestion && workspace
                ? await validateWrittenFiles(workspace, combinedToolCalls, adapter.serviceConfig)
                : { problems: [] };
        const finalAlignmentProblems =
            !isCapabilityQuestion && workspace
                ? await validatePromptAlignment(
                      prompt,
                      workspace,
                      combinedToolCalls,
                      extractRequestedFileNames
                  )
                : [];
        const finalUnsupportedToolCalls = [
            ...new Set(
                (result.toolCalls || [])
                    .map((toolCall) => toolCall?.name)
                    .filter((name) => name && !enabledToolNames.has(name))
            )
        ];
        if (
            finalValidation.problems.length > 0 ||
            finalAlignmentProblems.length > 0 ||
            finalUnsupportedToolCalls.length > 0
        ) {
            throw new Error(
                [
                    finalValidation.problems.length > 0
                        ? `Final validation failed: ${finalValidation.problems.join("; ")}`
                        : null,
                    finalAlignmentProblems.length > 0
                        ? `Prompt alignment failed: ${finalAlignmentProblems.join("; ")}`
                        : null,
                    finalUnsupportedToolCalls.length > 0
                        ? `Unsupported tools referenced: ${finalUnsupportedToolCalls.join(", ")}`
                        : null
                ]
                    .filter(Boolean)
                    .join(" | ")
            );
        }

        return {
            content: normalizeAgentContent(result.content),
            toolCalls: combinedToolCalls
        };
    } finally {
        adapter.toolRegistry.clearChatProfile(chatId);
        adapter.clearTaskCallback(chatId);
    }
}
