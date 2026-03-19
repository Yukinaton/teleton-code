export function nowIso() {
    return new Date().toISOString();
}

function trimExcerpt(text, limit = 160) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) {
        return "";
    }
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export function buildContextSummary(messages) {
    return messages
        .map((message) => {
            const label =
                message.role === "user"
                    ? "Owner"
                    : message.role === "agent"
                      ? "Agent"
                      : "System";
            return `- ${label}: ${trimExcerpt(message.text, 180)}`;
        })
        .filter(Boolean)
        .join("\n");
}
