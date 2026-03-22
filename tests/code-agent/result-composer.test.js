import test from "node:test";
import assert from "node:assert/strict";
import { createTaskState } from "../../server/application/code-agent/task-state.js";
import { composeTurnResult } from "../../server/application/code-agent/services/result-composer.js";

test("result composer preserves pause-resume contract fields", () => {
    const state = createTaskState({
        mode: "act",
        status: "running",
        stage: "verify",
        repairAttempts: 2,
        approval: {
            active: true,
            scope: "shell",
            pendingAction: {
                name: "code_run_command",
                params: {
                    command: "npm install"
                }
            }
        }
    });

    const result = composeTurnResult({
        status: "running",
        state,
        content: "Paused pending approval.",
        toolCalls: [],
        changedFiles: ["src/app.js"],
        verification: {
            status: "not_applicable",
            reason: "No checks were required."
        },
        failures: [],
        failedToolEvents: [
            {
                name: "code_patch_file",
                params: {
                    path: "src/app.js"
                },
                result: {
                    error: "write failed"
                }
            }
        ]
    });

    assert.equal(result.repairAttempts, 2);
    assert.equal(result.approval.active, true);
    assert.equal(result.failedToolEvents.length, 1);
    assert.equal(result.verify.status, "not_applicable");
});

test("result composer humanizes timeout failures for user-facing summaries", () => {
    const state = createTaskState({
        mode: "answer",
        status: "failed",
        stage: "finalize"
    });

    const result = composeTurnResult({
        status: "failed",
        state,
        failures: [
            {
                type: "timed_out",
                message: "Code agent grounding timed out after 35000ms",
                recoverable: false
            }
        ],
        taskLanguage: "en"
    });

    assert.equal(result.resultSummary, "The agent did not finish an internal step within 35000ms.");
});
