import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodeAgentTurnController } from "../../server/application/code-agent/turn-controller.js";

function createAdapterStub(workspacePath) {
    const callbacks = new Map();
    let executionCount = 0;

    return {
        teletonConfig: {},
        serviceConfig: {
            runtime: {
                maxTaskRuntimeMs: 2000,
                maxShellTimeoutMs: 2000
            }
        },
        seenSessionIds: new Set(),
        stateStore: {
            getSessionContext() {
                return null;
            },
            getWorkspaceContext() {
                return null;
            }
        },
        toolRegistry: {
            setChatProfile() {},
            clearChatProfile() {},
            setChatExecutionContract() {},
            clearChatExecutionContract() {},
            async execute() {
                return {
                    success: true,
                    data: {
                        skipped: true,
                        reason: "No project verification commands were detected."
                    }
                };
            }
        },
        ensureQuotaAvailable() {},
        async ensureLoaded() {},
        sessionChatId(sessionId) {
            return `teleton-code:${sessionId}`;
        },
        resolveWorkspaceForChatId() {
            return {
                id: "workspace-1",
                path: workspacePath
            };
        },
        registerTaskCallback(chatId, callback) {
            callbacks.set(chatId, callback);
        },
        clearTaskCallback(chatId) {
            callbacks.delete(chatId);
        },
        async callStructuredChat(systemPrompt) {
            if (String(systemPrompt).includes("grounding stage")) {
                return JSON.stringify({
                    mode: "act",
                    clarificationNeeded: false,
                    clarificationQuestion: null,
                    verificationMode: "best_effort",
                    reason: "ready"
                });
            }

            throw new Error(`Unexpected structured chat call in test: ${systemPrompt}`);
        },
        async processAgentMessageWithBudget({ chatId }) {
            executionCount += 1;

            if (executionCount === 1) {
                const callback = callbacks.get(chatId);
                await callback({
                    type: "tool_finished",
                    name: "code_run_command",
                    params: {
                        command: "npm install"
                    },
                    result: {
                        requiresPermission: true,
                        approvalScope: "shell"
                    }
                });

                return {
                    content: "Paused pending approval.",
                    toolCalls: []
                };
            }

            return {
                content: "Completed after approval.",
                toolCalls: [
                    {
                        name: "code_make_dirs",
                        input: {
                            path: "generated"
                        },
                        result: {
                            path: "generated"
                        }
                    }
                ]
            };
        }
    };
}

test("controller pauses for approval and resumes to a completed result", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "teleton-code-agent-controller-"));

    try {
        const adapter = createAdapterStub(workspaceRoot);
        const controller = createCodeAgentTurnController();

        const paused = await controller.processTurn({
            adapter,
            sessionId: "session-1",
            prompt: "Create a small script and ask approval before risky commands."
        });

        assert.equal(paused.status, "running");
        assert.equal(paused.paused, true);
        assert.equal(paused.approval.active, true);
        assert.equal(paused.approval.scope, "shell");

        const resumed = await controller.resumeTurn({
            adapter,
            sessionId: "session-1",
            prompt: "Create a small script and ask approval before risky commands.",
            pausedTurn: paused
        });

        assert.equal(resumed.status, "completed");
        assert.equal(resumed.paused, false);
        assert.deepEqual(resumed.changedFiles, ["generated"]);
    } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
    }
});

test("controller fails deterministically when grounding exceeds the structured-stage timeout", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "teleton-code-agent-timeout-"));

    try {
        const adapter = {
            teletonConfig: {},
            serviceConfig: {
                runtime: {
                    maxTaskRuntimeMs: 50,
                    maxShellTimeoutMs: 2000
                }
            },
            seenSessionIds: new Set(),
            stateStore: {
                getSessionContext() {
                    return null;
                },
                getWorkspaceContext() {
                    return null;
                }
            },
            toolRegistry: {
                setChatProfile() {},
                clearChatProfile() {},
                setChatExecutionContract() {},
                clearChatExecutionContract() {}
            },
            ensureQuotaAvailable() {},
            async ensureLoaded() {},
            sessionChatId(sessionId) {
                return `teleton-code:${sessionId}`;
            },
            resolveWorkspaceForChatId() {
                return {
                    id: "workspace-1",
                    path: workspaceRoot
                };
            },
            registerTaskCallback() {},
            clearTaskCallback() {},
            async callStructuredChat() {
                return await new Promise(() => {});
            }
        };

        const controller = createCodeAgentTurnController();
        const result = await controller.processTurn({
            adapter,
            sessionId: "session-timeout",
            prompt: "what can you do?"
        });

        assert.equal(result.status, "failed");
        assert.equal(result.failures[0]?.type, "timed_out");
        assert.match(result.failures[0]?.message || "", /grounding/i);
    } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
    }
});
