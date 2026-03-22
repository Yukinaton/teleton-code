import { json, notFound, badRequest } from "../lib/http-utils.js";
import { executeTask } from "../lib/task-orchestrator.js";
import { publishTaskEvent } from "../lib/sse-manager.js";
import { buildPromptWithAttachments, persistChatAttachments } from "../application/chat/attachment-service.js";
import { resolveTaskLanguage } from "../lib/language.js";
import { resolveTaskEngine } from "../application/code-agent/task-engine.js";

export function handleUpdateSession(sessionId, stateStore, body, response) {
    const session = stateStore.updateSession(sessionId, {
        title: body.title?.trim() || stateStore.getSession(sessionId)?.title
    });
    if (!session) {
        notFound(response, "Session not found");
        return false;
    }
    return true;
}

export function handleDeleteSession(sessionId, stateStore) {
    stateStore.deleteSession(sessionId);
    return true;
}

export async function handlePostMessage(sessionId, stateStore, runtimeAdapter, body, buildAssistantBlocks, buildPermissionBlocks, response) {
    const session = stateStore.getSession(sessionId);
    if (!session) return notFound(response, "Session not found");

    const rawText = typeof body.text === "string" ? body.text.trim() : "";
    const settings = body.settings || {};
    const promptLanguage = resolveTaskLanguage(rawText, settings);
    const workspace = stateStore.getWorkspace(session.workspaceId);
    let attachments = [];
    try {
        attachments = persistChatAttachments(workspace, sessionId, body.attachments || []);
    } catch (error) {
        return badRequest(
            response,
            error instanceof Error ? error.message : String(error)
        );
    }
    const text =
        rawText ||
        (attachments.length > 0
            ? promptLanguage === "en"
                ? `Attached files (${attachments.length})`
                : `Прикреплены файлы (${attachments.length})`
            : "");
    if (!text) return badRequest(response, "Message text or attachments are required");

    const taskSettings = {
        ...settings,
        ownerPrompt: rawText || text
    };

    stateStore.setActive(session.workspaceId, session.id);
    const userMessage = stateStore.appendMessage(sessionId, "user", text, {
        attachments
    });
    const taskPrompt = buildPromptWithAttachments(rawText, attachments, promptLanguage);

    const task = stateStore.createTask(sessionId, taskPrompt, {
        taskEngine: resolveTaskEngine(session),
        status: "running",
        phase: "idle",
        settings: taskSettings,
        permissionScope: null,
        attachments
    });

    executeTask({
        task,
        sessionId,
        prompt: taskPrompt,
        settings: taskSettings,
        stateStore,
        runtimeAdapter,
        publishTaskEvent,
        buildAssistantBlocks,
        buildPermissionBlocks
    });

    json(response, 202, {
        success: true,
        data: {
            userMessage,
            assistantMessage: null,
            task
        }
    });
}
