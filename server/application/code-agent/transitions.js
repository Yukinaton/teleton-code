import { isApprovalPaused, isTerminalStatus } from "./task-state.js";

export const MAX_REPAIR_ATTEMPTS = 2;

const STAGE_TRANSITIONS = {
    grounding: new Set(["clarify", "execute", "finalize"]),
    clarify: new Set(["finalize"]),
    execute: new Set(["verify", "finalize"]),
    verify: new Set(["repair", "finalize"]),
    repair: new Set(["verify", "finalize"]),
    finalize: new Set()
};

export function canTransitionStage(fromStage, toStage) {
    const allowed = STAGE_TRANSITIONS[String(fromStage || "")];
    return Boolean(allowed && allowed.has(String(toStage || "")));
}

export function assertStageTransition(fromStage, toStage) {
    if (!canTransitionStage(fromStage, toStage)) {
        throw new Error(`Invalid code-agent stage transition: ${fromStage} -> ${toStage}`);
    }
}

export function canPauseForApproval(state) {
    return !isTerminalStatus(state?.status) && String(state?.stage || "") === "execute";
}

export function canResumeFromApproval(state) {
    return isApprovalPaused(state) && !isTerminalStatus(state?.status);
}

export function canAttemptRepair(state, { maxRepairAttempts = MAX_REPAIR_ATTEMPTS } = {}) {
    return !isApprovalPaused(state) && !isTerminalStatus(state?.status) && (Number(state?.repairAttempts) || 0) < maxRepairAttempts;
}

export function assertCanFinalize(state, nextStatus) {
    const normalized = String(nextStatus || "").trim().toLowerCase();

    if (normalized === "completed") {
        if (isApprovalPaused(state)) {
            throw new Error("Cannot finalize a code-agent turn as completed while approval is paused.");
        }
        if (state?.evidence?.claimMatchesEvidence === false) {
            throw new Error("Cannot finalize a code-agent turn as completed when claims do not match evidence.");
        }
    }

    if (normalized === "clarification_required" && String(state?.stage || "") !== "clarify") {
        throw new Error("Clarification-required finalization is only valid from the clarify stage.");
    }
}

export { isTerminalStatus };
