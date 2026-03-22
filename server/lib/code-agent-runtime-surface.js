export function buildCodeAgentRuntimeSurfaceLines() {
    return [
        "Active runtime surface: Teleton Code IDE chat.",
        "Owner channel: local IDE project/chat workflow on the same machine.",
        "This conversation is not happening inside Telegram.",
        "Telegram messaging surfaces and Telegram-assistant assumptions are not active in this runtime.",
        "Base Teleton identity documents describe the shared platform, but they do not override the active IDE surface for this turn."
    ];
}

export function buildCodeAgentRuntimeSurfaceText() {
    return buildCodeAgentRuntimeSurfaceLines().join("\n");
}
