import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function readTextIfExists(path) {
    try {
        if (!existsSync(path)) {
            return null;
        }
        return readFileSync(path, "utf-8");
    } catch {
        return null;
    }
}

function collapseWhitespace(value) {
    return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function dedupeInstructionLines(chunks = []) {
    const seen = new Set();
    const lines = [];

    for (const chunk of chunks) {
        for (const rawLine of String(chunk || "").replace(/\r\n/g, "\n").split("\n")) {
            const line = rawLine.trimEnd();
            const normalized = collapseWhitespace(line);
            if (!normalized) {
                if (lines[lines.length - 1] !== "") {
                    lines.push("");
                }
                continue;
            }
            if (seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            lines.push(line);
        }
    }

    return lines.join("\n").trim();
}

function collectCommandCandidates(content) {
    const source = String(content || "");
    const candidates = [];

    for (const match of source.matchAll(/`([^`\n]+)`/g)) {
        candidates.push(match[1]);
    }

    for (const match of source.matchAll(/```(?:bash|sh|shell|powershell|pwsh)?\n([\s\S]*?)```/gi)) {
        const body = String(match[1] || "");
        for (const line of body.split("\n")) {
            candidates.push(line);
        }
    }

    for (const rawLine of source.replace(/\r\n/g, "\n").split("\n")) {
        candidates.push(rawLine);
    }

    return candidates.map((value) => collapseWhitespace(value)).filter(Boolean);
}

function isVerifyCommand(command) {
    return /(?:^|[\s./-])(check|lint|test|build|verify|typecheck)(?:$|[\s:-])/i.test(String(command || ""));
}

function isSetupCommand(command) {
    return /\b(?:npm|pnpm|yarn|bun|make|uv|pip|cargo|go)\b/i.test(String(command || ""));
}

function normalizeCommand(command) {
    return collapseWhitespace(command).replace(/\s+/g, " ").trim();
}

function collectCommandsFromDocuments(documents = []) {
    const verifyCommands = [];
    const setupCommands = [];
    const seenVerify = new Set();
    const seenSetup = new Set();

    for (const document of documents) {
        for (const candidate of collectCommandCandidates(document.content)) {
            const normalized = normalizeCommand(candidate);
            if (!normalized) {
                continue;
            }

            if (isVerifyCommand(normalized) && !seenVerify.has(normalized)) {
                seenVerify.add(normalized);
                verifyCommands.push(normalized);
            }

            if (isSetupCommand(normalized) && !seenSetup.has(normalized)) {
                seenSetup.add(normalized);
                setupCommands.push(normalized);
            }
        }
    }

    return {
        verifyCommands,
        setupCommands
    };
}

function collectCommandsFromPackageJson(workspacePath) {
    const packagePath = join(workspacePath, "package.json");
    const source = readTextIfExists(packagePath);
    if (!source) {
        return { verifyCommands: [], setupCommands: [] };
    }

    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch {
        return { verifyCommands: [], setupCommands: [] };
    }

    const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    const verifyCommands = [];

    for (const scriptName of ["check", "lint", "test", "build", "verify", "typecheck"]) {
        if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim()) {
            verifyCommands.push(`npm run ${scriptName}`);
        }
    }

    return {
        verifyCommands,
        setupCommands: ["npm install"]
    };
}

function summarizeInstructions(documents = []) {
    if (documents.length === 0) {
        return "";
    }

    const chunks = documents.map((document) => `## ${document.name}\n${document.content.trim()}`);
    return dedupeInstructionLines(chunks);
}

export function collectProjectInstructions(workspace, options = {}) {
    const workspacePath = workspace?.path || null;
    const systemInstructionsRoot = options?.systemInstructionsRoot || null;

    if (!workspacePath && !systemInstructionsRoot) {
        return {
            documents: [],
            instructionText: "",
            verifyCommands: [],
            setupCommands: []
        };
    }

    const files = [
        {
            name: "AGENTS.md",
            paths: [workspacePath ? join(workspacePath, "AGENTS.md") : null, systemInstructionsRoot ? join(systemInstructionsRoot, "AGENTS.md") : null],
            priority: 1
        },
        {
            name: "CLAUDE.md",
            paths: [workspacePath ? join(workspacePath, "CLAUDE.md") : null, systemInstructionsRoot ? join(systemInstructionsRoot, "CLAUDE.md") : null],
            priority: 2
        }
    ];

    const documents = files
        .map((entry) => {
            for (const candidatePath of entry.paths.filter(Boolean)) {
                const content = readTextIfExists(candidatePath);
                if (content && content.trim().length > 0) {
                    return {
                        name: entry.name,
                        path: candidatePath,
                        priority: entry.priority,
                        content: String(content).trim()
                    };
                }
            }

            return null;
        })
        .filter(Boolean)
        .filter((entry) => entry.content && entry.content.trim().length > 0)
        .sort((left, right) => left.priority - right.priority)
        .map(({ name, path, content }) => ({
            name,
            path,
            content: String(content || "").trim()
        }));

    const documentCommands = collectCommandsFromDocuments(documents);
    const packageCommands = workspacePath
        ? collectCommandsFromPackageJson(workspacePath)
        : { verifyCommands: [], setupCommands: [] };
    const verifyCommands = [...new Set([...documentCommands.verifyCommands, ...packageCommands.verifyCommands])];
    const setupCommands = [...new Set([...documentCommands.setupCommands, ...packageCommands.setupCommands])];

    return {
        documents,
        instructionText: summarizeInstructions(documents),
        verifyCommands,
        setupCommands
    };
}
