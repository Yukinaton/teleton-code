import { existsSync, statSync } from "node:fs";
import { resolveInsideWorkspace, listWorkspaceTree } from "./workspace-utils.js";

export function workspaceDiagnostics(workspace, query, config) {
    const depth = Number.parseInt(query.get("depth") || "2", 10);
    const filePath = query.get("path") || "";
    return {
        files: listWorkspaceTree(
            workspace.path,
            filePath,
            Number.isNaN(depth) ? 2 : Math.max(0, Math.min(depth, 3))
        )
    };
}

export function inferPreviewEntry(workspace) {
    const candidates = ["index.html", "src/index.html", "public/index.html"];
    for (const file of candidates) {
        try {
            const target = resolveInsideWorkspace(workspace.path, file);
            if (existsSync(target.absolute) && statSync(target.absolute).isFile()) {
                return target.relativePath.replace(/\\/g, "/");
            }
        } catch (_error) {
            // Ignore invalid candidates
        }
    }
    return null;
}
