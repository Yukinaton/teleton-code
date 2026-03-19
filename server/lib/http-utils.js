export const STATIC_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8"
};

export function json(response, status, data) {
    response.writeHead(status, { 
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(data));
}

export function badRequest(response, message) {
    json(response, 400, { success: false, error: message });
}

export function notFound(response, message = "Not Found") {
    json(response, 404, { success: false, error: message });
}

export function methodNotAllowed(response) {
    json(response, 405, { success: false, error: "Method not allowed" });
}

export function parseJsonBody(request) {
    return new Promise((resolvePromise, rejectPromise) => {
        let body = "";
        request.on("data", (chunk) => {
            body += chunk.toString("utf-8");
            if (body.length > 1_000_000) {
                rejectPromise(new Error("Request body too large"));
            }
        });
        request.on("end", () => {
            if (!body) {
                resolvePromise({});
                return;
            }
            try {
                resolvePromise(JSON.parse(body));
            } catch (error) {
                rejectPromise(error);
            }
        });
        request.on("error", rejectPromise);
    });
}
