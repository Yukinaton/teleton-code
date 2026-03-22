import test from "node:test";
import assert from "node:assert/strict";
import { runGroundingStage } from "../../server/application/code-agent/stages/grounding.js";

test("grounding parse fallback asks for clarification instead of defaulting to act", async () => {
    const result = await runGroundingStage({
        callStructuredChat: async () => "not-json",
        prompt: "do something",
        taskLanguage: "en"
    });

    assert.equal(result.mode, "answer");
    assert.equal(result.clarificationNeeded, true);
});

test("grounding treats a simple greeting as an answer turn", async () => {
    const result = await runGroundingStage({
        callStructuredChat: async () => "",
        prompt: "hi",
        taskLanguage: "en"
    });

    assert.equal(result.mode, "answer");
    assert.equal(result.clarificationNeeded, false);
    assert.equal(result.verificationMode, "not_applicable");
});

test("grounding invalid mode falls back to clarification instead of unsafe action", async () => {
    const result = await runGroundingStage({
        callStructuredChat: async () =>
            JSON.stringify({
                mode: "build_everything_now",
                clarificationNeeded: false,
                clarificationQuestion: null,
                verificationMode: "required",
                reason: "bad mode"
            }),
        prompt: "do something",
        taskLanguage: "en"
    });

    assert.equal(result.mode, "answer");
    assert.equal(result.clarificationNeeded, true);
    assert.equal(result.verificationMode, "required");
});

test("grounding forces answer turns to skip clarification", async () => {
    const result = await runGroundingStage({
        callStructuredChat: async () =>
            JSON.stringify({
                mode: "answer",
                clarificationNeeded: true,
                verificationMode: "not_applicable",
                reason: "direct answer"
            }),
        prompt: "who are you?",
        taskLanguage: "en"
    });

    assert.equal(result.mode, "answer");
    assert.equal(result.clarificationNeeded, false);
    assert.equal(result.verificationMode, "not_applicable");
});

test("grounding parse fallback answers directly for conversational prompts", async () => {
    const result = await runGroundingStage({
        callStructuredChat: async () => "",
        prompt: "hello what can you do?",
        taskLanguage: "en"
    });

    assert.equal(result.mode, "answer");
    assert.equal(result.clarificationNeeded, false);
    assert.equal(result.verificationMode, "not_applicable");
});

test("grounding sends explicit IDE runtime context to the structured model", async () => {
    let seenSystemPrompt = "";

    await runGroundingStage({
        callStructuredChat: async (systemPrompt) => {
            seenSystemPrompt = systemPrompt;
            return JSON.stringify({
                mode: "answer",
                clarificationNeeded: false,
                verificationMode: "not_applicable",
                reason: "direct answer"
            });
        },
        prompt: "who are you?",
        taskLanguage: "en"
    });

    assert.match(seenSystemPrompt, /Teleton Code IDE chat/i);
    assert.match(seenSystemPrompt, /not happening inside Telegram/i);
});
