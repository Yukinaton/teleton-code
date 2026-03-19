export function promptLanguage(prompt) {
    return /\p{Script=Cyrillic}/u.test(String(prompt || "")) ? "ru" : "en";
}

export function resolveTaskLanguage(prompt, settings = {}) {
    if (settings?.language === "ru" || settings?.language === "en") {
        return settings.language;
    }
    return promptLanguage(prompt);
}

export function languageLabel(language) {
    return language === "ru" ? "Russian" : "English";
}
