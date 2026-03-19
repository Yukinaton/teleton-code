import { json, badRequest, notFound } from "../lib/http-utils.js";
import { listWorkspaceTree, resolveInsideWorkspace, readWorkspaceFile } from "../lib/workspace-utils.js";
import { existsSync, mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { dirname } from "node:path";

const PROJECTS_ROOT_WORKSPACE_ID = "__projects_root__";

function getRootPath(workspaceId, stateStore, config) {
    if (workspaceId === PROJECTS_ROOT_WORKSPACE_ID) {
        return config.runtime.workspaceBaseRoot;
    }

    const workspace = stateStore.getWorkspace(workspaceId);
    return workspace && workspace.kind === "project" && !workspace.archived ? workspace.path : null;
}

export function handleListFiles(workspaceId, stateStore, config, query, response) {
    const rootPath = getRootPath(workspaceId, stateStore, config);
    if (!rootPath) return notFound(response, "Workspace not found");

    json(response, 200, {
        success: true,
        data: listWorkspaceTree(rootPath, query.get("path") || "", 100)
    });
}

export function handleGetFile(workspaceId, stateStore, config, query, response) {
    const rootPath = getRootPath(workspaceId, stateStore, config);
    if (!rootPath) return notFound(response, "Workspace not found");

    const filePath = query.get("path");
    if (!filePath) return badRequest(response, "File path is required");

    try {
        const target = resolveInsideWorkspace(rootPath, filePath);
        if (!existsSync(target.absolute)) return notFound(response, "File not found");

        json(response, 200, {
            success: true,
            data: readWorkspaceFile(rootPath, filePath)
        });
    } catch (e) {
        json(response, 500, { success: false, error: e.message });
    }
}

export function handleUpdateFile(workspaceId, stateStore, config, body, response) {
    const rootPath = getRootPath(workspaceId, stateStore, config);
    if (!rootPath) return notFound(response, "Workspace not found");

    const { path: filePath, content } = body;
    if (!filePath || content === undefined) return badRequest(response, "Path and content required");

    try {
        const target = resolveInsideWorkspace(rootPath, filePath);
        writeFileSync(target.absolute, content, "utf-8");
        json(response, 200, { success: true, data: { path: target.relativePath } });
    } catch (e) {
        json(response, 500, { success: false, error: e.message });
    }
}

export function handleCreateItem(workspaceId, stateStore, config, body, response) {
    const rootPath = getRootPath(workspaceId, stateStore, config);
    if (!rootPath) return notFound(response, "Workspace not found");

    const { type = "file", path: itemPath } = body;
    if (!itemPath) return badRequest(response, "Path is required");

    try {
        const target = resolveInsideWorkspace(rootPath, itemPath);
        if (type === "folder") {
            mkdirSync(target.absolute, { recursive: true });
        } else {
            const parent = dirname(target.absolute);
            if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
            writeFileSync(target.absolute, "", "utf-8");
        }
        json(response, 200, { success: true, data: { path: target.relativePath } });
    } catch (e) {
        json(response, 500, { success: false, error: e.message });
    }
}

export function handleDeleteItem(workspaceId, stateStore, config, body, query, response) {
    const rootPath = getRootPath(workspaceId, stateStore, config);
    if (!rootPath) return notFound(response, "Workspace not found");

    const itemPath = body.path || query.get("path");
    if (!itemPath) return badRequest(response, "Path is required");

    try {
        const target = resolveInsideWorkspace(rootPath, itemPath);
        if (existsSync(target.absolute)) {
            rmSync(target.absolute, { recursive: true, force: true });
        }
        json(response, 200, { success: true });
    } catch (e) {
        json(response, 500, { success: false, error: e.message });
    }
}
export function handleRenameItem(workspaceId, stateStore, config, body, response) {
    const rootPath = getRootPath(workspaceId, stateStore, config);
    if (!rootPath) return notFound(response, "Workspace not found");

    const { oldPath, newPath } = body;
    if (!oldPath || !newPath) return badRequest(response, "Old and new paths are required");

    try {
        const oldTarget = resolveInsideWorkspace(rootPath, oldPath);
        const newTarget = resolveInsideWorkspace(rootPath, newPath);
        
        const parent = dirname(newTarget.absolute);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

        renameSync(oldTarget.absolute, newTarget.absolute);
        json(response, 200, { success: true, data: { path: newTarget.relativePath } });
    } catch (e) {
        json(response, 500, { success: false, error: e.message });
    }
}
