import test from "node:test";
import assert from "node:assert/strict";
import {
    buildRejectedTurnResult,
    buildTaskPatchFromTurnResult,
    deriveEvidenceStateFromTurn,
    derivePhaseFromTurn,
    deriveTaskStatusFromTurn
} from "../../server/application/code-agent/task-projection.js";

test("task projection maps paused turn results to approval-facing task state", () => {
    const turn = {
        taskEngine: "standard",
        mode: "act",
        status: "running",
        stage: "execute",
        paused: true,
        approval: {
            active: true,
            scope: "shell",
            pendingAction: {
                name: "code_run_command",
                params: {
                    command: "npm install"
                }
            }
        },
        evidence: {
            writesConfirmed: true,
            requiredArtifactsPresent: null,
            checksPassed: null,
            claimMatchesEvidence: true,
            verificationMode: "best_effort"
        },
        currentAction: "Waiting for approval",
        resultSummary: "Waiting for approval",
        changedFiles: ["src/app.js"],
        failures: []
    };

    const patch = buildTaskPatchFromTurnResult({}, turn);

    assert.equal(deriveTaskStatusFromTurn(turn), "awaiting_approval");
    assert.equal(derivePhaseFromTurn(turn), "awaiting_approval");
    assert.equal(deriveEvidenceStateFromTurn(turn), "tool_confirmed");
    assert.equal(patch.status, "awaiting_approval");
    assert.equal(patch.phase, "awaiting_approval");
    assert.equal(patch.approvalScope, "shell");
    assert.deepEqual(patch.changedFiles, ["src/app.js"]);
  });

test("approval rejection keeps partial progress when evidence-supported work exists", () => {
    const rejected = buildRejectedTurnResult({
        taskEngine: "standard",
        mode: "act",
        status: "running",
        stage: "execute",
        paused: true,
        approval: {
            active: true,
            scope: "destructive",
            pendingAction: {
                name: "code_delete_path",
                params: {
                    path: "src/old.js"
                }
            }
        },
        content: "Partial result",
        changedFiles: ["src/app.js"]
    });

    assert.equal(rejected.paused, false);
    assert.equal(rejected.approval.active, false);
    assert.equal(rejected.status, "partial");
    assert.equal(rejected.stage, "finalize");
});
