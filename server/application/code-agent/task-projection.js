import { hasUserRelevantProgress } from "./services/evidence.js";
import { STANDARD_TASK_ENGINE, resolveTaskEngine } from "./task-engine.js";

function clearApproval(approval = null) {
    return {
        ...(approval && typeof approval === "object" ? approval : {}),
        active: false,
        scope: null,
        pendingAction: null
    };
}

export function deriveTaskStatusFromTurn(turn = null) {
    if (turn?.paused === true || turn?.approval?.active === true) {
        return "awaiting_approval";
    }

    return String(turn?.status || "").trim().toLowerCase() || "running";
}

export function derivePhaseFromTurn(turn = null) {
    const status = deriveTaskStatusFromTurn(turn);
    if (status === "awaiting_approval") {
        return "awaiting_approval";
    }

    if (status === "completed" || status === "partial" || status === "clarification_required") {
        return "completed";
    }

    if (status === "failed") {
        return "failed";
    }

    switch (String(turn?.stage || "")) {
        case "verify":
            return "verifying";
        case "repair":
            return "repairing";
        case "execute":
            return String(turn?.mode || "") === "inspect" ? "inspecting" : "editing";
        case "grounding":
        case "clarify":
        case "finalize":
        default:
            return "idle";
    }
}

export function deriveEvidenceStateFromTurn(turn = null) {
    if (turn?.evidence?.claimMatchesEvidence === false) {
        return "claim_mismatch";
    }

    if (turn?.verify?.status === "failed" || turn?.evidence?.checksPassed === false) {
        return "verify_failed";
    }

    if (turn?.verify?.status === "passed" || turn?.evidence?.checksPassed === true) {
        return "verify_passed";
    }

    if (turn?.evidence?.writesConfirmed === true) {
        return "tool_confirmed";
    }

    return "none";
}

export function buildTaskPatchFromTurnResult(task, turn = null) {
    if (!turn) {
        return {
            taskEngine: resolveTaskEngine(task, STANDARD_TASK_ENGINE),
            mode: task?.mode || null
        };
    }

    return {
        taskEngine: STANDARD_TASK_ENGINE,
        status: deriveTaskStatusFromTurn(turn),
        mode: turn.mode || task?.mode || null,
        stage: turn.stage || null,
        phase: derivePhaseFromTurn(turn),
        currentAction: turn.currentAction || null,
        resultSummary: turn.resultSummary || null,
        approvalScope: ["shell", "destructive"].includes(String(turn?.approval?.scope || ""))
            ? String(turn.approval.scope)
            : null,
        evidenceState: deriveEvidenceStateFromTurn(turn),
        verify: turn.verify || null,
        toolCalls: Array.isArray(turn.toolCalls) ? turn.toolCalls : [],
        response: String(turn.content || turn.resultSummary || "").trim() || null,
        approval: turn.approval || clearApproval(),
        evidence: turn.evidence || null,
        scope: turn.scope || null,
        repairAttempts: Number(turn.repairAttempts) || 0,
        changedFiles: Array.isArray(turn.changedFiles) ? turn.changedFiles : [],
        failures: Array.isArray(turn.failures) ? turn.failures : [],
        turn
    };
}

export function buildRejectedTurnResult(turn = null, language = "ru") {
    const message =
        language === "ru"
            ? "Продолжение было остановлено после отклонения разрешения."
            : "Execution stopped after approval was rejected.";

    if (!turn) {
        return {
            taskEngine: STANDARD_TASK_ENGINE,
            status: "failed",
            stage: "finalize",
            approval: clearApproval(),
            paused: false,
            currentAction: null,
            resultSummary: message,
            content: "",
            changedFiles: [],
            failures: []
        };
    }

    const baseTurn = {
        ...turn,
        paused: false,
        stage: "finalize",
        approval: clearApproval(turn.approval),
        currentAction: null
    };

    const finalStatus = hasUserRelevantProgress({
        mode: baseTurn.mode,
        changedFiles: baseTurn.changedFiles || [],
        content: baseTurn.content || ""
    })
        ? "partial"
        : "failed";

    return {
        ...baseTurn,
        status: finalStatus,
        resultSummary: message
    };
}
