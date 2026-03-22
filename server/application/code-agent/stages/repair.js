import { normalizeAgentContent } from "../../../lib/format-utils.js";
import { buildCodeAgentRuntimeSurfaceText } from "../../../lib/code-agent-runtime-surface.js";
import { withActivityTimeout } from "../runtime-utils.js";
import { buildToolContext } from "../policy/tools.js";
import { summarizeFailures } from "../services/failures.js";

function buildRepairPrompt({
    prompt,
    failures,
    responseLanguageInstruction,
    projectInstructions,
    repairAttempts = 0
}) {
    const parts = [
        `Owner request:\n${String(prompt || "").trim()}`,
        `Runtime surface:\n${buildCodeAgentRuntimeSurfaceText()}`,
        responseLanguageInstruction,
        `Repair attempt: ${repairAttempts + 1}.`,
        "The previous attempt did not satisfy the execution contract.",
        `Failure facts:\n${failures.map((failure) => `- ${failure.message}`).join("\n")}`,
        "Fix only the listed problems.",
        "Do not expand scope.",
        "Do not repeat the same unchanged action after the same failure."
    ];

    if (projectInstructions?.instructionText) {
        parts.push(`Project instructions:\n${projectInstructions.instructionText}`);
    }

    const summary = summarizeFailures(failures);
    if (summary) {
        parts.push(`Short failure summary:\n${summary}`);
    }

    return parts.join("\n\n");
}

export async function runRepairStage({
    adapter,
    chatId,
    prompt,
    settings = {},
    failures = [],
    responseLanguageInstruction,
    projectInstructions = null,
    codeAgentProfile,
    repairAttempts = 0
}) {
    const response = await withActivityTimeout(
        () =>
            adapter.processAgentMessageWithBudget(
                {
                    chatId,
                    userMessage: buildRepairPrompt({
                        prompt,
                        failures,
                        responseLanguageInstruction,
                        projectInstructions,
                        repairAttempts
                    }),
                    userName: "Owner",
                    isGroup: true,
                    toolContext: buildToolContext({
                        adapter,
                        settings,
                        codeAgentProfile
                    })
                },
                { retryLabel: "Code agent repair" }
            ),
        adapter.serviceConfig.runtime.maxTaskRuntimeMs,
        "Code agent repair"
    );

    return {
        content: normalizeAgentContent(response?.content || ""),
        toolCalls: Array.isArray(response?.toolCalls) ? response.toolCalls : []
    };
}
