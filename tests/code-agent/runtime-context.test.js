import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCodeAgentSoulText } from "../../server/lib/code-agent-workspace.js";
import { runExecuteStage } from "../../server/application/code-agent/stages/execute.js";

function createConfig(root) {
    return {
        runtime: {
            teletonRoot: root,
            teletonWorkspaceRoot: join(root, "workspace"),
            ideWorkspaceRoot: join(root, "workspace", "ide"),
            ideCodeAgentRoot: join(root, "workspace", "ide", "code-agent"),
            ideProjectsMetaRoot: join(root, "workspace", "ide", "projects"),
            ideChatsMetaRoot: join(root, "workspace", "ide", "chats")
        }
    };
}

test("code-agent soul fixes the active runtime surface to the IDE", () => {
    const root = mkdtempSync(join(tmpdir(), "teleton-code-soul-"));

    try {
        const soul = buildCodeAgentSoulText(createConfig(root), {});
        assert.match(soul, /Current Runtime Surface/);
        assert.match(soul, /Teleton Code IDE chat/i);
        assert.match(soul, /not happening inside Telegram/i);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("execute stage includes IDE runtime surface in the model prompt", async () => {
    let seenUserMessage = "";

    const adapter = {
        serviceConfig: {
            runtime: {
                maxTaskRuntimeMs: 1000
            }
        },
        async processAgentMessageWithBudget(request) {
            seenUserMessage = request.userMessage;
            return {
                content: "Acknowledged.",
                toolCalls: []
            };
        },
        db: null,
        teletonConfig: {}
    };

    const result = await runExecuteStage({
        adapter,
        chatId: "teleton-code:test-session",
        prompt: "Who are you?",
        settings: {},
        mode: "answer",
        responseLanguageInstruction: "Respond in English.",
        workspace: {
            path: "C:\\repo"
        },
        sessionContext: null,
        workspaceContext: null,
        projectInstructions: null,
        codeAgentProfile: {
            id: "teleton-code"
        }
    });

    assert.equal(result.content, "Acknowledged.");
    assert.match(seenUserMessage, /Runtime surface:/);
    assert.match(seenUserMessage, /Teleton Code IDE chat/i);
    assert.match(seenUserMessage, /not happening inside Telegram/i);
});
