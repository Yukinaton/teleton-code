import { summarizeFailures } from "./failures.js";
import { STANDARD_TASK_ENGINE } from "../task-engine.js";

function humanizeFailureMessage(message, taskLanguage = "en") {
    const source = String(message || "").trim();
    const timeoutMatch = source.match(/timed out after\s+(\d+)ms/i);
    if (timeoutMatch) {
        return taskLanguage === "ru"
            ? `Агент не успел завершить внутренний шаг за ${timeoutMatch[1]}мс.`
            : `The agent did not finish an internal step within ${timeoutMatch[1]}ms.`;
    }

    return source;
}

function summarizeHumanizedFailures(failures = [], taskLanguage = "en") {
    const rawSummary = summarizeFailures(failures);
    if (!rawSummary) {
        return "";
    }

    return rawSummary
        .split("|")
        .map((part) => humanizeFailureMessage(part, taskLanguage))
        .filter(Boolean)
        .join(" | ");
}

function buildVerificationSuffix(verification, taskLanguage = "en") {
    if (!verification) {
        return "";
    }

    if (verification.status === "passed") {
        return taskLanguage === "ru" ? " Проверка после изменений пройдена." : " Verified after changes.";
    }

    if (verification.status === "failed") {
        return taskLanguage === "ru"
            ? ` Проверка завершилась ошибкой: ${verification.reason || "неизвестная ошибка"}.`
            : ` Verification failed: ${verification.reason || "unknown error"}.`;
    }

    if (verification.status === "not_applicable" && verification.reason) {
        return taskLanguage === "ru"
            ? ` Проверка не применялась: ${verification.reason}.`
            : ` Verification not applicable: ${verification.reason}.`;
    }

    return "";
}

export function buildResultSummary({
    status,
    state,
    content = "",
    changedFiles = [],
    verification = null,
    failures = [],
    taskLanguage = "en"
} = {}) {
    if (status === "running" && state?.approval?.active === true) {
        return taskLanguage === "ru"
            ? "Ожидаю подтверждение перед следующим рискованным шагом."
            : "Waiting for approval before the next risky action.";
    }

    if (status === "completed" && changedFiles.length > 0) {
        return (
            taskLanguage === "ru"
                ? `Изменены ${changedFiles.slice(0, 4).join(", ")}.${buildVerificationSuffix(verification, taskLanguage)}`
                : `Changed ${changedFiles.slice(0, 4).join(", ")}.${buildVerificationSuffix(verification, taskLanguage)}`
        ).trim();
    }

    if (status === "partial" || status === "failed") {
        return summarizeHumanizedFailures(failures, taskLanguage) || String(content || "").trim().slice(0, 220) || null;
    }

    return String(content || "").trim().slice(0, 220) || null;
}

export function composeTurnResult({
    status,
    state,
    content = "",
    toolCalls = [],
    changedFiles = [],
    verification = null,
    failures = [],
    failedToolEvents = [],
    taskLanguage = "en"
} = {}) {
    const resultSummary = buildResultSummary({
        status,
        state,
        content,
        changedFiles,
        verification,
        failures,
        taskLanguage
    });

    return {
        taskEngine: STANDARD_TASK_ENGINE,
        content,
        toolCalls,
        mode: state?.mode || "act",
        status,
        stage: state?.stage || "finalize",
        approval: state?.approval || {
            active: false,
            scope: null,
            pendingAction: null
        },
        paused: state?.approval?.active === true,
        evidence: state?.evidence || null,
        scope: state?.scope || null,
        repairAttempts: Number(state?.repairAttempts) || 0,
        currentAction: state?.summary?.currentAction || null,
        resultSummary,
        verify: verification,
        failures,
        changedFiles,
        failedToolEvents
    };
}
