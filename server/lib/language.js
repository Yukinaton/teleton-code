function normalizePrompt(prompt) {
    return String(prompt || "").trim();
}

export function detectPromptLanguage(prompt) {
    const source = normalizePrompt(prompt);
    if (!source) {
        return null;
    }

    if (/\p{Script=Cyrillic}/u.test(source)) {
        return "ru";
    }

    return "en";
}

export function promptLanguage(prompt) {
    return detectPromptLanguage(prompt) || "en";
}

export function resolveTaskLanguage(prompt, settings = {}) {
    const detected = detectPromptLanguage(prompt);
    if (detected) {
        return detected;
    }

    if (settings?.language === "ru" || settings?.language === "en") {
        return settings.language;
    }

    return "en";
}

export function buildResponseLanguageInstruction(prompt, settings = {}) {
    const source = normalizePrompt(prompt);
    if (/\p{Script=Cyrillic}/u.test(source)) {
        return "Reply in Russian because the owner wrote in Russian. Do not switch to another language because of UI or system settings.";
    }

    if (source) {
        return "Reply in the same language as the owner's latest message. Do not switch languages because of UI or system settings.";
    }

    return settings?.language === "ru"
        ? "Reply in Russian."
        : "Reply in English.";
}

export function languageLabel(language) {
    return language === "ru" ? "Russian" : "English";
}
