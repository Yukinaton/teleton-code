import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { resolveInsideWorkspace } from "../../lib/workspace-utils.js";

const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 200_000;
const MAX_TOTAL_ATTACHMENT_BYTES = 500_000;
const SUPPORTED_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".csv",
    ".html",
    ".htm",
    ".css",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rb",
    ".php",
    ".java",
    ".kt",
    ".swift",
    ".go",
    ".rs",
    ".sh",
    ".ps1",
    ".sql",
    ".env",
    ".ini",
    ".toml",
    ".log"
]);

function sanitizeFileName(name, fallback) {
    const base = basename(String(name || fallback || "attachment.txt")).replace(/[\x00-\x1F\x7F]/g, "");
    const sanitized = base
        .replace(/[\\/:"*?<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim();
    return sanitized || fallback || "attachment.txt";
}

function ensureAttachmentPayload(payload) {
    if (!Array.isArray(payload)) {
        return [];
    }

    if (payload.length > MAX_ATTACHMENTS) {
        throw new Error(`Too many attachments. Maximum allowed: ${MAX_ATTACHMENTS}`);
    }

    let totalBytes = 0;
    return payload.map((item, index) => {
        const name = sanitizeFileName(item?.name, `attachment-${index + 1}.txt`);
        const type = String(item?.type || "").trim();
        const size = Number.parseInt(item?.size, 10);
        const contentBase64 = String(item?.contentBase64 || "").trim();
        const extension = extname(name).toLowerCase();

        if (!SUPPORTED_EXTENSIONS.has(extension)) {
            throw new Error(`Unsupported attachment type: ${name}`);
        }

        if (!Number.isFinite(size) || size <= 0) {
            throw new Error(`Invalid attachment size: ${name}`);
        }

        if (size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`Attachment is too large: ${name}`);
        }

        if (!contentBase64) {
            throw new Error(`Attachment content is missing: ${name}`);
        }

        totalBytes += size;
        if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
            throw new Error("Attachments are too large in total");
        }

        return {
            name,
            type,
            size,
            contentBase64
        };
    });
}

export function persistChatAttachments(workspace, sessionId, payload = []) {
    const attachments = ensureAttachmentPayload(payload);
    if (!workspace || attachments.length === 0) {
        return [];
    }

    const storageRoot = `.teleton-code/attachments/${sessionId}`;
    const timestamp = Date.now();

    return attachments.map((attachment, index) => {
        const relativePath = `${storageRoot}/${timestamp}-${index + 1}-${attachment.name}`.replace(/\\/g, "/");
        const target = resolveInsideWorkspace(workspace.path, relativePath);
        const buffer = Buffer.from(attachment.contentBase64, "base64");

        mkdirSync(dirname(target.absolute), { recursive: true });
        writeFileSync(target.absolute, buffer);

        return {
            name: attachment.name,
            path: target.relativePath.replace(/\\/g, "/"),
            size: buffer.length,
            mimeType: attachment.type || "application/octet-stream"
        };
    });
}

export function buildPromptWithAttachments(text, attachments = [], language = "ru") {
    const normalizedText = String(text || "").trim();
    if (!attachments.length) {
        return normalizedText;
    }

    const attachmentLines = attachments.map((attachment) => `- ${attachment.path} (${attachment.name}, ${attachment.size} bytes)`);
    const lead =
        normalizedText ||
        (language === "ru"
            ? "Изучи прикрепленные файлы и помоги по задаче."
            : "Inspect the attached files and help with the task.");
    const header =
        language === "ru"
            ? "Прикрепленные файлы уже сохранены в workspace:"
            : "Attached files are already saved in the workspace:";
    const note =
        language === "ru"
            ? "Если задача относится к вложениям, сначала прочитай эти пути. Они могут не отображаться в общем дереве файлов."
            : "If the task depends on attachments, read these paths first. They may be hidden from the general file tree.";

    return [lead, "", header, ...attachmentLines, "", note].join("\n");
}
