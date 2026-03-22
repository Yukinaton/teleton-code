import { normalizeAgentContent } from "../../../lib/format-utils.js";
import { buildCodeAgentRuntimeSurfaceText } from "../../../lib/code-agent-runtime-surface.js";

function buildClarificationSystemPrompt(taskLanguage = "en") {
    return [
        "You are the clarification stage of a coding agent.",
        buildCodeAgentRuntimeSurfaceText(),
        "Ask exactly one focused question and nothing else.",
        "Do not repeat a choice that the owner has already clearly confirmed.",
        "Do not turn clarification into an interview.",
        `Write the question in ${taskLanguage === "ru" ? "Russian" : "English"}.`
    ].join("\n");
}

function buildClarificationRecoveryPrompt(taskLanguage = "en") {
    return [
        "Your previous clarification reply was empty or unusable.",
        buildCodeAgentRuntimeSurfaceText(),
        "Return exactly one short clarification question.",
        "Do not return markdown, bullets, or explanation.",
        "End with a question mark.",
        `Write the question in ${taskLanguage === "ru" ? "Russian" : "English"}.`
    ].join("\n");
}

function buildClarificationFallbackQuestion(taskLanguage = "en") {
    return taskLanguage === "ru"
        ? "Уточните, пожалуйста, какой именно результат или изменение вы хотите получить?"
        : "Please clarify the exact result or change you want to get?";
}

function buildClarificationUserPrompt({ prompt, groundingReason = null }) {
    const parts = [`Owner request:\n${String(prompt || "").trim()}`];

    if (groundingReason) {
        parts.push(`Reason clarification is needed:\n${String(groundingReason).trim()}`);
    }

    return parts.join("\n\n");
}

export async function runClarifyStage({
    callStructuredChat,
    prompt,
    taskLanguage = "en",
    groundingResult = null
}) {
    const userPrompt = buildClarificationUserPrompt({
        prompt,
        groundingReason: groundingResult?.reason || null
    });

    const requestQuestion = async (systemPrompt) => {
        const response = await callStructuredChat(systemPrompt, userPrompt, {
            temperature: 0.2,
            maxTokens: 220
        });

        return normalizeAgentContent(response).trim();
    };

    let content = await requestQuestion(buildClarificationSystemPrompt(taskLanguage));
    if (!content) {
        content = await requestQuestion(buildClarificationRecoveryPrompt(taskLanguage));
    }
    if (!content) {
        content = buildClarificationFallbackQuestion(taskLanguage);
    }

    return {
        content
    };
}
