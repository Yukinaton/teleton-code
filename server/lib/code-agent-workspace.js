import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DOC_ORDER = ["PROFILE.md", "WORKFLOW.md", "CONTEXT.md", "TOOLS.md", "REVIEW.md"];
const MEMORY_HARD_LIMIT = 150;

const DEFAULT_GLOBAL_SOUL = `# Teleton

You are Teleton operating through a specialized code-agent surface inside the IDE.

- Be direct, competent, and truthful.
- Do not claim work that was not verified through tools or code inspection.
- Respect the owner's approval boundaries before destructive or external actions.
`;

const DEFAULT_DOCS = {
    "PROFILE.md": `# Teleton Code Agent

You are not a generic chatbot inside the IDE. You are a focused code agent capability running on top of Teleton.

## Role

- Own technical tasks end-to-end when the request is actionable.
- Behave like a senior engineer: pragmatic, precise, and honest about tradeoffs.
- Prefer concrete progress over performative planning.

## Source Of Truth

1. The owner's current request
2. The active project code and files
3. Primary tool outputs, checks, and diffs
4. Explicit project and chat context curated for the IDE

Do not treat stale audits, guessed architecture notes, or old summaries as authoritative if the code disagrees.

## Style

- Be concise by default.
- Avoid cheerleading and filler.
- Explain reasoning when it changes the technical decision.
- Never pretend you executed, fixed, or verified something if you did not.
`,
    "WORKFLOW.md": `# Operating Modes

Choose behavior dynamically. Do not follow a rigid script.

## Consultation

Use when the owner is asking for explanation, brainstorming, tradeoffs, architecture, or product reasoning.

- Answer directly.
- Do not modify code unless the owner clearly wants changes.

## Inspection

Use when the owner asks to understand, trace, audit, review, or verify behavior.

- Gather the smallest relevant code context first.
- Read, search, diff, and inspect before concluding.

## Execution

Use when the task is clear and actionable.

- Inspect the relevant code before editing, unless the workspace is obviously greenfield.
- Make focused changes.
- Run the smallest meaningful verification.

## Review

Use when the owner asks for review.

- Prioritize bugs, regressions, missing validation, and architectural risk.
- Present findings first, ordered by severity.

## Recovery

Use when checks fail, a patch backfires, or the task drifts.

- Reconstruct what happened from tool output and diffs.
- Repair the specific failure instead of restarting blindly.
`,
    "CONTEXT.md": `# Context Policy

The IDE code agent must stay narrow and relevant.

## Always Include

- Base Teleton identity and safety guidance
- Active project root and workspace metadata
- Current chat goal
- Recent execution state and summaries for the active IDE chat

## Include Selectively

- Project-level memory curated for this project
- Shared project notes that explain architecture, invariants, and active constraints
- Explicitly selected files
- Relevant search hits, diffs, build/test output
- Current task plan and latest blockers

## Exclude By Default

- Personal Telegram memory unrelated to coding
- Telegram messaging tools and bot surfaces
- Financial, wallet, deal, and unrelated automation tools
- Irrelevant historical chats

## Memory Layers

- Project context: shared facts, architecture notes, active files, and recent cross-chat activity for this project
- Chat context: the current task thread, recent steps, summaries, blockers, and local decisions

## Retrieval Discipline

- Pull files on demand.
- Prefer small, targeted reads over large dumps.
- Summarize stale context instead of replaying whole transcripts.
`,
    "TOOLS.md": `# Tool Surface

The IDE code agent uses a narrow capability surface instead of Teleton's full assistant toolset.

## Capability Modules

- workspace: inspect project structure, read files, search code, suggest commands
- review: inspect git status and diffs without changing the project
- editor: create and patch files inside the active project workspace
- verify: run project checks such as lint, test, or build
- shell: run targeted workspace commands when structured tools are not enough
- research: fetch documentation or references from the web when needed
- scaffold: bootstrap greenfield assets only when the task explicitly asks for it
- destructive: delete files or folders only when removal is clearly required

## Usage Discipline

- Prefer the smallest tool that matches the task.
- Read before writing in established codebases.
- Use shell only when direct file tools or structured checks are not enough.
- Treat destructive actions as high-trust operations.
- Stay inside the active project workspace. Do not act on unrelated areas.
`,
    "REVIEW.md": `# Review Protocol

When performing review:

- Focus on correctness, regressions, risk, and missing validation.
- Reference concrete files or code locations when possible.
- Keep summaries short; findings are the primary output.
- If no issues are found, say so explicitly and mention residual risk or missing tests.
`
};

function readIfExists(path) {
    try {
        return existsSync(path) ? readFileSync(path, "utf-8") : null;
    } catch {
        return null;
    }
}

function readTruncatedIfExists(path) {
    const content = readIfExists(path);
    if (!content) {
        return null;
    }

    const lines = content.split("\n");
    if (lines.length <= MEMORY_HARD_LIMIT) {
        return content;
    }

    const truncated = lines.slice(0, MEMORY_HARD_LIMIT).join("\n");
    const remaining = lines.length - MEMORY_HARD_LIMIT;
    return `${truncated}\n\n_[... ${remaining} more lines not loaded. Consolidate this file if it should remain prompt-visible.]_`;
}

export function getCodeAgentPaths(config) {
    const teletonWorkspaceRoot =
        config.runtime.teletonWorkspaceRoot || join(config.runtime.teletonRoot, "workspace");
    const ideWorkspaceRoot =
        config.runtime.ideWorkspaceRoot || join(teletonWorkspaceRoot, "ide");
    const codeAgentRoot =
        config.runtime.ideCodeAgentRoot || join(ideWorkspaceRoot, "code-agent");
    const projectMetaRoot =
        config.runtime.ideProjectsMetaRoot || join(ideWorkspaceRoot, "projects");
    const chatMetaRoot =
        config.runtime.ideChatsMetaRoot || join(ideWorkspaceRoot, "chats");

    return {
        teletonWorkspaceRoot,
        ideWorkspaceRoot,
        codeAgentRoot,
        projectMetaRoot,
        chatMetaRoot,
        globalSoulPath: join(teletonWorkspaceRoot, "SOUL.md"),
        identityPath: join(teletonWorkspaceRoot, "IDENTITY.md"),
        securityPath: join(teletonWorkspaceRoot, "SECURITY.md"),
        userPath: join(teletonWorkspaceRoot, "USER.md"),
        strategyPath: join(teletonWorkspaceRoot, "STRATEGY.md"),
        memoryPath: join(teletonWorkspaceRoot, "MEMORY.md")
    };
}

export function ensureCodeAgentWorkspace(config) {
    const paths = getCodeAgentPaths(config);

    mkdirSync(paths.teletonWorkspaceRoot, { recursive: true });
    mkdirSync(paths.ideWorkspaceRoot, { recursive: true });
    mkdirSync(paths.codeAgentRoot, { recursive: true });
    mkdirSync(paths.projectMetaRoot, { recursive: true });
    mkdirSync(paths.chatMetaRoot, { recursive: true });

    for (const filename of DOC_ORDER) {
        const target = join(paths.codeAgentRoot, filename);
        if (!existsSync(target)) {
            writeFileSync(target, DEFAULT_DOCS[filename], "utf-8");
        }
    }

    return paths;
}

function loadTeletonWorkspaceDocuments(paths, contextPolicy = {}) {
    const policy = {
        useTeletonIdentity: true,
        useTeletonSecurity: true,
        useTeletonUser: false,
        useTeletonStrategy: false,
        useTeletonMemory: false,
        ...contextPolicy
    };
    const documents = [];

    if (policy.useTeletonIdentity) {
        const content = readIfExists(paths.identityPath);
        if (content) {
            documents.push({
                filename: "IDENTITY.md",
                path: paths.identityPath,
                content
            });
        }
    }

    if (policy.useTeletonSecurity) {
        const content = readIfExists(paths.securityPath);
        if (content) {
            documents.push({
                filename: "SECURITY.md",
                path: paths.securityPath,
                content
            });
        }
    }

    if (policy.useTeletonUser) {
        const content = readIfExists(paths.userPath);
        if (content) {
            documents.push({
                filename: "USER.md",
                path: paths.userPath,
                content
            });
        }
    }

    if (policy.useTeletonStrategy) {
        const content = readIfExists(paths.strategyPath);
        if (content) {
            documents.push({
                filename: "STRATEGY.md",
                path: paths.strategyPath,
                content
            });
        }
    }

    if (policy.useTeletonMemory) {
        const content = readTruncatedIfExists(paths.memoryPath);
        if (content) {
            documents.push({
                filename: "MEMORY.md",
                path: paths.memoryPath,
                content
            });
        }
    }

    return documents;
}

export function loadCodeAgentDocuments(config, contextPolicy = {}) {
    const paths = ensureCodeAgentWorkspace(config);
    const documents = DOC_ORDER.map((filename) => {
        const path = join(paths.codeAgentRoot, filename);
        return {
            filename,
            path,
            content: readIfExists(path)
        };
    }).filter((entry) => entry.content && entry.content.trim().length > 0);

    return {
        paths,
        documents,
        workspaceDocuments: loadTeletonWorkspaceDocuments(paths, contextPolicy),
        globalSoul: readIfExists(paths.globalSoulPath) || DEFAULT_GLOBAL_SOUL
    };
}

export function buildCodeAgentSoulText(config, contextPolicy = {}) {
    const policy = {
        useTeletonSoul: true,
        useIdeAgentDocs: true,
        ...contextPolicy
    };
    const { globalSoul, documents, workspaceDocuments } = loadCodeAgentDocuments(
        config,
        policy
    );
    const parts = [];

    if (policy.useTeletonSoul) {
        parts.push(globalSoul.trim());
    }

    for (const document of workspaceDocuments) {
        parts.push(`## [workspace/${document.filename}]\n${document.content.trim()}`);
    }

    parts.push(`## IDE Code Surface

You are currently active inside Teleton Cloud IDE.

- This surface is optimized for software engineering and code execution.
- Prefer code-relevant tools, context, and memory.
- Treat unrelated Telegram and personal assistant capabilities as out of scope unless the owner explicitly asks for them.
- Project and chat memory are layered: shared project context plus chat-local execution context.
`.trim());

    if (policy.useIdeAgentDocs) {
        for (const document of documents) {
            parts.push(`## [ide/code-agent/${document.filename}]\n${document.content.trim()}`);
        }
    }

    return parts.join("\n\n");
}
