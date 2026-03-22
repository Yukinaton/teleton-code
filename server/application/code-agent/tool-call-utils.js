import { getCodeAgentToolKind } from "../../lib/code-agent-surface.js";

export function hasConfirmedFileWrites(toolCalls = []) {
    return toolCalls.some((toolCall) =>
        [
            "code_write_file",
            "code_write_file_lines",
            "code_write_json",
            "code_replace_text",
            "code_patch_file",
            "code_insert_block"
        ].includes(toolCall?.name)
    );
}

export function hasWriteTool(toolCalls = []) {
    return toolCalls.some((toolCall) =>
        [
            "code_write_file",
            "code_write_file_lines",
            "code_write_json",
            "code_make_dirs",
            "code_replace_text",
            "code_patch_file",
            "code_insert_block",
            "code_move_path",
            "code_delete_path"
        ].includes(toolCall?.name)
    );
}

export function collectChangedFilesFromToolCalls(toolCalls = []) {
    const changed = new Set();

    for (const toolCall of toolCalls) {
        if (
            ![
                "code_write_file",
                "code_write_file_lines",
                "code_write_json",
                "code_replace_text",
                "code_patch_file",
                "code_insert_block",
                "code_make_dirs",
                "code_move_path",
                "code_delete_path"
            ].includes(toolCall?.name)
        ) {
            continue;
        }

        const candidates = [
            toolCall?.input?.path,
            toolCall?.input?.targetPath,
            toolCall?.result?.path,
            toolCall?.result?.relativePath,
            toolCall?.result?.data?.path,
            toolCall?.result?.data?.relativePath,
            ...(Array.isArray(toolCall?.input?.paths) ? toolCall.input.paths : []),
            ...(Array.isArray(toolCall?.result?.files) ? toolCall.result.files : []),
            ...(Array.isArray(toolCall?.result?.data?.files) ? toolCall.result.data.files : [])
        ];

        for (const candidate of candidates) {
            if (typeof candidate !== "string" || !candidate.trim()) {
                continue;
            }
            const normalized = candidate.replace(/\\/g, "/").trim();
            if (!normalized || normalized === "." || normalized === "./") {
                continue;
            }
            changed.add(normalized);
        }
    }

    return [...changed];
}

function hasWriteLikeTool(toolCalls = []) {
    return toolCalls.some((toolCall) =>
        ["write", "shell", "destructive", "verify"].includes(getCodeAgentToolKind(toolCall?.name))
    );
}

function looksLikeCompletionNarrative(content) {
    const normalized = String(content || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(i created|i updated|i changed|i wrote|done|completed|implemented|finished|fixed|review findings)\b/.test(
        normalized
    );
}

function looksLikeClarifyingTurn(content, toolCalls = []) {
    const source = String(content || "").trim();
    if (!source || hasWriteLikeTool(toolCalls)) {
        return false;
    }

    const questionMarks = source.match(/\?/g) || [];
    if (questionMarks.length === 0) {
        return false;
    }

    const normalized = source.replace(/\s+/g, " ").trim();
    const sentenceCount = normalized
        .split(/[.!?]+/)
        .map((item) => item.trim())
        .filter(Boolean).length;

    if (sentenceCount > 8 || questionMarks.length > 4) {
        return false;
    }

    return !looksLikeCompletionNarrative(normalized);
}

export function inferMode(content, toolCalls = [], prompt = "", changedFiles = []) {
    if (looksLikeClarifyingTurn(content, toolCalls)) {
        return "clarify";
    }

    if (!hasWriteLikeTool(toolCalls) && changedFiles.length === 0 && /\?/.test(String(content || ""))) {
        return "clarify";
    }

    if (toolCalls.length === 0) {
        return /\?\s*$/.test(String(content || "").trim()) ? "clarify" : "answer";
    }

    const names = new Set(toolCalls.map((toolCall) => toolCall?.name).filter(Boolean));
    const lowerPrompt = String(prompt || "").toLowerCase();
    if (
        /\b(review|audit|code review)\b/i.test(lowerPrompt) ||
        /(\u0440\u0435\u0432\u044c\u044e|\u0430\u0443\u0434\u0438\u0442|\u0437\u0430\u043c\u0435\u0447\u0430\u043d|\u043d\u0430\u0439\u0434\u0438 \u043f\u0440\u043e\u0431\u043b\u0435\u043c)/i.test(lowerPrompt) ||
        /\bfindings\b/i.test(String(content || ""))
    ) {
        return "review";
    }

    if (
        [...names].every((name) =>
            /^code_(?:list_files|inspect_project|read_file|read_files|search_text|search_context|suggest_commands|git_status|git_diff|web_search)$/.test(
                name
            )
        )
    ) {
        return "inspect";
    }

    return "execute";
}

export function summarizeResult(content, changedFiles = [], verification = null) {
    const cleanContent = String(content || "").trim().replace(/\s+/g, " ");
    if (changedFiles.length > 0) {
        const suffix =
            verification?.status === "passed"
                ? "Verified after changes."
                : verification?.status === "failed"
                  ? "Verification failed."
                  : verification?.status === "not_applicable"
                    ? `Verification not applicable: ${verification.reason}`
                    : "";
        return `Changed ${changedFiles.slice(0, 4).join(", ")}.${suffix ? ` ${suffix}` : ""}`.trim();
    }

    if (!cleanContent) {
        return null;
    }

    return cleanContent.slice(0, 220);
}
