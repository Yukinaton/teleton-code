import { randomBytes, timingSafeEqual } from "node:crypto";
import { parseJsonBody } from "../lib/http-utils.js";

export const COOKIE_NAME = "teleton_code_session";
export const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

function parseCookies(cookieHeader = "") {
    return String(cookieHeader || "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, pair) => {
            const separatorIndex = pair.indexOf("=");
            if (separatorIndex === -1) {
                return acc;
            }

            const key = pair.slice(0, separatorIndex).trim();
            const value = pair.slice(separatorIndex + 1).trim();
            acc[key] = decodeURIComponent(value);
            return acc;
        }, {});
}

function serializeCookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (options.path) parts.push(`Path=${options.path}`);
    if (options.httpOnly) parts.push("HttpOnly");
    if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
    if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
    if (options.secure) parts.push("Secure");
    return parts.join("; ");
}

export function generateToken() {
    return randomBytes(32).toString("hex");
}

export function maskToken(token) {
    if (!token || token.length < 12) {
        return "****";
    }

    return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function safeCompare(left, right) {
    if (!left || !right) {
        return false;
    }

    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

function setSessionCookie(response, token) {
    response.setHeader(
        "Set-Cookie",
        serializeCookie(COOKIE_NAME, token, {
            path: "/",
            httpOnly: true,
            sameSite: "Strict",
            maxAge: COOKIE_MAX_AGE
        })
    );
}

function clearSessionCookie(response) {
    response.setHeader(
        "Set-Cookie",
        serializeCookie(COOKIE_NAME, "", {
            path: "/",
            httpOnly: true,
            sameSite: "Strict",
            maxAge: 0
        })
    );
}

function requestUrl(request) {
    return new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
}

function requestTokenFromCookie(request) {
    return parseCookies(request.headers.cookie)[COOKIE_NAME] || "";
}

function requestTokenFromBearer(request) {
    const authHeader = String(request.headers.authorization || "").trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1] || "";
}

function requestTokenFromQuery(request) {
    return requestUrl(request).searchParams.get("token") || "";
}

function isHtmlNavigation(request) {
    const method = String(request.method || "GET").toUpperCase();
    if (method !== "GET") {
        return false;
    }

    const accept = String(request.headers.accept || "").toLowerCase();
    const secFetchDest = String(request.headers["sec-fetch-dest"] || "").toLowerCase();
    const secFetchMode = String(request.headers["sec-fetch-mode"] || "").toLowerCase();
    return (
        secFetchDest === "document" ||
        (secFetchMode === "navigate" && accept.includes("text/html")) ||
        accept.includes("text/html")
    );
}

function writeUnauthorizedPage(response) {
    response.writeHead(401, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
    });
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Teleton Code</title></head><body style="font-family:sans-serif;background:#0b0b0b;color:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="max-width:560px;padding:32px 28px;border:1px solid #2a2a2a;border-radius:20px;background:#141414;box-shadow:0 20px 80px rgba(0,0,0,.35)"><h1 style="margin:0 0 12px;font-size:22px;">Teleton Code authorization required</h1><p style="margin:0;color:#b8b8b8;line-height:1.6;">Open the current <code style="color:#fff">/auth/exchange?token=...</code> link from the console, or start the IDE with <code style="color:#fff">teleton-code start --open</code> so the browser receives the local owner session automatically.</p></div></body></html>`);
}

export function createSessionAuthManager(config) {
    const enabled = config.security?.ownerOnly === true;
    const authToken = config.security?.authToken || generateToken();

    function isAuthorized(request) {
        if (!enabled) {
            return true;
        }

        return (
            safeCompare(requestTokenFromCookie(request), authToken) ||
            safeCompare(requestTokenFromBearer(request), authToken) ||
            safeCompare(requestTokenFromQuery(request), authToken)
        );
    }

    return {
        enabled,
        getToken() {
            return authToken;
        },
        isAuthorized,
        async handleAuthRoute(request, response, json) {
            const url = requestUrl(request);

            if (url.pathname === "/auth/exchange" && request.method === "GET") {
                const token = url.searchParams.get("token");
                if (!token || !safeCompare(token, authToken)) {
                    json(response, 401, { success: false, error: "Invalid token" });
                    return true;
                }

                setSessionCookie(response, authToken);
                response.writeHead(302, {
                    Location: "/",
                    "Cache-Control": "no-store"
                });
                response.end();
                return true;
            }

            if (url.pathname === "/auth/login" && request.method === "POST") {
                try {
                    const body = await parseJsonBody(request);
                    const token = body?.token;
                    if (!token || !safeCompare(token, authToken)) {
                        json(response, 401, { success: false, error: "Invalid token" });
                        return true;
                    }

                    setSessionCookie(response, authToken);
                    json(response, 200, { success: true });
                    return true;
                } catch (_error) {
                    json(response, 400, { success: false, error: "Invalid request body" });
                    return true;
                }
            }

            if (url.pathname === "/auth/logout" && request.method === "POST") {
                clearSessionCookie(response);
                json(response, 200, { success: true });
                return true;
            }

            if (url.pathname === "/auth/check" && request.method === "GET") {
                json(response, 200, {
                    success: true,
                    data: {
                        authenticated: isAuthorized(request)
                    }
                });
                return true;
            }

            return false;
        },
        ensureAuthorizedRequest(request, response, json) {
            if (isAuthorized(request)) {
                return true;
            }

            json(response, 401, {
                success: false,
                error: "Unauthorized"
            });
            return false;
        },
        ensureAuthorizedPageAccess(request, response) {
            if (!enabled || isAuthorized(request)) {
                return true;
            }

            if (isHtmlNavigation(request)) {
                writeUnauthorizedPage(response);
                return false;
            }

            response.writeHead(401, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store"
            });
            response.end("Unauthorized");
            return false;
        }
    };
}
