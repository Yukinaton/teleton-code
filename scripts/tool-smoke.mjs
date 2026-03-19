import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadServiceConfig } from "../server/lib/config.js";
import { isPathInsideRoot, resolveInsideWorkspace } from "../server/lib/workspace-utils.js";
import { COOKIE_NAME, createSessionAuthManager } from "../server/security/session-auth.js";

const tempRoot = mkdtempSync(join(tmpdir(), "teleton-code-smoke-"));
const previousTeletonHome = process.env.TELETON_HOME;
const previousTeletonPackage = process.env.TELETON_CODE_TELETON_PACKAGE;

try {
    const repoRoot = join(tempRoot, "repo");
    const fakeTeletonPackage = join(tempRoot, "fake-teleton-package");
    const teletonHome = join(tempRoot, "teleton-home");
    const workspaceRoot = join(tempRoot, "workspace");
    const siblingWorkspaceRoot = join(tempRoot, "workspace-copy");

    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(fakeTeletonPackage, { recursive: true });
    mkdirSync(teletonHome, { recursive: true });
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });
    mkdirSync(siblingWorkspaceRoot, { recursive: true });

    const configPath = join(repoRoot, "teleton-code.config.json");
    const initialConfig = JSON.stringify(
        {
            version: 1,
            server: {
                host: "127.0.0.1",
                port: 8895,
                previewPort: 8896
            },
            security: {
                ownerOnly: true,
                loopbackOnly: true
            }
        },
        null,
        2
    );

    writeFileSync(configPath, initialConfig, "utf-8");

    process.env.TELETON_HOME = teletonHome;
    process.env.TELETON_CODE_TELETON_PACKAGE = fakeTeletonPackage;

    const { config } = loadServiceConfig(repoRoot);

    assert.equal(config.server.port, 8895, "main port should come from config");
    assert.equal(config.server.previewPort, 8896, "preview port should come from config");
    assert.equal(
        readFileSync(configPath, "utf-8"),
        initialConfig,
        "loadServiceConfig must not rewrite tracked repo config"
    );

    writeFileSync(join(workspaceRoot, "src", "index.html"), "<!doctype html>", "utf-8");
    writeFileSync(join(siblingWorkspaceRoot, "secret.txt"), "nope", "utf-8");

    assert.equal(
        isPathInsideRoot(workspaceRoot, join(workspaceRoot, "src", "index.html"), { allowRoot: false }),
        true,
        "child files must be considered inside workspace"
    );
    assert.equal(
        isPathInsideRoot(workspaceRoot, join(siblingWorkspaceRoot, "secret.txt")),
        false,
        "sibling paths must be rejected"
    );
    assert.throws(
        () => resolveInsideWorkspace(workspaceRoot, "../workspace-copy/secret.txt"),
        /Path escapes the configured workspace root/,
        "resolveInsideWorkspace must reject escaping paths"
    );

    const authResponses = [];
    const authManager = createSessionAuthManager({
        security: {
            ownerOnly: true
        }
    });
    const exchangeResponse = {
        setHeader(name, value) {
            authResponses.push({ name, value });
        },
        writeHead() {},
        end() {}
    };
    const exchangeRequest = {
        method: "GET",
        url: `/auth/exchange?token=${authManager.getToken()}`,
        headers: {
            host: "127.0.0.1:8895",
            accept: "text/html,application/xhtml+xml"
        }
    };

    assert.equal(
        await authManager.handleAuthRoute(exchangeRequest, exchangeResponse, () => {}),
        true,
        "auth exchange should be handled"
    );
    const sessionCookie = authResponses.find((entry) => entry.name === "Set-Cookie")?.value;
    assert.ok(sessionCookie, "auth exchange must set a session cookie");
    assert.ok(
        String(sessionCookie).startsWith(`${COOKIE_NAME}=`),
        "cookie name must stay stable"
    );

    const authorizedApiRequest = {
        headers: {
            cookie: String(sessionCookie).split(";")[0]
        }
    };
    assert.equal(
        authManager.ensureAuthorizedRequest(authorizedApiRequest, { writeHead() {}, end() {} }, () => {}),
        true,
        "cookie-authenticated browser session must pass authorization"
    );

    let unauthorizedStatus = null;
    const unauthorizedAllowed = authManager.ensureAuthorizedRequest(
        { headers: {} },
        {},
        (_response, status) => {
            unauthorizedStatus = status;
        }
    );
    assert.equal(unauthorizedAllowed, false, "missing auth must be rejected");
    assert.equal(unauthorizedStatus, 401, "missing auth should return 401");

    console.log("tool smoke passed");
} finally {
    if (previousTeletonHome === undefined) {
        delete process.env.TELETON_HOME;
    } else {
        process.env.TELETON_HOME = previousTeletonHome;
    }

    if (previousTeletonPackage === undefined) {
        delete process.env.TELETON_CODE_TELETON_PACKAGE;
    } else {
        process.env.TELETON_CODE_TELETON_PACKAGE = previousTeletonPackage;
    }

    rmSync(tempRoot, { recursive: true, force: true });
}
