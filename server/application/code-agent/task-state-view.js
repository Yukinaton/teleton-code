import {
    deriveEvidenceStateFromTurn,
    derivePhaseFromTurn,
    deriveTaskStatusFromTurn
} from "./task-projection.js";
import { isStandardTaskEngine, resolveTaskEngine } from "./task-engine.js";

export function buildTaskStateView(task) {
    if (!task) {
        return null;
    }

    const turn = isStandardTaskEngine(task) ? task.turn || null : null;
    const status = task.status || (turn ? deriveTaskStatusFromTurn(turn) : null);
    const phase = task.phase || (turn ? derivePhaseFromTurn(turn) : "idle");
    const approvalScope = ["shell", "destructive"].includes(String(task.approvalScope || ""))
        ? String(task.approvalScope)
        : ["shell", "destructive"].includes(String(turn?.approval?.scope || ""))
            ? String(turn.approval.scope)
            : null;
    const evidenceState = task.evidenceState || (turn ? deriveEvidenceStateFromTurn(turn) : "none");

    return {
        id: task.id,
        workspaceId: task.workspaceId || null,
        taskEngine: resolveTaskEngine(task),
        status,
        mode: task.mode || turn?.mode || null,
        phase,
        stage: task.stage || turn?.stage || null,
        currentAction: task.currentAction || turn?.currentAction || null,
        resultSummary: task.resultSummary || turn?.resultSummary || null,
        approvalScope,
        evidenceState,
        verify: task.verify || turn?.verify || null,
        repairAttempts: Number.isInteger(task.repairAttempts) ? task.repairAttempts : Number(turn?.repairAttempts) || 0,
        approval: task.approval || turn?.approval || null,
        evidence: task.evidence || turn?.evidence || null,
        scope: task.scope || turn?.scope || null,
        changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles : Array.isArray(turn?.changedFiles) ? turn.changedFiles : [],
        failures: Array.isArray(task.failures) ? task.failures : Array.isArray(turn?.failures) ? turn.failures : []
    };
}
