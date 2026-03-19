import { resolve, extname } from "node:path";
import { existsSync, statSync, createReadStream } from "node:fs";
import { isPathInsideRoot, resolveInsideWorkspace } from "./workspace-utils.js";
import { STATIC_MIME, notFound, badRequest } from "./http-utils.js";
import { inferPreviewEntry } from "./workspace-manager.js";

function buildPreviewHeaders(extension) {
    const headers = {
        "Content-Type": STATIC_MIME[extension] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    };

    if (extension === ".html") {
        headers["Content-Security-Policy"] = [
            "default-src 'self' data: blob: https: http:",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
            "style-src 'self' 'unsafe-inline' https: http:",
            "img-src 'self' data: blob: https: http:",
            "font-src 'self' data: https: http:",
            "media-src 'self' data: blob: https: http:",
            "connect-src 'self' https: http: ws: wss:",
            "object-src 'none'",
            "base-uri 'self'"
        ].join("; ");
    }

    return headers;
}

export function serveStatic(request, response, repoRoot) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const requestedPath = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const absolute = resolve(repoRoot, requestedPath);

    if (!isPathInsideRoot(repoRoot, absolute, { allowRoot: false }) || !existsSync(absolute) || !statSync(absolute).isFile()) {
        return notFound(response);
    }

    const extension = requestedPath.includes(".") ? requestedPath.slice(requestedPath.lastIndexOf(".")) : ".html";
    response.writeHead(200, {
        "Content-Type": STATIC_MIME[extension] || "application/octet-stream",
        "Cache-Control": "no-store"
    });
    createReadStream(absolute).pipe(response);
}

export function serveWorkspacePreview(workspace, requestedFile, response, { isolated = false } = {}) {
    const entry = requestedFile || inferPreviewEntry(workspace);
    if (!entry) {
        return notFound(response, "No previewable entry file found");
    }

    let target;
    try {
        target = resolveInsideWorkspace(workspace.path, decodeURIComponent(entry));
    } catch (error) {
        return badRequest(response, error.message);
    }

    if (!existsSync(target.absolute) || !statSync(target.absolute).isFile()) {
        return notFound(response, "Preview file not found");
    }

    const extension = extname(target.absolute).toLowerCase();
    response.writeHead(200, isolated ? buildPreviewHeaders(extension) : {
        "Content-Type": STATIC_MIME[extension] || "application/octet-stream",
        "Cache-Control": "no-store"
    });
    createReadStream(target.absolute).pipe(response);
}
