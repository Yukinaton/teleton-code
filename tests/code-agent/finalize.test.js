import test from "node:test";
import assert from "node:assert/strict";
import { createTaskState } from "../../server/application/code-agent/task-state.js";
import { runFinalizeStage } from "../../server/application/code-agent/stages/finalize.js";

test("finalize chooses completed when evidence and progress are present", () => {
    const state = createTaskState({
        mode: "act",
        stage: "finalize",
        status: "running",
        evidence: {
            writesConfirmed: true,
            requiredArtifactsPresent: true,
            checksPassed: true,
            claimMatchesEvidence: true,
            verificationMode: "required"
        }
    });

    const result = runFinalizeStage({
        state,
        content: "Implemented the change.",
        changedFiles: ["src/app.js"],
        verification: { status: "passed" },
        failures: []
    });

    assert.equal(result.status, "completed");
});

test("finalize chooses partial when useful progress exists but failures remain", () => {
    const state = createTaskState({
        mode: "act",
        stage: "finalize",
        status: "running",
        evidence: {
            writesConfirmed: true,
            requiredArtifactsPresent: false,
            checksPassed: false,
            claimMatchesEvidence: true,
            verificationMode: "required"
        }
    });

    const result = runFinalizeStage({
        state,
        content: "Part of the work is done.",
        changedFiles: ["src/app.js"],
        verification: { status: "failed" },
        failures: [{ type: "verification_failed", message: "Syntax failed", recoverable: true }]
    });

    assert.equal(result.status, "partial");
});

test("finalize chooses failed when no useful progress exists", () => {
    const state = createTaskState({
        mode: "act",
        stage: "finalize",
        status: "running",
        evidence: {
            writesConfirmed: false,
            requiredArtifactsPresent: null,
            checksPassed: false,
            claimMatchesEvidence: false,
            verificationMode: "best_effort"
        }
    });

    const result = runFinalizeStage({
        state,
        content: "",
        changedFiles: [],
        verification: { status: "failed" },
        failures: [{ type: "claim_mismatch", message: "No supported result", recoverable: true }]
    });

    assert.equal(result.status, "failed");
});
