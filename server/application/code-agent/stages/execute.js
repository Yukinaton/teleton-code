import { normalizeAgentContent } from "../../../lib/format-utils.js";
import { buildCodeAgentRuntimeSurfaceText } from "../../../lib/code-agent-runtime-surface.js";
import { withActivityTimeout } from "../runtime-utils.js";
import { buildToolContext } from "../policy/tools.js";

function buildExecutionPrompt({
    prompt,
    mode,
    responseLanguageInstruction,
    workspace,
    sessionContext,
    workspaceContext,
    projectInstructions,
    continuationContext = null
}) {
    const parts = [
        `Owner request:\n${String(prompt || "").trim()}`,
        `Runtime surface:\n${buildCodeAgentRuntimeSurfaceText()}`,
        responseLanguageInstruction,
        [
            "Turn contract:",
            `- mode: ${mode}`,
            "- respect the current turn mode",
            "- use tools only when needed",
            "- keep scope minimal and coherent",
            "- do not claim unsupported work"
        ].join("\n")
    ];

    if (workspace?.path) {
        parts.push(`Workspace root: ${workspace.path}`);
    }

    if (projectInstructions?.instructionText) {
        parts.push(`Project instructions:\n${projectInstructions.instructionText}`);
    }

    const sessionSummary = String(sessionContext?.summary || "").trim();
    if (sessionSummary) {
        parts.push(`Recent chat context:\n${sessionSummary}`);
    }

    const lastTask = sessionContext?.lastTask || null;
    if (lastTask) {
        const lastTaskLines = [];
        if (lastTask.status) {
            lastTaskLines.push(`- status: ${lastTask.status}`);
        }
        if (lastTask.stage) {
            lastTaskLines.push(`- stage: ${lastTask.stage}`);
        }
        if (lastTask.resultSummary) {
            lastTaskLines.push(`- summary: ${lastTask.resultSummary}`);
        }
        if (Array.isArray(lastTask.changedFiles) && lastTask.changedFiles.length > 0) {
            lastTaskLines.push(`- changed files: ${lastTask.changedFiles.join(", ")}`);
        }
        if (lastTask.verifyStatus) {
            lastTaskLines.push(`- verification: ${lastTask.verifyStatus}`);
        }
        if (Array.isArray(lastTask.failureTypes) && lastTask.failureTypes.length > 0) {
            lastTaskLines.push(`- failure types: ${lastTask.failureTypes.join(", ")}`);
        }
        if (lastTaskLines.length > 0) {
            parts.push(`Latest session task:\n${lastTaskLines.join("\n")}`);
        }
    }

    const recentActivity = String(workspaceContext?.recentActivity || "").trim();
    if (recentActivity) {
        parts.push(`Recent project activity:\n${recentActivity}`);
    }

    const recentTaskActivity = String(workspaceContext?.recentTaskActivity || "").trim();
    if (recentTaskActivity) {
        parts.push(`Recent task outcomes in this project:\n${recentTaskActivity}`);
    }

    const continuation = String(continuationContext || "").trim();
    if (continuation) {
        parts.push(`Continuation context:\n${continuation}`);
    }

    return parts.join("\n\n");
}

export async function runExecuteStage({
    adapter,
    chatId,
    prompt,
    settings = {},
    mode = "act",
    responseLanguageInstruction,
    workspace,
    sessionContext = null,
    workspaceContext = null,
    projectInstructions = null,
    codeAgentProfile,
    continuationContext = null
}) {
    const response = await withActivityTimeout(
        () =>
            adapter.processAgentMessageWithBudget(
                {
                    chatId,
                    userMessage: buildExecutionPrompt({
                        prompt,
                        mode,
                        responseLanguageInstruction,
                        workspace,
                        sessionContext,
                        workspaceContext,
                        projectInstructions,
                        continuationContext
                    }),
                    userName: "Owner",
                    isGroup: true,
                    toolContext: buildToolContext({
                        adapter,
                        settings,
                        codeAgentProfile
                    })
                },
                { retryLabel: "Code agent execution" }
            ),
        adapter.serviceConfig.runtime.maxTaskRuntimeMs,
        "Code agent execution"
    );

    return {
        content: normalizeAgentContent(response?.content || ""),
        toolCalls: Array.isArray(response?.toolCalls) ? response.toolCalls : []
    };
}
