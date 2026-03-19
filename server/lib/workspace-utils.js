import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

export const READ_LIMIT = 200_000;
export const TREE_LIMIT = 10000;
export const DIFF_LIMIT = 80_000;
export const DEFAULT_SEARCH_LIMIT = 50;

const DANGEROUS_COMMAND_PATTERNS = [
    /\brm\s+-rf\s+[/~]/i,
    /\bRemove-Item\b.*-Recurse.*-Force/i,
    /\bdel\b\s+\/[sqf]/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
    /\bRestart-Computer\b/i,
    /\bStop-Computer\b/i,
    /\bInvoke-WebRequest\b/i,
    /\bcurl\b/i,
    /\bwget\b/i,
    /\bscp\b/i,
    /\bftp\b/i,
    /\bStart-BitsTransfer\b/i,
    /\bgit\s+clean\b/i
];

export function truncateText(text, limit) {
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

export function isPathInsideRoot(rootPath, candidatePath, { allowRoot = true } = {}) {
    const safeRoot = resolve(rootPath);
    const safeCandidate = resolve(candidatePath);
    const relativePath = relative(safeRoot, safeCandidate);

    if (!relativePath || relativePath === ".") {
        return allowRoot;
    }

    return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export function resolveInsideWorkspace(workspaceRoot, targetPath = "") {
    // Force forward slashes and remove suspicious characters
    const normalizedTarget = targetPath.replace(/\\/g, "/").replace(/[\x00-\x1F\x7F]/g, "").trim();
    const absolute = resolve(workspaceRoot, normalizedTarget);

    const safeWorkspaceRoot = resolve(workspaceRoot);
    const relativePath = relative(safeWorkspaceRoot, absolute);

    if (!isPathInsideRoot(safeWorkspaceRoot, absolute)) {
        throw new Error("Path escapes the configured workspace root");
    }

    return {
        absolute,
        relativePath: relativePath || "."
    };
}

const IGNORED_FOLDERS = new Set(['node_modules', '.git', 'dist', '.vscode', 'build', '.next', 'out', 'vendor', '.teleton-code']);

export function walkTree(root, current, depth, entries) {
    if (entries.length >= TREE_LIMIT || depth < 0 || !existsSync(current)) {
        return;
    }

    const children = readdirSync(current, { withFileTypes: true }).sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    for (const entry of children) {
        if (IGNORED_FOLDERS.has(entry.name)) continue;

        if (entries.length >= TREE_LIMIT) {
            return;
        }

        const fullPath = join(current, entry.name);
        const stats = statSync(fullPath);
        entries.push({
            name: entry.name,
            path: (relative(root, fullPath) || entry.name).replace(/\\/g, '/'),
            type: entry.isDirectory() ? "dir" : "file",
            isDir: entry.isDirectory(),
            size: entry.isDirectory() ? 0 : stats.size,
            mtime: stats.mtime
        });

        if (entry.isDirectory()) {
            walkTree(root, fullPath, depth - 1, entries);
        }
    }
}

export function runPowerShell(command, cwd, timeoutMs, outputLimit) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(
            "powershell.exe",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            {
                cwd,
                windowsHide: true
            }
        );

        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
            if (finished) {
                return;
            }
            child.kill();
            rejectPromise(new Error(`Command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const push = (bucket, chunk) => truncateText(bucket + chunk.toString("utf-8"), outputLimit);

        child.stdout.on("data", (chunk) => {
            stdout = push(stdout, chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr = push(stderr, chunk);
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            rejectPromise(error);
        });
        child.on("close", (code) => {
            finished = true;
            clearTimeout(timer);
            resolvePromise({
                exitCode: code ?? 0,
                stdout,
                stderr
            });
        });
    });
}

export function isDangerousCommand(command) {
    return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export async function searchTextWithRg(query, cwd, limit) {
    const escaped = query.replace(/"/g, '\\"');
    const result = await runPowerShell(
        `rg --line-number --hidden --glob '!node_modules' --max-count ${limit} "${escaped}" .`,
        cwd,
        30000,
        40000
    );
    if (result.exitCode !== 0 && !result.stdout && !result.stderr) {
        return [];
    }

    const lines = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit);
    return lines.map((line) => {
        const [file, lineNumber, ...rest] = line.split(":");
        return {
            file,
            line: Number(lineNumber),
            text: rest.join(":")
        };
    });
}

export function fallbackSearch(root, query, limit) {
    const matches = [];

    function visit(current) {
        if (matches.length >= limit || !existsSync(current)) {
            return;
        }

        let children;
        try {
            children = readdirSync(current, { withFileTypes: true });
        } catch (err) {
            console.error(`[FALLBACK SEARCH] Error reading directory ${current}: ${err.message}`);
            return; // Skip this directory if it can't be read
        }
        
        for (const entry of children) {
            if (matches.length >= limit) {
                return;
            }
            if (IGNORED_FOLDERS.has(entry.name)) {
                continue;
            }

            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                visit(full);
                continue;
            }

            if (statSync(full).size > READ_LIMIT) {
                continue;
            }

            const content = readFileSync(full, "utf-8");
            const rows = content.split(/\r?\n/);
            rows.forEach((row, index) => {
                if (matches.length < limit && row.includes(query)) {
                    matches.push({
                        file: relative(root, full),
                        line: index + 1,
                        text: row.trim()
                    });
                }
            });
        }
    }

    visit(root);
    return matches;
}

export function listWorkspaceTree(workspaceRoot, targetPath = "", depth = 2) {
    try {
        const target = resolveInsideWorkspace(workspaceRoot, targetPath);
        if (!existsSync(target.absolute)) {
            return { root: target.relativePath, entries: [] };
        }
        const stats = statSync(target.absolute);
        if (!stats.isDirectory()) {
            return { root: target.relativePath, entries: [] };
        }

        const entries = [];
        walkTree(target.absolute, target.absolute, depth, entries);

        return {
            root: target.relativePath,
            entries
        };
    } catch (error) {
        console.error(`[TREE ERROR] ${error.message}`);
        return { root: targetPath, entries: [] };
    }
}

export function readWorkspaceFile(workspaceRoot, targetPath) {
    const target = resolveInsideWorkspace(workspaceRoot, targetPath);
    if (!existsSync(target.absolute)) {
        throw new Error(`File does not exist: ${target.relativePath}`);
    }
    const stats = statSync(target.absolute);
    if (stats.size > READ_LIMIT) {
        throw new Error(`File is too large to read directly (${stats.size} bytes)`);
    }

    let content = readFileSync(target.absolute, "utf-8");
    const rawContent = content.trim();

    // --- AUTO RECOVERY LOGIC (JSON POLLUTION) ---
    // If file looks like a serialized JSON array or object instead of code
    if ((rawContent.startsWith("[") && rawContent.endsWith("]")) || (rawContent.startsWith("{") && rawContent.endsWith("}"))) {
        try {
            // Attempt to unwrap it
            const htmlMatch = rawContent.match(/<html[\s\S]*<\/html>/i) || rawContent.match(/<!DOCTYPE[\s\S]*<\/html>/i);
            if (htmlMatch) {
                let clean = htmlMatch[0]
                    .replace(/\\n/g, '\n')
                    .replace(/\\"/g, '"')
                    .replace(/\\'/g, "'")
                    .replace(/\\\\/g, '\\');
                
                // If it starts/ends with quotes because of greedy regex caught JSON wrapping
                if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
                if (clean.startsWith("'") && clean.endsWith("'")) clean = clean.slice(1, -1);
                content = clean;
            } else if (rawContent.includes("font-family") || rawContent.includes("background-color")) {
                // Heuristic for CSS-in-objects
                const cleaned = rawContent.replace(/'/g, '"');
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed)) {
                    content = parsed.map(item => {
                        if (typeof item === 'string') return item;
                        if (typeof item === 'object') return Object.entries(item).map(([k,v]) => `${k}: ${v}`).join(';\n');
                        return String(item);
                    }).join('\n');
                }
            }
        } catch (e) {
            // If healing fails, just serve raw corrupted content (original behavior)
        }
    }

    return {
        path: target.relativePath,
        extension: extname(target.absolute),
        content: content
    };
}
