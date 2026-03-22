export const DEFAULT_RUNTIME_BUDGET = Object.freeze({
    maxRepairAttempts: 2,
    maxStructuredStageRuntimeMs: 35_000
});

export function resolveRuntimeBudget(adapter, overrides = {}) {
    const maxTaskRuntimeMs = Number(adapter?.serviceConfig?.runtime?.maxTaskRuntimeMs) || 90_000;
    const maxStructuredStageRuntimeMs = Math.max(
        5_000,
        Math.min(
            Number.isInteger(overrides.maxStructuredStageRuntimeMs) && overrides.maxStructuredStageRuntimeMs > 0
                ? overrides.maxStructuredStageRuntimeMs
                : DEFAULT_RUNTIME_BUDGET.maxStructuredStageRuntimeMs,
            maxTaskRuntimeMs
        )
    );

    return {
        maxTaskRuntimeMs,
        maxStructuredStageRuntimeMs,
        maxRepairAttempts:
            Number.isInteger(overrides.maxRepairAttempts) && overrides.maxRepairAttempts >= 0
                ? overrides.maxRepairAttempts
                : DEFAULT_RUNTIME_BUDGET.maxRepairAttempts
    };
}
