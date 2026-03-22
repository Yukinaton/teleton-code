import { basename } from "node:path";
import { getCodeAgentToolKind } from "../../../lib/code-agent-surface.js";

export const FAILURE_TYPES = Object.freeze({
    INVALID_EDIT_FORMAT: "invalid_edit_format",
    TOOL_EXECUTION_FAILED: "tool_execution_failed",
    VERIFICATION_FAILED: "verification_failed",
    ARTIFACT_MISSING: "artifact_missing",
    CLAIM_MISMATCH: "claim_mismatch",
    SCOPE_VIOLATION: "scope_violation",
    APPROVAL_BLOCKED: "approval_blocked",
    INTERRUPTED: "interrupted",
    TIMED_OUT: "timed_out",
    LOOP_STALLED: "loop_stalled"
});

function normalizeCommand(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function buildCriticalFailureKey(event, verifyCommands = []) {
    const kind = getCodeAgentToolKind(event?.name);
    if (!kind) {
        return null;
    }

    const params = event?.params || event?.input || {};
    const result = event?.result || {};
    const path =
        params.path ||
        params.targetPath ||
        params.targetFile ||
        params.from ||
        params.to ||
        result.path ||
        result.relativePath ||
        result?.data?.path ||
        result?.data?.relativePath ||
        result.deleted ||
        result.from ||
        result.to ||
        "";

    if (["write", "destructive"].includes(kind) && path) {
        return `${kind}:${String(path).replace(/\\/g, "/").toLowerCase()}`;
    }

    const command = normalizeCommand(params.command || result?.data?.command || result.command || "");
    if (kind === "shell") {
        if (command && verifyCommands.some((candidate) => normalizeCommand(candidate) === command)) {
            return `verify:${command}`;
        }
        return command ? `shell:${command}` : `shell:${event?.name || "unknown"}`;
    }

    if (kind === "verify") {
        return command ? `verify:${command}` : `verify:${event?.name || "unknown"}`;
    }

    return null;
}

function collectResolvedCriticalKeys(toolCalls = [], verifyCommands = []) {
    const resolved = new Set();

    for (const toolCall of toolCalls) {
        const key = buildCriticalFailureKey(toolCall, verifyCommands);
        if (key) {
            resolved.add(key);
        }
    }

    return resolved;
}

function collectUnresolvedCriticalFailures(failedToolEvents = [], toolCalls = [], verifyCommands = []) {
    const resolvedKeys = collectResolvedCriticalKeys(toolCalls, verifyCommands);

    return failedToolEvents.filter((event) => {
        const key = buildCriticalFailureKey(event, verifyCommands);
        const kind = getCodeAgentToolKind(event?.name);
        if (!kind) {
            return false;
        }

        if (kind === "verify") {
            return false;
        }

        if (kind === "shell" && key && key.startsWith("verify:")) {
            return false;
        }

        return !key || !resolvedKeys.has(key);
    });
}

function summarizeCriticalFailures(events = []) {
    const details = new Set();

    for (const event of events) {
        const params = event?.params || event?.input || {};
        const path =
            params.path ||
            params.targetPath ||
            params.targetFile ||
            event?.result?.path ||
            event?.result?.relativePath ||
            event?.result?.data?.path ||
            "";
        const command = params.command || event?.result?.data?.command || event?.result?.command || "";
        details.add(path || command || event?.name || "unknown");
    }

    return [...details].slice(0, 4).join(", ");
}

function classifyRuntimeError(error) {
    const message = String(error?.message || error || "").trim();
    if (!message) {
        return [];
    }

    if (/timed out/i.test(message)) {
        return [{ type: FAILURE_TYPES.TIMED_OUT, message, recoverable: false }];
    }

    if (/interrupted|terminated|aborted/i.test(message)) {
        return [{ type: FAILURE_TYPES.INTERRUPTED, message, recoverable: false }];
    }

    if (/loop stall/i.test(message)) {
        return [{ type: FAILURE_TYPES.LOOP_STALLED, message, recoverable: false }];
    }

    return [{ type: FAILURE_TYPES.TOOL_EXECUTION_FAILED, message, recoverable: true }];
}

function classifyProblemText(problem) {
    const message = String(problem || "").trim();
    const lower = message.toLowerCase();

    if (!message) {
        return null;
    }

    if (/serialized|structured data instead of code|serialized array instead of code|serialized object data/i.test(lower)) {
        return {
            type: FAILURE_TYPES.INVALID_EDIT_FORMAT,
            message,
            recoverable: true
        };
    }

    if (/missing/i.test(lower)) {
        return {
            type: FAILURE_TYPES.ARTIFACT_MISSING,
            message,
            recoverable: true
        };
    }

    if (/claim/i.test(lower) || /did not match/i.test(lower)) {
        return {
            type: FAILURE_TYPES.CLAIM_MISMATCH,
            message,
            recoverable: true
        };
    }

    return {
        type: FAILURE_TYPES.VERIFICATION_FAILED,
        message,
        recoverable: true
    };
}

function classifyScopeProblems(scopeIssues = []) {
    return scopeIssues
        .map((issue) => String(issue || "").trim())
        .filter(Boolean)
        .map((message) => ({
            type: FAILURE_TYPES.SCOPE_VIOLATION,
            message,
            recoverable: false
        }));
}

export function buildFailures({
    error = null,
    verification = null,
    validationProblems = [],
    alignmentProblems = [],
    scopeIssues = [],
    failedToolEvents = [],
    toolCalls = [],
    verifyCommands = [],
    approvalActive = false
} = {}) {
    const failures = [];
    const seen = new Set();

    const pushFailure = (failure) => {
        if (!failure?.type || !failure?.message) {
            return;
        }
        const key = `${failure.type}:${failure.message}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        failures.push(failure);
    };

    for (const failure of classifyRuntimeError(error)) {
        pushFailure(failure);
    }

    if (approvalActive) {
        pushFailure({
            type: FAILURE_TYPES.APPROVAL_BLOCKED,
            message: "Execution is paused pending owner approval.",
            recoverable: false
        });
    }

    if (verification?.status === "failed" && verification?.reason) {
        pushFailure({
            type: FAILURE_TYPES.VERIFICATION_FAILED,
            message: String(verification.reason),
            recoverable: true
        });
    }

    for (const problem of [...validationProblems, ...alignmentProblems]) {
        pushFailure(classifyProblemText(problem));
    }

    for (const failure of classifyScopeProblems(scopeIssues)) {
        pushFailure(failure);
    }

    const unresolvedCriticalFailures = collectUnresolvedCriticalFailures(
        failedToolEvents,
        toolCalls,
        verifyCommands
    );

    if (unresolvedCriticalFailures.length > 0) {
        pushFailure({
            type: FAILURE_TYPES.TOOL_EXECUTION_FAILED,
            message: `Critical tool failures remained unresolved: ${summarizeCriticalFailures(unresolvedCriticalFailures) || basename(String(unresolvedCriticalFailures[0]?.name || "tool"))}`,
            recoverable: true
        });
    }

    return failures;
}

export function hasRecoverableFailures(failures = []) {
    return failures.some((failure) => failure?.recoverable === true);
}

export function summarizeFailures(failures = []) {
    return failures
        .map((failure) => String(failure?.message || "").trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" | ");
}
