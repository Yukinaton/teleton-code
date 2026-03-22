import test from "node:test";
import assert from "node:assert/strict";
import {
    canTransitionStage,
    assertStageTransition,
    canAttemptRepair,
    assertCanFinalize,
    MAX_REPAIR_ATTEMPTS
} from "../../server/application/code-agent/transitions.js";
import { createTaskState, withApprovalPause } from "../../server/application/code-agent/task-state.js";

test("transitions allow only declared stage hops", () => {
    assert.equal(canTransitionStage("grounding", "execute"), true);
    assert.equal(canTransitionStage("execute", "repair"), false);
    assert.throws(() => assertStageTransition("execute", "repair"));
});

test("repair attempts are bounded", () => {
    const allowed = createTaskState({
        stage: "verify",
        status: "running",
        repairAttempts: MAX_REPAIR_ATTEMPTS - 1
    });
    const blocked = createTaskState({
        stage: "verify",
        status: "running",
        repairAttempts: MAX_REPAIR_ATTEMPTS
    });

    assert.equal(canAttemptRepair(allowed), true);
    assert.equal(canAttemptRepair(blocked), false);
});

test("completed finalize is rejected while approval is paused", () => {
    const pausedState = withApprovalPause(
        createTaskState({
            stage: "finalize",
            status: "running"
        }),
        {
            scope: "shell",
            pendingAction: { name: "code_run_command" }
        }
    );

    assert.throws(() => assertCanFinalize(pausedState, "completed"));
});
