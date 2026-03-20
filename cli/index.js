import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { startTeletonCodeServer } from "../server/app.js";

function repoRootFromCli() {
    return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function printHelp() {
    console.log(`Teleton Code CLI

Usage:
  teleton-code start [--webui] [--host 127.0.0.1] [--port 9999] [--preview-port 10000] [--open]

Options:
  --webui                     Teleton-style alias for the local IDE WebUI
  --host <host>               Bind address for the IDE server
  --port <port>               Port for the IDE server
  --preview-port <port>       Port for the isolated preview server
  --open                      Open the IDE in the default browser
  --no-open                   Do not open the browser automatically
  --teleton-home <path>       Override TELETON_HOME
  --teleton-package <path>    Override Teleton package path
  --auth-token <token>        Override the local IDE auth token
  -h, --help                  Show this help
`);
}

function parsePositivePort(value) {
    if (!value) {
        return null;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid port: ${value}`);
    }

    return parsed;
}

function openBrowser(url) {
    const launch = (() => {
        if (process.platform === "win32") {
            return {
                command: "cmd",
                args: ["/c", "start", "", url]
            };
        }

        if (process.platform === "darwin") {
            return {
                command: "open",
                args: [url]
            };
        }

        return {
            command: "xdg-open",
            args: [url]
        };
    })();

    try {
        const child = spawn(launch.command, launch.args, {
            detached: true,
            stdio: "ignore"
        });
        child.unref();
    } catch (error) {
        console.warn(
            `Failed to open browser automatically: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

async function startCommand(args) {
    const { values } = parseArgs({
        args,
        allowPositionals: true,
        options: {
            host: { type: "string" },
            port: { type: "string" },
            "preview-port": { type: "string" },
            webui: { type: "boolean" },
            open: { type: "boolean" },
            "no-open": { type: "boolean" },
            "teleton-home": { type: "string" },
            "teleton-package": { type: "string" },
            "auth-token": { type: "string" },
            help: { type: "boolean", short: "h" }
        }
    });

    if (values.help) {
        printHelp();
        return;
    }

    if (values["teleton-home"]) {
        process.env.TELETON_HOME = values["teleton-home"];
    }

    if (values["teleton-package"]) {
        process.env.TELETON_CODE_TELETON_PACKAGE = values["teleton-package"];
    }

    if (values["auth-token"]) {
        process.env.TELETON_CODE_AUTH_TOKEN = values["auth-token"];
    }

    if (values.host) {
        process.env.TELETON_CODE_HOST = values.host;
    }

    const port = parsePositivePort(values.port);
    const previewPort = parsePositivePort(values["preview-port"]);
    if (port) {
        process.env.TELETON_CODE_PORT = String(port);
    }
    if (previewPort) {
        process.env.TELETON_CODE_PREVIEW_PORT = String(previewPort);
    } else if (port) {
        process.env.TELETON_CODE_PREVIEW_PORT = String(port + 1);
    }

    const app = await startTeletonCodeServer(repoRootFromCli());
    const shouldOpen = values["no-open"] ? false : values.open !== false;
    const host =
        app.config.server.host === "0.0.0.0" || app.config.server.host === "::"
            ? "127.0.0.1"
            : app.config.server.host;
    const rootUrl = `http://${host}:${app.config.server.port}`;
    const url = app.config.security?.ownerOnly
        ? `${rootUrl}/auth/exchange?token=${app.auth.getToken()}`
        : rootUrl;

    if (shouldOpen) {
        openBrowser(url);
    }
}

async function main() {
    const [command, ...rest] = process.argv.slice(2);

    if (!command || command === "help" || command === "--help" || command === "-h") {
        printHelp();
        return;
    }

    if (command !== "start") {
        throw new Error(`Unknown command: ${command}`);
    }

    await startCommand(rest);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EADDRINUSE")) {
        const host = process.env.TELETON_CODE_HOST || "127.0.0.1";
        const port = process.env.TELETON_CODE_PORT || "9999";
        const previewPort = process.env.TELETON_CODE_PREVIEW_PORT || String(Number(port) + 1);
        console.error(
            `Teleton Code is already running on http://${host}:${port} or preview port ${previewPort} is in use`
        );
        process.exit(1);
    }

    console.error(`Teleton Code CLI error: ${message}`);
    process.exit(1);
});
