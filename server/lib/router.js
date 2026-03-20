import { URL } from "node:url";
import { renameSync } from "node:fs";
import { notFound, parseJsonBody, json } from "./http-utils.js";
import * as workspaceHandler from "../handlers/workspace-handler.js";
import * as fileHandler from "../handlers/file-handler.js";
import * as chatHandler from "../handlers/chat-handler.js";
import * as taskHandler from "../handlers/task-handler.js";
import * as gitHandler from "../handlers/git-handler.js";
import { buildAssistantBlocks, buildPermissionBlocks } from "./chat-blocks.js";
import { resolveInsideWorkspace } from "./workspace-utils.js";
import { createLogger } from "./logger.js";

const log = createLogger("API");

export async function handleApiRequest(request, response, context) {
    const { stateStore, runtimeAdapter, config } = context;
    const url = new URL(request.url, `http://${request.headers.host}`);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    const method = request.method;
    const query = url.searchParams;

    log.debug(`${method} ${path}`);

    // Bootstrap
    if (method === "GET" && path === "/api/bootstrap") {
        return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
    }
    
    // Ping
    if (method === "GET" && path === "/api/debug/ping") {
        return json(response, 200, { success: true, data: { status: "pong", version: "next-gen-refactor-v2", time: new Date().toISOString() } });
    }

    // Runtime Status
    if (method === "GET" && path === "/api/runtime/status") {
        return json(response, 200, { success: true, data: runtimeAdapter.getRuntimeStatus() });
    }

    // Capabilities
    if (method === "GET" && path === "/api/capabilities") {
        const runtime = runtimeAdapter.getRuntimeStatus();
        return json(response, 200, {
            success: true,
            data: {
                runtimeLoaded: runtime.loaded,
                workspaceBaseRoot: runtime.workspaceBaseRoot,
                capabilities: runtime.capabilities
            }
        });
    }

    // --- Workspace Endpoints ---
    if (method === "POST" && path === "/api/workspaces") {
        const body = await parseJsonBody(request);
        if (await workspaceHandler.handleCreateWorkspace(stateStore, config, body, response)) {
             return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
        }
        return;
    }

    const wsMatch = path.match(/^\/api\/workspaces\/([^/]+)$/);
    if (wsMatch) {
        const id = wsMatch[1];
        if (method === "PATCH") {
            const body = await parseJsonBody(request);
            if (workspaceHandler.handleUpdateWorkspace(stateStore, id, body, response)) {
                return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
            }
            return;
        }
        if (method === "DELETE") {
            if (workspaceHandler.handleDeleteWorkspace(stateStore, id)) {
                return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
            }
            return;
        }
    }

    // --- File System Endpoints ---
    const wsFilesMatch = path.match(/^\/api\/workspaces\/([^/]+)\/files$/);
    if (wsFilesMatch && method === "GET") return fileHandler.handleListFiles(wsFilesMatch[1], stateStore, config, query, response);

    const wsDiagnosticsMatch = path.match(/^\/api\/workspaces\/([^/]+)\/diagnostics$/);
    if (wsDiagnosticsMatch && method === "GET") {
        const files = (await import("./workspace-utils.js")).listWorkspaceTree(config.runtime.workspaceBaseRoot, "", 3);
        return json(response, 200, { success: true, data: { files } });
    }

    const wsFileMatch = path.match(/^\/api\/workspaces\/([^/]+)\/file$/);
    if (wsFileMatch) {
        if (method === "GET") return fileHandler.handleGetFile(wsFileMatch[1], stateStore, config, query, response);
        if (method === "PATCH") {
            const body = await parseJsonBody(request);
            return fileHandler.handleUpdateFile(wsFileMatch[1], stateStore, config, body, response);
        }
    }

    const wsItemsMatch = path.match(/^\/api\/workspaces\/([^/]+)\/items$/);
    if (wsItemsMatch) {
        const id = wsItemsMatch[1];
        if (method === "POST") {
            const body = await parseJsonBody(request);
            return fileHandler.handleCreateItem(id, stateStore, config, body, response);
        }
        if (method === "DELETE") {
            const body = await parseJsonBody(request).catch(() => ({}));
            return fileHandler.handleDeleteItem(id, stateStore, config, body, query, response);
        }
        if (method === "PATCH") {
            const body = await parseJsonBody(request);
            return fileHandler.handleRenameItem(id, stateStore, config, body, response);
        }
    }

    // --- Task Endpoints ---
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && method === "GET") return taskHandler.handleGetTask(taskMatch[1], stateStore, response);

    const taskStreamMatch = path.match(/^\/api\/tasks\/([^/]+)\/stream$/);
    if (taskStreamMatch && method === "GET") return taskHandler.handleTaskStream(taskStreamMatch[1], stateStore, runtimeAdapter, response);

    const taskApprovalMatch = path.match(/^\/api\/tasks\/([^/]+)\/approval$/);
    if (taskApprovalMatch && method === "POST") {
        const body = await parseJsonBody(request);
        return taskHandler.handleTaskApproval(taskApprovalMatch[1], stateStore, runtimeAdapter, body, buildAssistantBlocks, buildPermissionBlocks, response);
    }

    const taskRecoveryMatch = path.match(/^\/api\/tasks\/([^/]+)\/recovery$/);
    if (taskRecoveryMatch && method === "POST") {
        const body = await parseJsonBody(request);
        return taskHandler.handleTaskRecovery(taskRecoveryMatch[1], stateStore, runtimeAdapter, body, buildAssistantBlocks, buildPermissionBlocks, response);
    }

    // --- Git Endpoints ---
    const gitStatusMatch = path.match(/^\/api\/workspaces\/([^/]+)\/git\/status$/);
    if (gitStatusMatch && method === "GET") return gitHandler.handleGitStatus(gitStatusMatch[1], stateStore, config, response);

    const gitDiffMatch = path.match(/^\/api\/workspaces\/([^/]+)\/git\/diff$/);
    if (gitDiffMatch && method === "GET") return gitHandler.handleGitDiff(gitDiffMatch[1], stateStore, config, query, response);

    // --- Session Endpoints ---
    const wsSessionMatch = path.match(/^\/api\/workspaces\/([^/]+)\/sessions$/);
    if (wsSessionMatch && method === "POST") {
        const body = await parseJsonBody(request);
        stateStore.createSession(wsSessionMatch[1], body.title?.trim() || "New chat");
        return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
    }

    const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch) {
         const id = sessionMatch[1];
         if (method === "PATCH") {
             const body = await parseJsonBody(request);
             if (chatHandler.handleUpdateSession(id, stateStore, body, response)) {
                 return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
             }
             return;
         }
         if (method === "DELETE") {
             if (chatHandler.handleDeleteSession(id, stateStore)) {
                 return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
             }
             return;
         }
    }

    const sessionMsgMatch = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (sessionMsgMatch) {
        const id = sessionMsgMatch[1];
        if (method === "GET") {
            const session = stateStore.getSession(id);
            if (!session) {
                return notFound(response, "Session not found");
            }
            stateStore.setActive(session.workspaceId, id);
            return json(response, 200, {
                success: true,
                data: {
                    session,
                    messages: stateStore.getMessages(id),
                    latestTask: stateStore.getLatestTask(id),
                    taskId: stateStore.getLatestTask(id)?.id || null,
                    contextInfo: stateStore.getSessionContext(id)
                }
            });
        }
        if (method === "POST") {
            const body = await parseJsonBody(request);
            return chatHandler.handlePostMessage(id, stateStore, runtimeAdapter, body, buildAssistantBlocks, buildPermissionBlocks, response);
        }
    }

    // Archive / Restore
    const archiveMatch = path.match(/^\/api\/workspaces\/([^/]+)\/archive$/);
    if (archiveMatch && method === "POST") {
        if (workspaceHandler.handleArchiveWorkspace(stateStore, archiveMatch[1])) {
             return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
        }
    }
    const restoreMatch = path.match(/^\/api\/workspaces\/([^/]+)\/restore$/);
    if (restoreMatch && method === "POST") {
        if (workspaceHandler.handleRestoreWorkspace(stateStore, restoreMatch[1])) {
             return workspaceHandler.handleWorkspaceBootstrap(stateStore, runtimeAdapter, response);
        }
    }

    // Preview
    const previewMatch = path.match(/^\/api\/workspaces\/([^/]+)\/preview$/);
    if (previewMatch && method === "GET") {
        const workspace = stateStore.getWorkspace(previewMatch[1]);
        if (!workspace) return notFound(response, "Workspace not found");
        const { inferPreviewEntry } = await import("./workspace-manager.js");
        const entry = inferPreviewEntry(workspace);
        return json(response, 200, {
            success: true,
            data: {
                available: Boolean(entry),
                entry,
                url: entry ? `/preview/${workspace.id}/${entry}` : null
            }
        });
    }

    notFound(response);
}
