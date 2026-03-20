import { inspect } from "node:util";

const LEVEL_ORDER = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== "1";
const ACTIVE_LEVEL = resolveLogLevel();

const COLORS = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    blue: "\x1b[34m"
};

function resolveLogLevel() {
    const raw = String(process.env.TELETON_CODE_LOG_LEVEL || "").trim().toLowerCase();
    if (raw in LEVEL_ORDER) {
        return raw;
    }
    return "info";
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function formatTime(date = new Date()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function colorize(color, value) {
    if (!COLOR_ENABLED) {
        return value;
    }
    return `${COLORS[color]}${value}${COLORS.reset}`;
}

function formatArg(arg) {
    if (arg instanceof Error) {
        return arg.stack || arg.message;
    }

    if (typeof arg === "string") {
        return arg;
    }

    return inspect(arg, {
        depth: 6,
        colors: COLOR_ENABLED,
        breakLength: 120,
        compact: true
    });
}

function shouldLog(level) {
    return LEVEL_ORDER[level] <= LEVEL_ORDER[ACTIVE_LEVEL];
}

function write(level, moduleName, args) {
    if (!shouldLog(level)) {
        return;
    }

    const stream = level === "error" ? process.stderr : process.stdout;
    const levelLabel = level.toUpperCase();
    const levelColor =
        level === "error" ? "red" : level === "warn" ? "yellow" : level === "debug" ? "blue" : "green";

    const parts = [
        colorize("dim", `[${formatTime()}]`),
        `${colorize(levelColor, levelLabel)}:`,
        colorize("cyan", `[${moduleName}]`),
        args.map(formatArg).join(" ")
    ];

    stream.write(`${parts.join(" ")}\n`);
}

export function createLogger(moduleName) {
    return {
        error: (...args) => write("error", moduleName, args),
        warn: (...args) => write("warn", moduleName, args),
        info: (...args) => write("info", moduleName, args),
        debug: (...args) => write("debug", moduleName, args)
    };
}
