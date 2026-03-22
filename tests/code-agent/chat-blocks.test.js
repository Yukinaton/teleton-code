import test from "node:test";
import assert from "node:assert/strict";
import { buildAssistantBlocks, buildPermissionBlocks } from "../../server/lib/chat-blocks.js";

test("assistant blocks suppress synthetic success validation chatter", () => {
    const blocks = buildAssistantBlocks({
        task: {
            id: "task-1",
            workspaceId: "workspace-1",
            status: "completed",
            phase: "completed",
            taskEngine: "standard",
            verify: {
                status: "passed"
            },
            steps: [
                {
                    type: "tool_finished",
                    name: "code_run_check_suite",
                    result: {
                        exitCode: 0
                    }
                }
            ]
        },
        content: "## Summary\nCompleted the task.",
        toolCalls: [],
        language: "en",
        workspace: {
            id: "workspace-1"
        }
    });

    assert.equal(blocks.some((block) => block.type === "validation"), false);
});

test("assistant blocks mark standard-engine runtime errors as non-recoverable from the chat UI", () => {
    const blocks = buildAssistantBlocks({
        task: {
            id: "task-2",
            workspaceId: "workspace-2",
            status: "failed",
            phase: "failed",
            taskEngine: "standard",
            steps: []
        },
        content: "Runtime error: failed.",
        toolCalls: [],
        language: "en",
        workspace: {
            id: "workspace-2"
        }
    });

    const errorBlock = blocks.find((block) => block.type === "error");
    assert.ok(errorBlock);
    assert.equal(errorBlock.workspaceId, "workspace-2");
    assert.equal(errorBlock.recoveryAvailable, false);
    assert.match(errorBlock.description, /External recovery buttons/);
});

test("permission blocks keep workspace context for changed files", () => {
    const blocks = buildPermissionBlocks(
        {
            id: "task-3",
            workspaceId: "workspace-3",
            steps: [
                {
                    type: "tool_finished",
                    name: "code_write_file",
                    params: {
                        path: "src/app.js"
                    },
                    result: {
                        data: {
                            path: "src/app.js"
                        }
                    }
                }
            ]
        },
        "en"
    );

    const fileActions = blocks.find((block) => block.type === "file_actions");
    assert.ok(fileActions);
    assert.equal(fileActions.workspaceId, "workspace-3");
});
