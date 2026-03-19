import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadServiceConfig } from "./config/service-config.js";
import { StateStore } from "./infrastructure/persistence/state-store.js";
import { RuntimeAdapter } from "./lib/runtime-adapter.js";
import { handleApiRequest } from "./lib/router.js";
import { serveStatic, serveWorkspacePreview } from "./preview/static-server.js";
import { json } from "./lib/http-utils.js";
import { enforceLoopbackOnly } from "./security/loopback-guard.js";
import { createSessionAuthManager, maskToken } from "./security/session-auth.js";

function buildPreviewOrigin(request, config) {
    const incomingHost = String(request.headers.host || "").trim();
    const hostname = incomingHost.includes(":")
        ? incomingHost.slice(0, incomingHost.lastIndexOf(":"))
        : incomingHost || config.server.host;
    return `http://${hostname}:${config.server.previewPort}`;
}

function buildAccessHost(host) {
    return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function buildServiceOrigin(config) {
    return `http://${buildAccessHost(config.server.host)}:${config.server.port}`;
}

function buildPreviewServiceOrigin(config) {
    return `http://${buildAccessHost(config.server.host)}:${config.server.previewPort}`;
}

function persistRuntimeInfo(repoRoot, config, auth) {
    const logDir = join(repoRoot, "logs");
    mkdirSync(logDir, { recursive: true });

    const serviceOrigin = buildServiceOrigin(config);
    const previewOrigin = buildPreviewServiceOrigin(config);
    const authUrl =
        config.security?.ownerOnly === true
            ? `${serviceOrigin}/auth/exchange?token=${auth.getToken()}`
            : `${serviceOrigin}/`;

    writeFileSync(join(logDir, "current-auth-url.txt"), `${authUrl}\n`, "utf8");
    writeFileSync(
        join(logDir, "current-runtime.json"),
        JSON.stringify(
            {
                serviceOrigin,
                previewOrigin,
                ownerOnly: config.security?.ownerOnly === true,
                authUrl,
                startedAt: new Date().toISOString()
            },
            null,
            2
        ),
        "utf8"
    );
}

function probePort(host, port) {
    return new Promise((resolve) => {
        const probe = createNetServer();
        probe.unref();
        probe.once("error", () => resolve(false));
        probe.listen(port, host, () => {
            probe.close(() => resolve(true));
        });
    });
}

async function resolveRuntimePorts(config) {
    let port = config.server.port;

    while (true) {
        const previewPort = port + 1;
        const [mainAvailable, previewAvailable] = await Promise.all([
            probePort(config.server.host, port),
            probePort(config.server.host, previewPort)
        ]);

        if (mainAvailable && previewAvailable) {
            if (port !== config.server.port || previewPort !== config.server.previewPort) {
                console.warn(
                    `Configured ports ${config.server.port}/${config.server.previewPort} are unavailable, using ${port}/${previewPort} instead`
                );
                config.server.port = port;
                config.server.previewPort = previewPort;
            }
            return;
        }

        port += 1;
    }
}

function startServer(server, host, port, label) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            console.log(`${label} listening on http://${host}:${port}`);
            resolve();
        });
    });
}

export function createTeletonCodeApp(repoRoot = process.cwd()) {
    const { config } = loadServiceConfig(repoRoot);
    const stateStore = new StateStore(repoRoot, config);
    const runtimeAdapter = new RuntimeAdapter(config, stateStore);
    const auth = createSessionAuthManager(config);
    const packagedFrontendRoot = join(repoRoot, "server", "public");
    const devFrontendRoot = join(repoRoot, "client-new", "dist");
    const frontendRoot = existsSync(join(packagedFrontendRoot, "index.html"))
        ? packagedFrontendRoot
        : devFrontendRoot;

    const context = {
        stateStore,
        runtimeAdapter,
        config,
        frontendRoot
    };

    const server = createServer(async (request, response) => {
        try {
            if (!request.url) {
                response.writeHead(404);
                response.end();
                return;
            }

            if (!enforceLoopbackOnly(request, response, config, json)) {
                return;
            }

            if (request.url === "/health") {
                return json(response, 200, { status: "ok" });
            }

            if (await auth.handleAuthRoute(request, response, json)) {
                return;
            }

            if (request.url.startsWith("/api/")) {
                if (!auth.ensureAuthorizedRequest(request, response, json)) {
                    return;
                }
                await handleApiRequest(request, response, context);
                return;
            }

            const previewMatch = request.url.match(/^\/preview\/([^/]+)(?:\/(.*))?$/);
            if (previewMatch) {
                if (!auth.ensureAuthorizedRequest(request, response, json)) {
                    return;
                }
                response.writeHead(302, {
                    Location: `${buildPreviewOrigin(request, config)}${request.url}`,
                    "Cache-Control": "no-store"
                });
                response.end();
                return;
            }

            if (!auth.ensureAuthorizedPageAccess(request, response)) {
                return;
            }

            serveStatic(request, response, context.frontendRoot);
        } catch (error) {
            console.error(
                `[SERVER ERROR] ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error.stack : undefined
            );
            json(response, 500, {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    const previewServer = createServer((request, response) => {
        try {
            if (!request.url) {
                response.writeHead(404);
                response.end();
                return;
            }

            if (!enforceLoopbackOnly(request, response, config, json)) {
                return;
            }

            if (request.url === "/health") {
                return json(response, 200, { status: "ok", kind: "preview" });
            }

            if (!auth.ensureAuthorizedRequest(request, response, json)) {
                return;
            }

            const previewMatch = request.url.match(/^\/preview\/([^/]+)(?:\/(.*))?$/);
            if (!previewMatch) {
                return json(response, 404, {
                    success: false,
                    error: "Preview resource not found"
                });
            }

            const workspace = stateStore.getWorkspace(previewMatch[1]);
            if (!workspace) {
                return json(response, 404, { success: false, error: "Workspace not found" });
            }

            serveWorkspacePreview(workspace, previewMatch[2] || "", response, {
                isolated: true
            });
        } catch (error) {
            console.error(
                `[PREVIEW SERVER ERROR] ${error instanceof Error ? error.message : String(error)}`,
                error instanceof Error ? error.stack : undefined
            );
            json(response, 500, {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    return {
        server,
        previewServer,
        config,
        auth,
        stateStore,
        runtimeAdapter,
        context
    };
}

export async function startTeletonCodeServer(repoRoot = process.cwd()) {
    const app = createTeletonCodeApp(repoRoot);
    await resolveRuntimePorts(app.config);

    await startServer(app.server, app.config.server.host, app.config.server.port, "Teleton Code service");

    try {
        await startServer(
            app.previewServer,
            app.config.server.host,
            app.config.server.previewPort,
            "Teleton Code preview service"
        );
    } catch (error) {
        await new Promise((resolve) => app.server.close(() => resolve()));
        throw error;
    }

    const serviceOrigin = buildServiceOrigin(app.config);
    persistRuntimeInfo(repoRoot, app.config, app.auth);
    if (app.config.security?.ownerOnly) {
        console.log(`Teleton Code URL: ${serviceOrigin}/auth/exchange?token=${app.auth.getToken()}`);
        console.log(`Teleton Code token: ${maskToken(app.auth.getToken())}`);
    } else {
        console.log(`Teleton Code URL: ${serviceOrigin}/`);
    }

    return app;
}
