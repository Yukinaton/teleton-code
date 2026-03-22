const MODES = new Set(["answer", "inspect", "act"]);
const STATUSES = new Set(["clarification_required", "running", "completed", "partial", "failed"]);
const STAGES = new Set(["grounding", "clarify", "execute", "verify", "repair", "finalize"]);
const VERIFICATION_MODES = new Set(["required", "best_effort", "not_applicable"]);

function cloneNested(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneNested(item));
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, cloneNested(nested)])
        );
    }

    return value;
}

function normalizeMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    return MODES.has(normalized) ? normalized : "answer";
}

function normalizeStatus(status) {
    const normalized = String(status || "").trim().toLowerCase();
    return STATUSES.has(normalized) ? normalized : "running";
}

function normalizeStage(stage) {
    const normalized = String(stage || "").trim().toLowerCase();
    return STAGES.has(normalized) ? normalized : "grounding";
}

function normalizeVerificationMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    return VERIFICATION_MODES.has(normalized) ? normalized : "best_effort";
}

export function createTaskState(overrides = {}) {
    const state = {
        mode: normalizeMode(overrides.mode),
        status: normalizeStatus(overrides.status),
        stage: normalizeStage(overrides.stage),
        repairAttempts: Number.isInteger(overrides.repairAttempts) ? overrides.repairAttempts : 0,
        approval: {
            active: overrides?.approval?.active === true,
            scope:
                ["shell", "destructive"].includes(String(overrides?.approval?.scope || ""))
                    ? String(overrides.approval.scope)
                    : null,
            pendingAction: overrides?.approval?.pendingAction || null
        },
        evidence: {
            writesConfirmed: overrides?.evidence?.writesConfirmed === true,
            requiredArtifactsPresent:
                typeof overrides?.evidence?.requiredArtifactsPresent === "boolean"
                    ? overrides.evidence.requiredArtifactsPresent
                    : null,
            checksPassed:
                typeof overrides?.evidence?.checksPassed === "boolean" ? overrides.evidence.checksPassed : null,
            claimMatchesEvidence:
                overrides?.evidence?.claimMatchesEvidence !== false,
            verificationMode: normalizeVerificationMode(overrides?.evidence?.verificationMode)
        },
        scope: {
            baselineWorkspaceState: overrides?.scope?.baselineWorkspaceState || null,
            allowedExpansion: "minimal",
            outOfScopeDetected: overrides?.scope?.outOfScopeDetected === true
        },
        summary: {
            currentAction: String(overrides?.summary?.currentAction || "").trim() || null,
            resultSummary: String(overrides?.summary?.resultSummary || "").trim() || null
        }
    };

    return state;
}

export function patchTaskState(state, patch = {}) {
    const current = createTaskState(state);

    return createTaskState({
        ...current,
        ...cloneNested(patch),
        approval: {
            ...current.approval,
            ...cloneNested(patch.approval || {})
        },
        evidence: {
            ...current.evidence,
            ...cloneNested(patch.evidence || {})
        },
        scope: {
            ...current.scope,
            ...cloneNested(patch.scope || {})
        },
        summary: {
            ...current.summary,
            ...cloneNested(patch.summary || {})
        }
    });
}

export function withStage(state, stage) {
    return patchTaskState(state, { stage });
}

export function withStatus(state, status) {
    return patchTaskState(state, { status });
}

export function withMode(state, mode) {
    return patchTaskState(state, { mode });
}

export function withSummary(state, { currentAction = undefined, resultSummary = undefined } = {}) {
    return patchTaskState(state, {
        summary: {
            ...(currentAction === undefined ? {} : { currentAction }),
            ...(resultSummary === undefined ? {} : { resultSummary })
        }
    });
}

export function withEvidence(state, evidencePatch = {}) {
    return patchTaskState(state, { evidence: evidencePatch });
}

export function withScope(state, scopePatch = {}) {
    return patchTaskState(state, { scope: scopePatch });
}

export function withApprovalPause(state, { scope = null, pendingAction = null } = {}) {
    return patchTaskState(state, {
        approval: {
            active: true,
            scope,
            pendingAction
        }
    });
}

export function clearApprovalPause(state) {
    return patchTaskState(state, {
        approval: {
            active: false,
            scope: null,
            pendingAction: null
        }
    });
}

export function incrementRepairAttempts(state) {
    return patchTaskState(state, {
        repairAttempts: (Number(state?.repairAttempts) || 0) + 1
    });
}

export function isApprovalPaused(state) {
    return state?.approval?.active === true;
}

export function isTerminalStatus(status) {
    return ["clarification_required", "completed", "partial", "failed"].includes(String(status || ""));
}
