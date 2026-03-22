import test from "node:test";
import assert from "node:assert/strict";
import { runClarifyStage } from "../../server/application/code-agent/stages/clarify.js";

test("clarify stage retries once and falls back to a generic question", async () => {
    let attempts = 0;

    const result = await runClarifyStage({
        callStructuredChat: async () => {
            attempts += 1;
            return "";
        },
        prompt: "do something",
        taskLanguage: "en",
        groundingResult: {
            reason: "missing detail"
        }
    });

    assert.equal(attempts, 2);
    assert.ok(result.content.includes("Please clarify"));
    assert.ok(result.content.trim().endsWith("?"));
});

test("clarify stage sends explicit IDE runtime context to the structured model", async () => {
    let seenSystemPrompt = "";

    await runClarifyStage({
        callStructuredChat: async (systemPrompt) => {
            seenSystemPrompt = systemPrompt;
            return "Which file should I change?";
        },
        prompt: "do something",
        taskLanguage: "en",
        groundingResult: {
            reason: "missing detail"
        }
    });

    assert.match(seenSystemPrompt, /Teleton Code IDE chat/i);
    assert.match(seenSystemPrompt, /not happening inside Telegram/i);
});
