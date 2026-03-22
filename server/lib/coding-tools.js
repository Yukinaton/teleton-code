import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
    DEFAULT_SEARCH_LIMIT,
    DIFF_LIMIT,
    READ_LIMIT,
    fallbackSearch,
    isDangerousCommand,
    listWorkspaceTree,
    readWorkspaceFile,
    resolveInsideWorkspace,
    runPowerShell,
    searchTextWithRg
} from "./workspace-utils.js";
import { validateLikelySourcePayload, validateSourceCandidate } from "./validation-engine.js";

const WRITE_LIMIT = 300_000;
const SEARCH_CONTEXT_RADIUS = 3;
const JSON_WRITE_LIMIT = 500_000;
const PACKAGE_NAME_PATTERN = /^(?:@[\w.-]+\/)?[\w.-]+(?:@[\w.+-]+)?$/i;
const SERIALIZED_SOURCE_SENTINEL_PREFIX = "__teleton_code_invalid_serialized_source__:";

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function safeLooseStructuredParse(text) {
    const source = String(text || "").trim();
    if (!source || !/^[\[{]/.test(source)) {
        return null;
    }

    let normalized = source;
    // Normalize common LLM near-miss payloads like:
    // [{'body': {'margin': '0'}}, {'.app': {'display': 'grid'}}]
    normalized = normalized
        .replace(/([{,]\s*)'([^'\\]+?)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^'\\]*?)'(?=\s*[,}\]])/g, ': "$1"')
        .replace(/\[\s*'([^'\\]*?)'(?=\s*[,}\]])/g, '["$1"')
        .replace(/,\s*'([^'\\]*?)'(?=\s*[,}\]])/g, ', "$1"');

    return safeJsonParse(normalized);
}

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}

function sanitizePackageList(rawPackages) {
    const items = String(rawPackages || "")
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);

    if (items.length === 0) {
        throw new Error("At least one package name is required");
    }

    for (const item of items) {
        if (!PACKAGE_NAME_PATTERN.test(item)) {
            throw new Error(`Unsafe package specifier: ${item}`);
        }
    }

    return items;
}

function stringifyJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function decodeEscapedSourceLikeString(text) {
    const source = String(text ?? "");
    const actualNewlines = (source.match(/\n/g) || []).length;
    const escapedNewlines = (source.match(/\\n/g) || []).length;

    if (escapedNewlines < 3 || actualNewlines > 2) {
        return source;
    }

    let candidate = source;
    const trimmed = candidate.trim();

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        try {
            const normalizedQuotes = trimmed.startsWith("'")
                ? `"${trimmed.slice(1, -1).replace(/"/g, '\\"')}"`
                : trimmed;
            const parsed = JSON.parse(normalizedQuotes);
            if (typeof parsed === "string") {
                return parsed;
            }
        } catch {
            // Fall back to lightweight unescaping below.
        }
    }

    candidate = candidate
        .replace(/\\r\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");

    return candidate;
}

function isSourceLikeFile(relativePath) {
    return /\.(html|htm|css|js|mjs|cjs|jsx|ts|tsx|py|json|md|txt)$/i.test(String(relativePath || ""));
}

function trimToSourceAnchor(relativePath, content) {
    const source = decodeEscapedSourceLikeString(content);
    const extension = String(relativePath || "").toLowerCase();
    const patterns = [];

    if (/\.(html|htm)$/.test(extension)) {
        patterns.push(/<!doctype html[\s\S]*$/i, /<html\b[\s\S]*$/i, /<body\b[\s\S]*$/i);
    } else if (/\.css$/.test(extension)) {
        patterns.push(
            /(?:^|\n)\s*(?::root|body|html|main|canvas|button|[.#][\w-]+|[\w-]+\s*\{)[\s\S]*$/i,
            /(?:^|\n)\s*@(?:media|keyframes|supports)\b[\s\S]*$/i
        );
    } else if (/\.(js|mjs|cjs|jsx|ts|tsx)$/.test(extension)) {
        patterns.push(
            /(?:^|\n)\s*(?:\/\/|\/\*)[\s\S]*$/,
            /(?:^|\n)\s*(?:const|let|var|function|class|import|export)\b[\s\S]*$/,
            /(?:^|\n)\s*(?:document|window)\.[\s\S]*$/,
            /(?:^|\n)\s*addEventListener\b[\s\S]*$/,
            /(?:^|\n)\s*requestAnimationFrame\b[\s\S]*$/
        );
    } else if (/\.py$/.test(extension)) {
        patterns.push(
            /(?:^|\n)\s*(?:#|from|import|def|class|async\s+def|if __name__\s*==|@[\w.]+|[A-Za-z_][\w]*\s*=)\b[\s\S]*$/m
        );
    } else if (/\.json$/.test(extension) || /\.(md|txt)$/.test(extension)) {
        return source;
    }

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (!match?.[0]) {
            continue;
        }

        const candidate = match[0].trimStart();
        const removedPrefix = source.length - candidate.length;
        if (candidate.length >= 120 && removedPrefix >= 8) {
            return candidate;
        }
    }

    return source;
}

function collectFencedSourceCandidates(text, candidates) {
    const source = String(text || "");
    const fencePattern = /```[\w-]*\n([\s\S]*?)```/g;
    let match;
    while ((match = fencePattern.exec(source)) !== null) {
        const candidate = decodeEscapedSourceLikeString(match[1] || "");
        if (candidate.trim()) {
            candidates.push(candidate);
        }
    }
}

function scoreSourceCandidate(relativePath, content) {
    const source = trimToSourceAnchor(relativePath, content);
    const trimmed = String(source || "").trim();
    if (!trimmed) {
        return -1;
    }

    let score = Math.min(trimmed.length, 1200) / 24;
    const lineCount = trimmed.split(/\r?\n/).length;
    score += Math.min(lineCount, 60) * 1.5;

    if (/^__teleton_code_invalid_serialized_source__:/i.test(trimmed)) {
        return -1;
    }

    if (/\\n/.test(trimmed) && !/\n/.test(trimmed)) {
        score -= 10;
    }

    const extension = String(relativePath || "").toLowerCase();
    if (/\.(html|htm)$/.test(extension)) {
        if (/<(?:!doctype|html|head|body|div|main|section|script|style)\b/i.test(trimmed)) {
            score += 30;
        }
        if (/<[a-z][\s\S]*>/.test(trimmed)) {
            score += 12;
        }
    } else if (/\.css$/.test(extension)) {
        if (/[.#@a-z-][^{\n]*\{[\s\S]*:[^;]+;[\s\S]*\}/i.test(trimmed)) {
            score += 30;
        }
        if (/\b(?:display|position|color|background|font|margin|padding|grid|flex)\s*:/i.test(trimmed)) {
            score += 12;
        }
    } else if (/\.(js|mjs|cjs|jsx|ts|tsx)$/.test(extension)) {
        if (/\b(?:const|let|var|function|class|import|export|return|document|window|addEventListener|requestAnimationFrame|=>)\b/.test(trimmed)) {
            score += 30;
        }
        if (/[;{}]/.test(trimmed)) {
            score += 10;
        }
    } else if (/\.py$/.test(extension)) {
        if (/^\s*(?:from|import|def|class|async\s+def|if __name__\s*==|@[\w.]+|[A-Za-z_][\w]*\s*=)/m.test(trimmed)) {
            score += 30;
        }
        if (/:\s*(?:#.*)?$/m.test(trimmed) || /\breturn\b/.test(trimmed)) {
            score += 10;
        }
    } else if (/\.json$/.test(extension)) {
        try {
            JSON.parse(trimmed);
            score += 28;
        } catch {
            score -= 20;
        }
    } else if (/\.(md|txt)$/.test(extension)) {
        score += 8;
    }

    if (/^\s*[\[{]/.test(trimmed) && !/<[a-z]/i.test(trimmed)) {
        score -= 28;
    }

    return score;
}

function looksLikeHtmlSource(content) {
    const source = String(content || "").trim();
    if (!source || /^\s*\[\s*[{'"`]/.test(source)) {
        return false;
    }

    return (
        /<!doctype html>/i.test(source) ||
        (/<html[\s>]/i.test(source) && /<body[\s>]/i.test(source))
    );
}

function looksLikeCssSource(content) {
    const source = String(content || "").trim();
    if (!source || /^\s*\[\s*[{'"`]/.test(source) || /^\s*\{\s*['"`]/.test(source)) {
        return false;
    }

    const open = (source.match(/\{/g) || []).length;
    const close = (source.match(/\}/g) || []).length;
    if (open === 0 || open !== close) {
        return false;
    }

    return (
        /(?:^|\n)\s*(?:@(?:media|supports|keyframes)|:root|body|html|main|canvas|button|[.#][\w-]+|[\w-]+\s*\{)/i.test(source) &&
        /:\s*[^;]+;/i.test(source)
    );
}

function looksLikeScriptSource(content) {
    const source = String(content || "").trim();
    if (!source || /^\s*\[\s*[{'"`]/.test(source) || /^\s*\{\s*['"`]/.test(source)) {
        return false;
    }

    return /\b(?:const|let|var|function|class|import|export|return|document|window|addEventListener|requestAnimationFrame)\b|=>/.test(
        source
    );
}

function looksLikePythonSource(content) {
    const source = String(content || "").trim();
    if (!source || /^\s*\[\s*[{'"`]/.test(source) || /^\s*\{\s*['"`]/.test(source)) {
        return false;
    }

    return /^\s*(?:from|import|def|class|async\s+def|if __name__\s*==|@[\w.]+|[A-Za-z_][\w]*\s*=)/m.test(
        source
    );
}

function looksLikeJsonSource(content) {
    const source = String(content || "").trim();
    if (!source) {
        return false;
    }

    try {
        JSON.parse(source);
        return true;
    } catch {
        return false;
    }
}

function isPreferredRecoveredSource(relativePath, content) {
    const normalizedPath = String(relativePath || "").toLowerCase();
    if (/\.(html?|htm)$/i.test(normalizedPath)) {
        return looksLikeHtmlSource(content);
    }
    if (/\.css$/i.test(normalizedPath)) {
        return looksLikeCssSource(content);
    }
    if (/\.(js|mjs|cjs|jsx|ts|tsx)$/i.test(normalizedPath)) {
        return looksLikeScriptSource(content);
    }
    if (/\.py$/i.test(normalizedPath)) {
        return looksLikePythonSource(content);
    }
    if (/\.json$/i.test(normalizedPath)) {
        return looksLikeJsonSource(content);
    }
    return false;
}

function collectStructuredSourceCandidates(value, candidates, seen) {
    if (value == null) {
        return;
    }

    if (typeof value === "string") {
        const decoded = decodeEscapedSourceLikeString(value);
        if (decoded.trim()) {
            candidates.push(decoded);
        }
        return;
    }

    if (typeof value !== "object") {
        return;
    }

    if (seen.has(value)) {
        return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        if (value.every((item) => typeof item === "string")) {
            const joined = decodeEscapedSourceLikeString(value.join("\n"));
            if (joined.trim()) {
                candidates.push(joined);
            }
        }

        for (const item of value) {
            collectStructuredSourceCandidates(item, candidates, seen);
        }
        return;
    }

    const prioritizedKeys = [
        "content",
        "code",
        "text",
        "source",
        "html",
        "css",
        "js",
        "javascript",
        "typescript",
        "script",
        "lines",
        "body",
        "template",
        "markup"
    ];

    for (const key of prioritizedKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            collectStructuredSourceCandidates(value[key], candidates, seen);
        }
    }

    for (const nestedValue of Object.values(value)) {
        collectStructuredSourceCandidates(nestedValue, candidates, seen);
    }
}

function collectQuotedSourceCandidates(relativePath, text, candidates) {
    const source = String(text || "");
    collectFencedSourceCandidates(source, candidates);
    const patterns = [
        /"((?:[^"\\]|\\[\s\S]){40,})"/g,
        /'((?:[^'\\]|\\[\s\S]){40,})'/g,
        /`((?:[^`\\]|\\[\s\S]){40,})`/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const decoded = decodeEscapedSourceLikeString(match[1]);
            if (decoded.trim()) {
                candidates.push(decoded);
                const anchored = trimToSourceAnchor(relativePath, decoded);
                if (anchored.trim() && anchored !== decoded) {
                    candidates.push(anchored);
                }
            }
        }
    }
}

function extractPseudoStringArrayPrefix(text) {
    const source = String(text || "").trim();
    const startIndex = source.search(/\[\s*['"`]/);
    if (startIndex === -1) {
        return "";
    }

    const candidateSource = source.slice(startIndex);

    const lines = [];
    let index = 1;
    let activeQuote = null;
    let buffer = "";
    let escaping = false;

    while (index < candidateSource.length) {
        const char = candidateSource[index];

        if (!activeQuote) {
            if (char === "]") {
                return lines.length > 0 ? lines.join("\n") : "";
            }

            if (char === "'" || char === '"' || char === "`") {
                activeQuote = char;
                buffer = "";
            }

            index += 1;
            continue;
        }

        if (escaping) {
            buffer += `\\${char}`;
            escaping = false;
            index += 1;
            continue;
        }

        if (char === "\\") {
            escaping = true;
            index += 1;
            continue;
        }

        if (char === activeQuote) {
            const decoded = decodeEscapedSourceLikeString(buffer);
            if (decoded.trim()) {
                lines.push(decoded);
            }
            activeQuote = null;
            buffer = "";
            index += 1;
            continue;
        }

        buffer += char;
        index += 1;
    }

    return "";
}

function collectStructuredSourceFragments(value, fragments, seen) {
    if (value == null) {
        return;
    }

    if (typeof value === "string") {
        const decoded = decodeEscapedSourceLikeString(value);
        if (decoded.trim()) {
            fragments.push(decoded);
        }
        return;
    }

    if (typeof value !== "object" || seen.has(value)) {
        return;
    }

    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            collectStructuredSourceFragments(item, fragments, seen);
        }
        return;
    }

    const prioritizedKeys = [
        "line",
        "text",
        "content",
        "code",
        "source",
        "value",
        "body",
        "template",
        "html",
        "css",
        "js",
        "javascript",
        "typescript"
    ];

    for (const key of prioritizedKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            collectStructuredSourceFragments(value[key], fragments, seen);
        }
    }

    for (const [key, nestedValue] of Object.entries(value)) {
        if (prioritizedKeys.includes(key)) {
            continue;
        }
        collectStructuredSourceFragments(nestedValue, fragments, seen);
    }
}

function flattenStructuredSourceFragments(value) {
    const fragments = [];
    collectStructuredSourceFragments(value, fragments, new Set());

    const normalized = fragments
        .map((item) => String(item || "").trim())
        .filter(Boolean);

    if (normalized.length === 0) {
        return "";
    }

    return normalized.join("\n");
}

function serializeCssDeclarations(value, indent = "  ") {
    if (typeof value === "string") {
        const trimmed = decodeEscapedSourceLikeString(value).trim();
        return trimmed ? `${indent}${trimmed}` : "";
    }

    if (Array.isArray(value)) {
        const lines = value
            .map((item) => serializeCssDeclarations(item, indent))
            .filter(Boolean);
        return lines.join("\n");
    }

    if (!isPlainObject(value)) {
        return "";
    }

    return Object.entries(value)
        .map(([property, propertyValue]) => {
            if (propertyValue == null || propertyValue === "") {
                return "";
            }

            if (isPlainObject(propertyValue)) {
                const nested = serializeCssDeclarations(propertyValue, `${indent}  `);
                return nested
                    ? `${indent}${String(property).trim()} {\n${nested}\n${indent}}`
                    : "";
            }

            if (Array.isArray(propertyValue)) {
                const joined = propertyValue
                    .map((item) => String(item ?? "").trim())
                    .filter(Boolean)
                    .join(" ");
                return joined ? `${indent}${String(property).trim()}: ${joined};` : "";
            }

            return `${indent}${String(property).trim()}: ${String(propertyValue).trim()};`;
        })
        .filter(Boolean)
        .join("\n");
}

function trySerializeCssStructure(value) {
    if (Array.isArray(value)) {
        const blocks = value.map((item) => trySerializeCssStructure(item)).filter(Boolean);
        return blocks.join("\n\n");
    }

    if (!isPlainObject(value)) {
        return "";
    }

    const selector = typeof value.selector === "string" ? value.selector.trim() : "";
    const declarationSource = serializeCssDeclarations(
        value.declarations || value.styles || value.rules || value.properties || null
    );
    if (selector && declarationSource) {
        return `${selector} {\n${declarationSource}\n}`;
    }

    const selectorBlocks = Object.entries(value)
        .map(([key, nestedValue]) => {
            if (!nestedValue || !isPlainObject(nestedValue)) {
                return "";
            }

            const body = serializeCssDeclarations(nestedValue);
            return body ? `${String(key).trim()} {\n${body}\n}` : "";
        })
        .filter(Boolean);

    if (selectorBlocks.length > 0) {
        return selectorBlocks.join("\n\n");
    }

    return "";
}

export function coerceStructuredSourceValue(relativePath, value, options = {}) {
    const strictStructured = options?.strictStructured !== false;
    const original = typeof value === "string" ? value : JSON.stringify(value);
    const source = String(original ?? "");

    if (!isSourceLikeFile(relativePath)) {
        return {
            content: source,
            normalized: false
        };
    }

    const decoded = decodeEscapedSourceLikeString(source);
    const trimmed = decoded.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) {
        return {
            content: decoded,
            normalized: decoded !== source
        };
    }

    const pseudoLineArray = extractPseudoStringArrayPrefix(trimmed);
    const parsed = safeJsonParse(trimmed) || safeLooseStructuredParse(trimmed);
    const structuredPayloadDetected = Boolean(parsed) || Boolean(pseudoLineArray.trim()) || /^[\[{]/.test(trimmed);
    const candidates = [];
    if (pseudoLineArray.trim()) {
        if (isPreferredRecoveredSource(relativePath, pseudoLineArray)) {
            return {
                content: pseudoLineArray,
                normalized: pseudoLineArray !== source
            };
        }
        candidates.push(pseudoLineArray);
    }
    if (parsed) {
        if (/\.json$/i.test(relativePath)) {
            const jsonCandidate = stringifyJson(parsed);
            return {
                content: jsonCandidate,
                normalized: jsonCandidate !== source
            };
        }
        if (/\.css$/i.test(relativePath)) {
            const cssCandidate = trySerializeCssStructure(parsed);
            if (cssCandidate.trim()) {
                if (isPreferredRecoveredSource(relativePath, cssCandidate)) {
                    return {
                        content: cssCandidate,
                        normalized: cssCandidate !== source
                    };
                }
                candidates.push(cssCandidate);
            }
        }
        collectStructuredSourceCandidates(parsed, candidates, new Set());
        const flattened = flattenStructuredSourceFragments(parsed);
        if (flattened.trim()) {
            if (isPreferredRecoveredSource(relativePath, flattened)) {
                return {
                    content: flattened,
                    normalized: flattened !== source
                };
            }
            candidates.push(flattened);
        }
    } else {
        collectQuotedSourceCandidates(relativePath, trimmed, candidates);
    }
    if (decoded.trim()) {
        candidates.push(decoded);
        const anchoredDecoded = trimToSourceAnchor(relativePath, decoded);
        if (anchoredDecoded.trim() && anchoredDecoded !== decoded) {
            candidates.push(anchoredDecoded);
        }
    }

    let bestCandidate = null;
    let bestScore = -1;
    for (const candidate of candidates) {
        const score = scoreSourceCandidate(relativePath, candidate);
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    if (
        bestCandidate &&
        bestScore >= 0 &&
        (
            !structuredPayloadDetected ||
            isPreferredRecoveredSource(relativePath, bestCandidate) ||
            !strictStructured
        )
    ) {
        return {
            content: bestCandidate,
            normalized: bestCandidate !== source
        };
    }

    if (structuredPayloadDetected) {
        return {
            content: `${SERIALIZED_SOURCE_SENTINEL_PREFIX}${String(relativePath || "unknown")}`,
            normalized: true
        };
    }

    return {
        content: decoded,
        normalized: decoded !== source
    };
}

function coerceStructuredSourcePayload(relativePath, content) {
    return coerceStructuredSourceValue(relativePath, content);
}

function normalizeLineArray(lines, relativePath) {
    if (!Array.isArray(lines)) {
        throw new Error(`"${relativePath}" requires an array of plain source lines.`);
    }

    if (lines.some((line) => typeof line !== "string")) {
        throw new Error(
            `CRITICAL ERROR: "${relativePath}" received non-string line items. Provide one plain source line per array item, without nested arrays or objects.`
        );
    }

    return lines;
}

function inspectWorkspaceProject(workspacePath) {
    const packagePath = resolveInsideWorkspace(workspacePath, "package.json").absolute;
    const tsconfigPath = resolveInsideWorkspace(workspacePath, "tsconfig.json").absolute;
    const entries = listWorkspaceTree(workspacePath, "", 2).entries;
    const packageJson = existsSync(packagePath) ? safeJsonParse(readFileSync(packagePath, "utf-8")) : null;
    const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
    const dependencies = {
        ...(packageJson?.dependencies || {}),
        ...(packageJson?.devDependencies || {})
    };
    const stack = [];

    if (dependencies.react) stack.push("React");
    if (dependencies.vue) stack.push("Vue");
    if (dependencies.svelte) stack.push("Svelte");
    if (dependencies.next) stack.push("Next.js");
    if (dependencies.vite) stack.push("Vite");
    if (dependencies.typescript || existsSync(tsconfigPath)) stack.push("TypeScript");
    if (dependencies.tailwindcss) stack.push("Tailwind CSS");
    if (dependencies.express) stack.push("Express");

    const topLevel = entries.filter((entry) => !entry.path.includes("\\") && !entry.path.includes("/")).slice(0, 30);

    return {
        packageJsonPresent: !!packageJson,
        scripts,
        stack,
        topLevelEntries: topLevel
    };
}

function suggestWorkspaceCommands(inspection) {
    const suggestions = [];
    const scripts = inspection.scripts || {};

    if (scripts.install) {
        suggestions.push({ kind: "setup", command: "npm run install", source: "package.json" });
    } else if (inspection.packageJsonPresent) {
        suggestions.push({ kind: "setup", command: "npm install", source: "package.json" });
    }

    for (const name of ["dev", "start", "build", "test", "lint", "check"]) {
        if (scripts[name]) {
            suggestions.push({ kind: name, command: `npm run ${name}`, source: "package.json" });
        }
    }

    if (!inspection.packageJsonPresent) {
        suggestions.push({
            kind: "preview",
            command: "python -m http.server 8000",
            source: "static-fallback"
        });
    }

    return suggestions;
}

function chooseProjectCheckCommands(inspection) {
    const suggestions = [];
    const scripts = inspection.scripts || {};

    for (const name of ["check", "lint", "test", "build"]) {
        if (scripts[name]) {
            suggestions.push({
                kind: name,
                command: `npm run ${name}`
            });
        }
    }

    return suggestions.slice(0, 4);
}

async function tavilyWebSearch(apiKey, query, count, topic) {
    const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: count,
            topic,
            search_depth: "basic",
            include_answer: true
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Tavily request failed (${response.status}): ${text}`);
    }

    return response.json();
}

function buildSearchContextSnippets(workspaceRoot, matches, query) {
    const snippets = [];
    const seen = new Set();

    for (const match of matches) {
        if (snippets.length >= 12) {
            break;
        }

        const target = resolveInsideWorkspace(workspaceRoot, match.file);
        const key = `${target.relativePath}:${match.line}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);

        let content = "";
        try {
            const stats = statSync(target.absolute);
            if (stats.size > READ_LIMIT) {
                continue;
            }
            content = readFileSync(target.absolute, "utf-8");
        } catch {
            continue;
        }

        const rows = content.split(/\r?\n/);
        const lineIndex = Math.max(0, Number(match.line || 1) - 1);
        const start = Math.max(0, lineIndex - SEARCH_CONTEXT_RADIUS);
        const end = Math.min(rows.length, lineIndex + SEARCH_CONTEXT_RADIUS + 1);
        const window = rows.slice(start, end).map((text, index) => ({
            line: start + index + 1,
            text
        }));
        const fileLower = String(match.file || "").toLowerCase();
        const pathHits = fileLower.includes(String(query || "").toLowerCase()) ? 1 : 0;

        snippets.push({
            file: target.relativePath,
            matchLine: Number(match.line || 1),
            preview: window,
            score: Math.max(1, pathHits + 1)
        });
    }

    return snippets;
}

function detectSuspiciousSerializedPayload(relativePath, content) {
    const source = String(content || "").trim();
    if (!source) return null;

    if (new RegExp(`^${SERIALIZED_SOURCE_SENTINEL_PREFIX}`, "i").test(source)) {
        return `CRITICAL ERROR: "${relativePath}" still contains a rejected serialized source payload. Write the real file content as plain source code, not a wrapped array or object dump.`;
    }

    if (/\.json$/i.test(relativePath)) {
        try {
            JSON.parse(source);
        } catch (error) {
            return `CRITICAL ERROR: "${relativePath}" must contain valid JSON. ${error.message}`;
        }
    }

    const isCodeFile = /\.(html|css|js|mjs|cjs|jsx|ts|tsx|py)$/i.test(relativePath);
    if (!isCodeFile) return null;
    const isScriptLikeFile = /\.(js|mjs|cjs|jsx|ts|tsx|py)$/i.test(relativePath);
    const genericPayloadProblem = validateLikelySourcePayload(relativePath, source);
    if (genericPayloadProblem) {
        return `CRITICAL ERROR: ${genericPayloadProblem}. Write plain code only, without JSON-like wrapper arrays or object dumps. If the file already exists, repair it with a narrow patch or a clean line-based rewrite.`;
    }

    // Check if it's a JSON array. CSS often starts with [ (attr selectors). JS/TS often starts with [ (destructuring).
    // We only block if it starts with [ and ends with ] AND is valid JSON array.
    // Catch common hallucination patterns: blocks starting with [{ ' or [{ " or { "
    if (/^\[\s*\{\s*['"]/.test(source) || /^\{\s*['"]/.test(source) || /^\[\s*["'`]/.test(source)) {
        // Double check if it's just a valid CSS selector or JS block
        const isLikelyCode = (source.startsWith('{') && source.includes(';') && !source.includes(': {')) || 
                           (source.startsWith('[') && !source.includes('":') && !source.includes("':"));
                           
        if (!isLikelyCode || source.includes("['") || source.includes('["')) {
        return `CRITICAL ERROR: You are trying to write a serialized structure instead of plain source code to "${relativePath}". You must provide ONLY the raw file content without wrapper arrays, objects, selector maps, or dictionary dumps. If the file already exists, repair it with a narrow patch or a clean line-based rewrite.`;
        }
    }

    if (/^\{[\s\S]*'[^']+'\s*:/.test(source)) {
        return `CRITICAL ERROR: "${relativePath}" looks like a Python-style object literal with single-quoted keys. Write real source code or valid JSON only.`;
    }

    const containsEscapedCodeBlob = /\\n\s*(?:const|let|var|function|class|import|export|document|window|getelementbyid|addEventListener|playerReset|updateScore|requestAnimationFrame)\b/i.test(
        source
    );
    if (
        isScriptLikeFile &&
        /^\s*\[\s*\[/.test(source) &&
        containsEscapedCodeBlob
    ) {
        return `CRITICAL ERROR: "${relativePath}" contains a serialized array payload with escaped source code inside it. Write plain executable script text only. If the file already exists, repair it with a narrow patch or a clean line-based rewrite.`;
    }

    if (
        isScriptLikeFile &&
        /['"`][^'"`]{0,240}\\n(?:const|let|var|function|class|import|export|document|window|getelementbyid|addEventListener|playerReset|updateScore|requestAnimationFrame)\b/i.test(
            source
        )
    ) {
        return `CRITICAL ERROR: "${relativePath}" contains quoted escaped script source instead of real file content. Send raw source text, not a serialized string blob. If the file already exists, repair it with a narrow patch or a clean line-based rewrite.`;
    }

    if (source.startsWith("[") && source.endsWith("]")) {
        try {
            // Try a more lenient parse if possible or just check structure
            const cleaned = source.replace(/'/g, '"'); // Tentative fix for single quotes
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
                return `CRITICAL ERROR: You sent a serialized JSON array instead of real source code for "${relativePath}". You must send the actual file content as plain text, not a wrapped data structure. If the file already exists, repair it with a narrow patch or a clean line-based rewrite.`;
            }
        } catch (e) {
            // Not JSON or non-fixable single quotes
        }
    }

    if (isScriptLikeFile) {
        const startsLikeSerializedData = /^[\[{]/.test(source);
        const quotedKeyPairs = (source.match(/['"`][\w$ -]+['"`]\s*:/g) || []).length;
        const scriptSignals = /\b(?:const|let|var|function|class|import|export|return|document|window|localStorage|addEventListener|JSON|Array|Object|new|from|def|async|await|print|if __name__)\b|=>/.test(source);
        const pythonLiteralSignals = /\b(?:False|True|None)\b/.test(source);

        if (
            startsLikeSerializedData &&
            (quotedKeyPairs >= 2 || pythonLiteralSignals) &&
            !scriptSignals
        ) {
            return `CRITICAL ERROR: "${relativePath}" looks like serialized data instead of executable source code. Write plain code only, without JSON-like wrapper arrays or object dumps. If the file already exists, repair it with a narrow patch or a clean line-based rewrite.`;
        }
    }

    return null;
}

function canonicalizeRejectedSourceParams(params, relativePath) {
    if (!params || typeof params !== "object") {
        return;
    }

    const sentinel = `${SERIALIZED_SOURCE_SENTINEL_PREFIX}${String(relativePath || "unknown")}`;
    const previewSource =
        typeof params.content === "string"
            ? params.content
            : Array.isArray(params.lines)
              ? params.lines.join("\n")
              : "";
    const preview = String(previewSource || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);

    if (typeof params.content === "string") {
        params.content = sentinel;
    }

    if (Array.isArray(params.lines)) {
        params.lines = [sentinel];
    }

    params.__teletonCodeRejectedSourceMeta = {
        path: String(relativePath || "unknown"),
        preview
    };
}

function getValidationServiceConfig(context) {
    return (
        context?.serviceConfig ||
        context?.config?.serviceConfig || {
            runtime: {
                maxShellTimeoutMs: 120000
            }
        }
    );
}

async function ensureValidCompleteSource(target, content, context, workspacePath) {
    const sourceValidationProblem = await validateSourceCandidate(
        target.relativePath,
        content,
        getValidationServiceConfig(context),
        workspacePath
    );
    if (sourceValidationProblem) {
        throw new Error(`CRITICAL ERROR: "${target.relativePath}" is not a valid complete source file yet. ${sourceValidationProblem}`);
    }
}

function normalizeDiffText(text) {
    return String(text || "").replace(/\r\n/g, "\n");
}

function safeReadTextForDiff(absolutePath) {
    if (!existsSync(absolutePath)) {
        return "";
    }

    try {
        const stats = statSync(absolutePath);
        if (!stats.isFile() || stats.size > DIFF_LIMIT) {
            return null;
        }
        return normalizeDiffText(readFileSync(absolutePath, "utf-8"));
    } catch {
        return null;
    }
}

function buildUnifiedDiff(relativePath, beforeText, afterText) {
    const before = normalizeDiffText(beforeText);
    const after = normalizeDiffText(afterText);

    if (before === after) {
        return null;
    }

    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");

    let prefix = 0;
    while (
        prefix < beforeLines.length &&
        prefix < afterLines.length &&
        beforeLines[prefix] === afterLines[prefix]
    ) {
        prefix += 1;
    }

    let beforeSuffix = beforeLines.length - 1;
    let afterSuffix = afterLines.length - 1;
    while (
        beforeSuffix >= prefix &&
        afterSuffix >= prefix &&
        beforeLines[beforeSuffix] === afterLines[afterSuffix]
    ) {
        beforeSuffix -= 1;
        afterSuffix -= 1;
    }

    const contextRadius = 3;
    const start = Math.max(0, prefix - contextRadius);
    const endBefore = Math.min(beforeLines.length, beforeSuffix + 1 + contextRadius);
    const endAfter = Math.min(afterLines.length, afterSuffix + 1 + contextRadius);

    const lines = [`--- a/${relativePath}`, `+++ b/${relativePath}`];

    for (let index = start; index < prefix; index += 1) {
        lines.push(` ${beforeLines[index]}`);
    }

    for (let index = prefix; index <= beforeSuffix; index += 1) {
        lines.push(`-${beforeLines[index]}`);
    }

    for (let index = prefix; index <= afterSuffix; index += 1) {
        lines.push(`+${afterLines[index]}`);
    }

    for (let index = Math.max(prefix, beforeSuffix + 1); index < endBefore; index += 1) {
        lines.push(` ${beforeLines[index]}`);
    }

    const maxLines = 160;
    if (lines.length > maxLines) {
        lines.splice(maxLines, lines.length - maxLines, "...[diff truncated]");
    }

    return lines.join("\n");
}

function buildDiffPayload(relativePath, beforeText, afterText) {
    const diff = buildUnifiedDiff(relativePath, beforeText, afterText);
    if (!diff) {
        return null;
    }

    return {
        file: relativePath,
        changeKind: beforeText && afterText ? "modified" : beforeText ? "deleted" : "created",
        diff
    };
}

function getWorkspaceOrThrow(resolveWorkspace, chatId) {
    const workspace = resolveWorkspace(chatId);
    if (!workspace) {
        throw new Error("Workspace is not configured for this session");
    }
    return workspace;
}

function buildSinglePageSite({
    title = "New Project",
    subtitle = "",
    buttonLabel = "Get Started",
    accentColor = "#0a84ff",
    darkMode = true
}) {
    const background = darkMode ? "#0b0f14" : "#f5f7fb";
    const cardBackground = darkMode ? "rgba(255,255,255,0.06)" : "#ffffff";
    const text = darkMode ? "#f8fbff" : "#101828";
    const muted = darkMode ? "rgba(255,255,255,0.68)" : "#475467";

    return [
        "<!DOCTYPE html>",
        "<html lang=\"en\">",
        "<head>",
        "  <meta charset=\"UTF-8\">",
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">",
        `  <title>${title}</title>`,
        "  <style>",
        "    * { box-sizing: border-box; }",
        "    body {",
        "      margin: 0;",
        "      min-height: 100vh;",
        "      display: grid;",
        "      place-items: center;",
        `      background: ${background};`,
        `      color: ${text};`,
        "      font-family: Inter, Arial, sans-serif;",
        "      padding: 24px;",
        "    }",
        "    .shell {",
        "      width: min(100%, 760px);",
        `      background: ${cardBackground};`,
        "      border: 1px solid rgba(255,255,255,0.08);",
        "      border-radius: 24px;",
        "      padding: 40px;",
        "      box-shadow: 0 20px 60px rgba(0,0,0,0.24);",
        "      text-align: center;",
        "    }",
        "    h1 {",
        "      margin: 0 0 16px;",
        "      font-size: clamp(2rem, 4vw, 3.5rem);",
        "      line-height: 1.05;",
        "    }",
        "    p {",
        "      margin: 0 auto 24px;",
        "      max-width: 560px;",
        `      color: ${muted};`,
        "      font-size: 1.05rem;",
        "      line-height: 1.7;",
        "    }",
        "    button {",
        `      background: ${accentColor};`,
        "      color: #fff;",
        "      border: none;",
        "      border-radius: 999px;",
        "      padding: 14px 24px;",
        "      font-size: 1rem;",
        "      font-weight: 700;",
        "      cursor: pointer;",
        "      box-shadow: 0 10px 24px rgba(10,132,255,0.24);",
        "    }",
        "  </style>",
        "</head>",
        "<body>",
        "  <main class=\"shell\">",
        `    <h1>${title}</h1>`,
        `    <p>${subtitle || "A focused MVP landing page is ready for the next iteration."}</p>`,
        `    <button>${buttonLabel}</button>`,
        "  </main>",
        "</body>",
        "</html>"
    ].join("\n");
}

export function buildCodingTools({ resolveWorkspace, shellTimeoutMs, shellOutputLimit }) {
    return [
        {
            tool: {
                name: "code_list_files",
                description: "List files and folders inside the active coding workspace. Use before reading or editing unfamiliar areas.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative directory inside the workspace. Omit for root." },
                        depth: { type: "integer", description: "How many directory levels to descend. Default 2." }
                    }
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        ...listWorkspaceTree(
                            workspace.path,
                            params.path || "",
                            Number.isInteger(params.depth) ? params.depth : 2
                        )
                    }
                };
            }
        },
        {
            tool: {
                name: "code_write_json",
                description: "Write a JSON file inside the active workspace using a structured object value. Prefer this for package.json, tsconfig.json, and other config files.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative JSON file path inside the active workspace." },
                        value: { type: "object", description: "Structured JSON object to write." }
                    },
                    required: ["path", "value"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const before = safeReadTextForDiff(target.absolute);
                const content = stringifyJson(params.value);
                if (content.length > JSON_WRITE_LIMIT) {
                    throw new Error(`Refusing to write more than ${JSON_WRITE_LIMIT} characters of JSON at once`);
                }
                mkdirSync(dirname(target.absolute), { recursive: true });
                writeFileSync(target.absolute, content, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        writtenChars: content.length,
                        diff: before === null ? null : buildDiffPayload(target.relativePath, before, content)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_inspect_project",
                description: "Inspect the active workspace and detect project structure, stack hints, and available package scripts. Use this at the start of a task to understand the project quickly.",
                parameters: {
                    type: "object",
                    properties: {}
                },
                category: "data-bearing"
            },
            executor: async (_params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const inspection = inspectWorkspaceProject(workspace.path);
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        ...inspection
                    }
                };
            }
        },
        {
            tool: {
                name: "code_read_file",
                description: "Read a text file from the active coding workspace. Use this before editing or reviewing code.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path to a file inside the active workspace." }
                    },
                    required: ["path"]
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        ...readWorkspaceFile(workspace.path, params.path)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_suggest_commands",
                description: "Suggest likely setup, test, build, and preview commands for the active workspace based on detected project files and package scripts.",
                parameters: {
                    type: "object",
                    properties: {}
                },
                category: "data-bearing"
            },
            executor: async (_params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const inspection = inspectWorkspaceProject(workspace.path);
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        stack: inspection.stack,
                        suggestedCommands: suggestWorkspaceCommands(inspection)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_read_files",
                description: "Read multiple text files from the active coding workspace in one call. Use this to build context before edits instead of issuing many single-file reads.",
                parameters: {
                    type: "object",
                    properties: {
                        paths: {
                            type: "array",
                            description: "Relative file paths inside the active workspace.",
                            items: { type: "string" }
                        }
                    },
                    required: ["paths"]
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const paths = Array.isArray(params.paths) ? params.paths.slice(0, 20) : [];
                const files = paths.map((path) => ({
                    path,
                    ...readWorkspaceFile(workspace.path, path)
                }));
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        files
                    }
                };
            }
        },
        {
            tool: {
                name: "code_write_file",
                description: "Write one full plain-text file inside the active coding workspace. Prefer this for creating or fully replacing HTML, CSS, JavaScript, and TypeScript source files with one raw source string.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path to the file inside the active workspace." },
                        content: { type: "string", description: "Complete file content to write." }
                    },
                    required: ["path", "content"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                if (isSourceLikeFile(target.relativePath) && typeof params.content !== "string") {
                    canonicalizeRejectedSourceParams(params, target.relativePath);
                    throw new Error(
                        `CRITICAL ERROR: "${target.relativePath}" requires one raw source string as file content. Do not send arrays, objects, selector maps, or structured wrappers.`
                    );
                }
                const normalizedPayload = coerceStructuredSourcePayload(target.relativePath, params.content);
                const nextContent = normalizedPayload.content;
                if (nextContent.length > WRITE_LIMIT) {
                    throw new Error(`Refusing to write more than ${WRITE_LIMIT} characters at once`);
                }
                const before = safeReadTextForDiff(target.absolute);
                const suspiciousPayload = detectSuspiciousSerializedPayload(target.relativePath, nextContent);
                if (suspiciousPayload) {
                    canonicalizeRejectedSourceParams(params, target.relativePath);
                    throw new Error(suspiciousPayload);
                }
                await ensureValidCompleteSource(target, nextContent, context, workspace.path);
                mkdirSync(dirname(target.absolute), { recursive: true });
                writeFileSync(target.absolute, nextContent, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        writtenChars: nextContent.length,
                        normalizedWrappedPayload: normalizedPayload.normalized,
                        diff: before === null ? null : buildDiffPayload(target.relativePath, before, nextContent)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_write_file_lines",
                description: "Write full file contents as an ordered array of plain source lines. Use this only when you intentionally need a line-based rewrite or repair.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path to the file inside the active workspace." },
                        lines: {
                            type: "array",
                            description: "Ordered file lines without trailing newline characters.",
                            items: { type: "string" }
                        }
                    },
                    required: ["path", "lines"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const plainLineArray = Array.isArray(params.lines) && params.lines.every((line) => typeof line === "string");
                if (isSourceLikeFile(target.relativePath) && !plainLineArray) {
                    canonicalizeRejectedSourceParams(params, target.relativePath);
                    throw new Error(
                        `CRITICAL ERROR: "${target.relativePath}" requires an array of plain source lines. Do not send nested arrays, objects, selector maps, or serialized wrappers.`
                    );
                }
                const normalizedLines = plainLineArray ? normalizeLineArray(params.lines, target.relativePath) : null;
                const normalizedPayload = plainLineArray
                    ? coerceStructuredSourcePayload(target.relativePath, normalizedLines.join("\n"))
                    : coerceStructuredSourceValue(target.relativePath, params.lines);
                const content = normalizedPayload.content;
                if (content.length > WRITE_LIMIT) {
                    throw new Error(`Refusing to write more than ${WRITE_LIMIT} characters at once`);
                }
                const before = safeReadTextForDiff(target.absolute);
                const suspiciousPayload = detectSuspiciousSerializedPayload(target.relativePath, content);
                if (suspiciousPayload) {
                    canonicalizeRejectedSourceParams(params, target.relativePath);
                    throw new Error(`${suspiciousPayload}. Provide plain source lines instead of a serialized array.`);
                }
                await ensureValidCompleteSource(target, content, context, workspace.path);
                mkdirSync(dirname(target.absolute), { recursive: true });
                writeFileSync(target.absolute, content, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        writtenChars: content.length,
                        lineCount: plainLineArray ? normalizedLines.length : content.split(/\r?\n/).length,
                        normalizedWrappedPayload: normalizedPayload.normalized,
                        diff: before === null ? null : buildDiffPayload(target.relativePath, before, content)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_create_single_page_site",
                description: "Create a valid single-page HTML landing page quickly. Prefer this for simple MVP websites, demo pages, or token landing pages when one file is enough.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative HTML file path inside the active workspace." },
                        title: { type: "string", description: "Main page title or hero heading." },
                        subtitle: { type: "string", description: "Short supporting text below the title." },
                        buttonLabel: { type: "string", description: "Primary call-to-action button label." },
                        accentColor: { type: "string", description: "Primary accent color, for example #0a84ff." },
                        darkMode: { type: "boolean", description: "Whether to create a dark landing page." }
                    },
                    required: ["path", "title"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const before = safeReadTextForDiff(target.absolute);
                const content = buildSinglePageSite({
                    title: params.title,
                    subtitle: params.subtitle,
                    buttonLabel: params.buttonLabel,
                    accentColor: params.accentColor,
                    darkMode: params.darkMode !== false
                });
                mkdirSync(dirname(target.absolute), { recursive: true });
                writeFileSync(target.absolute, content, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        writtenChars: content.length,
                        diff: before === null ? null : buildDiffPayload(target.relativePath, before, content)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_make_dirs",
                description: "Create one or more directories inside the active coding workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        paths: {
                            type: "array",
                            description: "Relative directory paths to create.",
                            items: { type: "string" }
                        }
                    },
                    required: ["paths"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const created = [];
                for (const path of Array.isArray(params.paths) ? params.paths.slice(0, 20) : []) {
                    const target = resolveInsideWorkspace(workspace.path, path);
                    mkdirSync(target.absolute, { recursive: true });
                    created.push(target.relativePath);
                }
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        created
                    }
                };
            }
        },
        {
            tool: {
                name: "code_replace_text",
                description: "Replace exact text inside a file in the active workspace. Use for precise edits after reading the file first.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path inside the active workspace." },
                        search: { type: "string", description: "Exact text to find." },
                        replace: { type: "string", description: "Replacement text." },
                        allOccurrences: { type: "boolean", description: "Replace all matches instead of just the first one." }
                    },
                    required: ["path", "search", "replace"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const original = readFileSync(target.absolute, "utf-8");
                if (!original.includes(params.search)) {
                    throw new Error("Search text was not found in the file");
                }

                const next = params.allOccurrences
                    ? original.split(params.search).join(params.replace)
                    : original.replace(params.search, params.replace);

                await ensureValidCompleteSource(target, next, context, workspace.path);
                writeFileSync(target.absolute, next, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        replaced: params.allOccurrences ? "all" : "first",
                        diff: buildDiffPayload(target.relativePath, original, next)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_patch_file",
                description: "Apply one or more exact search-and-replace edits to the same file in order. Prefer this for small, surgical code changes instead of rewriting the entire file.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path inside the active workspace." },
                        edits: {
                            type: "array",
                            description: "Ordered exact-match edits to apply.",
                            items: {
                                type: "object",
                                properties: {
                                    search: { type: "string", description: "Exact text to find." },
                                    replace: { type: "string", description: "Replacement text." },
                                    allOccurrences: {
                                        type: "boolean",
                                        description: "Replace all matches for this edit instead of the first match."
                                    }
                                },
                                required: ["search", "replace"]
                            }
                        }
                    },
                    required: ["path", "edits"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const edits = Array.isArray(params.edits) ? params.edits.slice(0, 50) : [];
                if (edits.length === 0) {
                    throw new Error("No edits were provided");
                }

                const original = readFileSync(target.absolute, "utf-8");
                let current = original;
                let applied = 0;

                for (const edit of edits) {
                    const search = String(edit.search ?? "");
                    const replace = String(edit.replace ?? "");
                    if (!search) {
                        throw new Error("Each edit must include non-empty search text");
                    }
                    if (!current.includes(search)) {
                        throw new Error(`Search text was not found in the file for edit ${applied + 1}`);
                    }

                    current = edit.allOccurrences
                        ? current.split(search).join(replace)
                        : current.replace(search, replace);
                    applied += 1;
                }

                if (current.length > WRITE_LIMIT) {
                    throw new Error(`Refusing to write more than ${WRITE_LIMIT} characters at once`);
                }

                await ensureValidCompleteSource(target, current, context, workspace.path);
                writeFileSync(target.absolute, current, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        editsApplied: applied,
                        diff: buildDiffPayload(target.relativePath, original, current)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_insert_block",
                description: "Insert a code block before or after an exact anchor string inside a file. Prefer this when you need to add a new import, route, script tag, or config block without rewriting the whole file.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative file path inside the active workspace." },
                        anchor: { type: "string", description: "Exact anchor text to insert around." },
                        content: { type: "string", description: "Text block to insert." },
                        position: {
                            type: "string",
                            description: "Insert before or after the anchor.",
                            enum: ["before", "after"]
                        }
                    },
                    required: ["path", "anchor", "content", "position"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const original = readFileSync(target.absolute, "utf-8");
                const anchor = String(params.anchor || "");
                if (!anchor || !original.includes(anchor)) {
                    throw new Error("Anchor text was not found in the file");
                }

                const insertContent = String(params.content || "");
                const replacement =
                    params.position === "before"
                        ? `${insertContent}${anchor}`
                        : `${anchor}${insertContent}`;

                const next = original.replace(anchor, replacement);
                if (next.length > WRITE_LIMIT) {
                    throw new Error(`Refusing to write more than ${WRITE_LIMIT} characters at once`);
                }
                await ensureValidCompleteSource(target, next, context, workspace.path);
                writeFileSync(target.absolute, next, "utf-8");
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        path: target.relativePath,
                        position: params.position,
                        diff: buildDiffPayload(target.relativePath, original, next)
                    }
                };
            }
        },
        {
            tool: {
                name: "code_move_path",
                description: "Rename or move a file or directory inside the active coding workspace.",
                parameters: {
                    type: "object",
                    properties: {
                        from: { type: "string", description: "Current relative path inside the workspace." },
                        to: { type: "string", description: "New relative path inside the workspace." }
                    },
                    required: ["from", "to"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const source = resolveInsideWorkspace(workspace.path, params.from);
                const target = resolveInsideWorkspace(workspace.path, params.to);
                mkdirSync(dirname(target.absolute), { recursive: true });
                renameSync(source.absolute, target.absolute);
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        from: source.relativePath,
                        to: target.relativePath
                    }
                };
            }
        },
        {
            tool: {
                name: "code_delete_path",
                description: "Delete a file or directory inside the active coding workspace. Use carefully and only when the task explicitly requires removal.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Relative path to delete inside the workspace." }
                    },
                    required: ["path"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const target = resolveInsideWorkspace(workspace.path, params.path);
                const before = safeReadTextForDiff(target.absolute);
                rmSync(target.absolute, { recursive: true, force: true });
                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        deleted: target.relativePath,
                        diff: before === null ? null : buildDiffPayload(target.relativePath, before, "")
                    }
                };
            }
        },
        {
            tool: {
                name: "code_search_text",
                description: "Search for text across the active workspace. Use this to locate files, functions, strings, or TODOs before reading or editing.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Text or regex-like snippet to search for." },
                        limit: { type: "integer", description: "Maximum number of matches. Default 50." }
                    },
                    required: ["query"]
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const limit = Number.isInteger(params.limit) ? Math.max(1, Math.min(params.limit, 200)) : DEFAULT_SEARCH_LIMIT;
                let matches;

                try {
                    matches = await searchTextWithRg(params.query, workspace.path, limit);
                } catch {
                    matches = fallbackSearch(workspace.path, params.query, limit);
                }

                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        query: params.query,
                        matches
                    }
                };
            }
        },
        {
            tool: {
                name: "code_search_context",
                description: "Search the active workspace and return grouped code snippets around the best matches. Use this to gather implementation context before reading or editing several files.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Text or identifier to search for." },
                        limit: { type: "integer", description: "Maximum number of raw matches to inspect. Default 20." }
                    },
                    required: ["query"]
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const limit = Number.isInteger(params.limit) ? Math.max(1, Math.min(params.limit, 50)) : 20;
                let matches;

                try {
                    matches = await searchTextWithRg(params.query, workspace.path, limit);
                } catch {
                    matches = fallbackSearch(workspace.path, params.query, limit);
                }

                const snippets = buildSearchContextSnippets(workspace.path, matches, params.query);

                return {
                    success: true,
                    data: {
                        workspace: workspace.name,
                        query: params.query,
                        totalMatches: matches.length,
                        snippets
                    }
                };
            }
        },
        {
            tool: {
                name: "code_web_search",
                description: "Search the web for documentation, package usage, API references, and implementation guidance. Adapted from Teleton's built-in web search capability.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search query." },
                        count: { type: "integer", description: "Maximum number of results. Default 5." },
                        topic: {
                            type: "string",
                            description: "Search topic.",
                            enum: ["general", "news", "finance"]
                        }
                    },
                    required: ["query"]
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const apiKey = context.config?.tavily_api_key;
                if (!apiKey) {
                    throw new Error("Tavily API key not configured in Teleton config");
                }

                const count = Number.isInteger(params.count) ? Math.max(1, Math.min(params.count, 10)) : 5;
                const topic = ["general", "news", "finance"].includes(params.topic) ? params.topic : "general";
                const data = await tavilyWebSearch(apiKey, params.query, count, topic);

                return {
                    success: true,
                    data: {
                        query: params.query,
                        answer: data.answer || "",
                        results: Array.isArray(data.results)
                            ? data.results.map((item) => ({
                                  title: item.title,
                                  url: item.url,
                                  content: item.content,
                                  score: item.score
                              }))
                            : []
                    }
                };
            }
        },
        {
            tool: {
                name: "code_run_command",
                description: "Run a command inside the active coding workspace. Use this for installs, builds, tests, linters, or repo inspection. Never use it for destructive host-level operations.",
                parameters: {
                    type: "object",
                    properties: {
                        command: { type: "string", description: "PowerShell command to execute inside the active workspace." },
                        cwd: { type: "string", description: "Optional subdirectory inside the active workspace." }
                    },
                    required: ["command"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                if (isDangerousCommand(params.command)) {
                    throw new Error("Command blocked by Teleton Code safety policy");
                }

                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const cwd = resolveInsideWorkspace(workspace.path, params.cwd || "");
                const result = await runPowerShell(
                    params.command,
                    cwd.absolute,
                    shellTimeoutMs,
                    shellOutputLimit
                );

                return {
                    success: result.exitCode === 0,
                    data: {
                        workspace: workspace.name,
                        cwd: cwd.relativePath,
                        command: params.command,
                        exitCode: result.exitCode,
                        stdout: result.stdout,
                        stderr: result.stderr
                    },
                    error: result.exitCode === 0 ? undefined : `Command failed with exit code ${result.exitCode}`
                };
            }
        },
        {
            tool: {
                name: "code_install_dependencies",
                description: "Install npm packages inside the active workspace. Use this instead of a raw shell install when adding dependencies to a project.",
                parameters: {
                    type: "object",
                    properties: {
                        packages: { type: "string", description: "Space-separated npm package specifiers." },
                        dev: { type: "boolean", description: "Install as devDependencies." }
                    },
                    required: ["packages"]
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const packages = sanitizePackageList(params.packages);
                const flag = params.dev ? "-D " : "";
                const command = `npm install ${flag}${packages.join(" ")}`;
                const result = await runPowerShell(
                    command,
                    workspace.path,
                    shellTimeoutMs,
                    shellOutputLimit
                );

                return {
                    success: result.exitCode === 0,
                    data: {
                        workspace: workspace.name,
                        command,
                        packages,
                        exitCode: result.exitCode,
                        stdout: result.stdout,
                        stderr: result.stderr
                    },
                    error: result.exitCode === 0 ? undefined : `Dependency install failed with exit code ${result.exitCode}`
                };
            }
        },
        {
            tool: {
                name: "code_run_check_suite",
                description: "Run the most relevant project verification commands available in the active workspace, such as check, lint, test, or build.",
                parameters: {
                    type: "object",
                    properties: {
                        maxCommands: { type: "integer", description: "Maximum number of commands to run. Default 3." }
                    }
                },
                category: "action"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const inspection = inspectWorkspaceProject(workspace.path);
                const commands = chooseProjectCheckCommands(inspection).slice(
                    0,
                    Number.isInteger(params.maxCommands) ? Math.max(1, Math.min(params.maxCommands, 5)) : 3
                );

                if (commands.length === 0) {
                    return {
                        success: true,
                        data: {
                            workspace: workspace.name,
                            skipped: true,
                            reason: "No project check commands were detected for this workspace",
                            results: []
                        }
                    };
                }

                const results = [];
                let overallSuccess = true;

                for (const item of commands) {
                    const result = await runPowerShell(
                        item.command,
                        workspace.path,
                        shellTimeoutMs,
                        shellOutputLimit
                    );
                    results.push({
                        kind: item.kind,
                        command: item.command,
                        exitCode: result.exitCode,
                        stdout: result.stdout,
                        stderr: result.stderr
                    });
                    if (result.exitCode !== 0) {
                        overallSuccess = false;
                        break;
                    }
                }

                return {
                    success: overallSuccess,
                    data: {
                        workspace: workspace.name,
                        results
                    },
                    error: overallSuccess ? undefined : "One of the project checks failed"
                };
            }
        },
        {
            tool: {
                name: "code_git_status",
                description: "Get git status for the active workspace. Use this before and after edits to understand repository state.",
                parameters: {
                    type: "object",
                    properties: {}
                },
                category: "data-bearing"
            },
            executor: async (_params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const result = await runPowerShell(
                    "git status --short --branch",
                    workspace.path,
                    30000,
                    shellOutputLimit
                );
                return {
                    success: result.exitCode === 0,
                    data: {
                        workspace: workspace.name,
                        stdout: result.stdout,
                        stderr: result.stderr
                    },
                    error: result.exitCode === 0 ? undefined : "git status failed"
                };
            }
        },
        {
            tool: {
                name: "code_git_diff",
                description: "Get git diff for the active workspace. Use after edits to inspect the exact patch.",
                parameters: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Optional relative file path to limit the diff." }
                    }
                },
                category: "data-bearing"
            },
            executor: async (params, context) => {
                const workspace = getWorkspaceOrThrow(resolveWorkspace, context.chatId);
                const fileArg = params.path ? ` -- "${params.path.replace(/"/g, '\\"')}"` : "";
                const command = params.path ? `git diff${fileArg}` : "git diff --stat";
                const result = await runPowerShell(
                    command,
                    workspace.path,
                    30000,
                    DIFF_LIMIT
                );

                return {
                    success: result.exitCode === 0,
                    data: {
                        workspace: workspace.name,
                        stdout: result.stdout,
                        stderr: result.stderr
                    },
                    error: result.exitCode === 0 ? undefined : "git diff failed"
                };
            }
        }
    ];
}
