import { hasWriteTool } from "./tool-call-utils.js";

function normalizeVerifyCommand(command) {
    return String(command || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function summarizeCriticalFailures(failures = []) {
    return failures
        .map((failure) => String(failure?.message || failure?.name || "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
}

function collectUnresolvedCriticalFailures(failedToolEvents = [], toolCalls = []) {
    if (!Array.isArray(failedToolEvents) || failedToolEvents.length === 0) {
        return [];
    }

    const resolvedKeys = new Set(
        toolCalls
            .filter((toolCall) => toolCall?.result?.success !== false)
            .map((toolCall) =>
                JSON.stringify({
                    name: toolCall?.name || "",
                    path: toolCall?.input?.path || toolCall?.input?.targetPath || "",
                    command: toolCall?.input?.command || ""
                })
            )
    );

    return failedToolEvents.filter((event) => {
        const key = JSON.stringify({
            name: event?.name || "",
            path: event?.params?.path || event?.params?.targetPath || "",
            command: event?.params?.command || ""
        });
        return !resolvedKeys.has(key);
    });
}

export async function runVerificationGate({
    adapter,
    chatId,
    prompt,
    settings,
    projectInstructions,
    combinedToolCalls,
    failedToolEvents = []
}) {
    if (!hasWriteTool(combinedToolCalls)) {
        return {
            status: "not_applicable",
            reason: "No file changes were made.",
            knownCommands: projectInstructions.verifyCommands
        };
    }

    const criticalFailures = collectUnresolvedCriticalFailures(failedToolEvents, combinedToolCalls);
    if (criticalFailures.length > 0) {
        return {
            status: "not_applicable",
            reason: `Skipped verification because critical tool failures are still unresolved: ${summarizeCriticalFailures(criticalFailures) || "unknown action"}`,
            knownCommands: projectInstructions.verifyCommands
        };
    }

    const context = {
        chatId,
        prompt,
        settings,
        approved: Boolean(settings?.fullAccess),
        executionContract: {
            verifyCommands: projectInstructions.verifyCommands
        }
    };

    const runTool = async (name, argumentsPayload) =>
        adapter.toolRegistry.execute(
            {
                id: `verify-${Date.now()}-${name}`,
                name,
                arguments: argumentsPayload
            },
            context
        );

    const structuredResult = await runTool("code_run_check_suite", { maxCommands: 3 });
    if (structuredResult?.success === true && structuredResult?.data?.skipped === true) {
        return {
            status: "not_applicable",
            reason: String(structuredResult?.data?.reason || "No project verification commands were detected."),
            knownCommands: projectInstructions.verifyCommands
        };
    }
    if (structuredResult?.success === true) {
        return {
            status: "passed",
            tool: "code_run_check_suite",
            knownCommands: projectInstructions.verifyCommands
        };
    }

    const structuredReason = String(structuredResult?.error || "");
    if (
        projectInstructions.verifyCommands.length > 0 &&
        /No project check commands were detected/i.test(structuredReason)
    ) {
        const fallbackCommand = projectInstructions.verifyCommands[0];
        const fallbackResult = await runTool("code_run_command", {
            command: fallbackCommand
        });

        return fallbackResult?.success
            ? {
                  status: "passed",
                  tool: "code_run_command",
                  command: fallbackCommand,
                  knownCommands: projectInstructions.verifyCommands
              }
            : {
                  status: "failed",
                  tool: "code_run_command",
                  command: fallbackCommand,
                  reason: String(fallbackResult?.error || "Verification command failed"),
                  knownCommands: projectInstructions.verifyCommands
              };
    }

    if (/No project check commands were detected/i.test(structuredReason)) {
        return {
            status: "not_applicable",
            reason: structuredReason,
            knownCommands: projectInstructions.verifyCommands
        };
    }

    return {
        status: "failed",
        tool: "code_run_check_suite",
        reason: structuredReason || "Verification failed",
        knownCommands: projectInstructions.verifyCommands
    };
}

export function reconcileVerificationResult({
    verification,
    validationProblems = [],
    changedFiles = []
}) {
    if (changedFiles.length === 0) {
        return verification;
    }

    if (verification?.status === "passed" || verification?.status === "failed") {
        return verification;
    }

    if (validationProblems.length > 0) {
        return {
            status: "failed",
            tool: "built_in_validation",
            reason: validationProblems.slice(0, 3).join(" | "),
            knownCommands: verification?.knownCommands || []
        };
    }

    return {
        status: "passed",
        tool: "built_in_validation",
        reason: "Built-in source validation passed.",
        knownCommands: verification?.knownCommands || []
    };
}
