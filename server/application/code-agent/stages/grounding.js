import { buildCodeAgentRuntimeSurfaceText } from "../../../lib/code-agent-runtime-surface.js";

function stripCodeFence(value) {
    const source = String(value || "").trim();
    const fencedMatch = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fencedMatch ? fencedMatch[1].trim() : source;
}

function parseJsonObject(value) {
    const source = stripCodeFence(value);

    try {
        return JSON.parse(source);
    } catch {
        const objectMatch = source.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
            return null;
        }

        try {
            return JSON.parse(objectMatch[0]);
        } catch {
            return null;
        }
    }
}

function normalizeMode(value) {
    return ["answer", "inspect", "act"].includes(String(value || "").trim().toLowerCase())
        ? String(value || "").trim().toLowerCase()
        : null;
}

function normalizeVerificationMode(value) {
    return ["required", "best_effort", "not_applicable"].includes(String(value || "").trim().toLowerCase())
        ? String(value || "").trim().toLowerCase()
        : "best_effort";
}

function looksLikeAnswerOnlyPrompt(prompt) {
    const source = String(prompt || "").trim().toLowerCase();
    if (!source) {
        return false;
    }

    if (/^(hi|hello|hey|yo|sup|привет|здравствуй|здравствуйте|добрый день|добрый вечер)[!.?]*$/i.test(source)) {
        return true;
    }

    const implementationIntent =
        /\b(create|build|implement|write|fix|refactor|generate|add|change|update|edit|review|inspect|debug)\b/i.test(source) ||
        /(сделай|создай|напиши|исправ|реализ|добав|измени|обнови|отрефактор|проверь|проинспект|почини|собери)/i.test(source);

    if (implementationIntent) {
        return false;
    }

    return (
        /\b(what can you do|who are you|how does .* work|how do you work|explain|help me understand)\b/i.test(source) ||
        /(что ты умеешь|кто ты|как это работает|как ты работаешь|объясни|расскажи)/i.test(source) ||
        /[?？]$/.test(source)
    );
}

function buildGroundingSystemPrompt() {
    return [
        "You are the grounding stage of a coding agent.",
        buildCodeAgentRuntimeSurfaceText(),
        "Decide only the operational turn mode and whether exactly one clarification question is required before acting.",
        "Do not choose stack, file names, architecture, or product template.",
        "Return JSON only with keys:",
        '- "mode": "answer" | "inspect" | "act"',
        '- "clarificationNeeded": boolean',
        '- "verificationMode": "required" | "best_effort" | "not_applicable"',
        '- "reason": short string',
        "Use mode=answer for direct explanation or advice.",
        "Use mode=inspect for repository inspection without edits.",
        "Use mode=act for create or modify implementation work.",
        "Ask for clarification only when one missing detail blocks reliable action now."
    ].join("\n");
}

function buildGroundingUserPrompt({ prompt, historyPrompt = "", workspace = null, taskLanguage = "en" }) {
    const parts = [
        `Owner language: ${taskLanguage}.`,
        `Workspace available: ${workspace?.path ? "yes" : "no"}.`,
        `Owner request:\n${String(prompt || "").trim()}`
    ];

    const history = String(historyPrompt || "").trim();
    if (history) {
        parts.push(`Recent owner context:\n${history}`);
    }

    return parts.join("\n\n");
}

export async function runGroundingStage({
    callStructuredChat,
    prompt,
    historyPrompt = "",
    workspace = null,
    taskLanguage = "en"
}) {
    const responseText = await callStructuredChat(
        buildGroundingSystemPrompt(),
        buildGroundingUserPrompt({
            prompt,
            historyPrompt,
            workspace,
            taskLanguage
        }),
        {
            temperature: 0,
            maxTokens: 600
        }
    );

    const parsed = parseJsonObject(responseText);
    if (!parsed || typeof parsed !== "object") {
        return {
            mode: "answer",
            clarificationNeeded: looksLikeAnswerOnlyPrompt(prompt) ? false : true,
            verificationMode: looksLikeAnswerOnlyPrompt(prompt) ? "not_applicable" : "best_effort",
            reason: "grounding_parse_fallback"
        };
    }

    const mode = normalizeMode(parsed.mode);
    if (!mode) {
        return {
            mode: "answer",
            clarificationNeeded: looksLikeAnswerOnlyPrompt(prompt) ? false : true,
            verificationMode: looksLikeAnswerOnlyPrompt(prompt)
                ? "not_applicable"
                : normalizeVerificationMode(parsed.verificationMode),
            reason: String(parsed.reason || "").trim() || "grounding_invalid_mode"
        };
    }

    return {
        mode,
        clarificationNeeded: mode === "answer" ? false : parsed.clarificationNeeded === true,
        verificationMode: normalizeVerificationMode(parsed.verificationMode),
        reason: String(parsed.reason || "").trim() || null
    };
}
