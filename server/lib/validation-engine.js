import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { collectWrittenPaths } from "./format-utils.js";
import { collectWorkspaceFiles, hasJsonStorageArtifact } from "./artifact-capabilities.js";

export function validateHtmlContent(content) {
    const source = String(content || "").trim();
    if (!source) return "HTML file is empty";
    if (/^\s*\[\s*\{/.test(source)) return "HTML file looks like serialized object data";
    if (!/<html[\s>]/i.test(source) && !/<!doctype html>/i.test(source)) return "Missing real document structure";
    if (!/<body[\s>]/i.test(source)) return "Missing a <body> element";
    return null;
}

export function validateCssContent(content) {
    const source = String(content || "");
    if (!source.trim()) return "CSS file is empty";
    if (/^\s*\[\s*[{'"`]/.test(source) || /^\s*\{\s*['"`][\w-]+['"`]\s*:/.test(source)) {
        return "CSS file looks like serialized object data";
    }
    const open = (source.match(/\{/g) || []).length;
    const close = (source.match(/\}/g) || []).length;
    if (open === 0 || open !== close) return "Invalid block structure";
    if (!/(?:^|\n)\s*(?:@(?:media|supports|keyframes)|:root|body|html|main|canvas|button|[.#][\w-]+|[\w-]+\s*\{)/i.test(source)) {
        return "CSS file is missing real selector blocks";
    }
    if (!/:\s*[^;]+;/i.test(source)) {
        return "CSS file is missing real declarations";
    }
    return null;
}

export function validateJsonContent(content) {
    const source = String(content || "").trim();
    if (!source) return "JSON file is empty";

    try {
        JSON.parse(source);
        return null;
    } catch (error) {
        return `Invalid JSON content (${error.message})`;
    }
}

export function validateLikelySourcePayload(relativePath, content) {
    const source = String(content || "").trim();
    if (!source) {
        return null;
    }

    if (/\.(m?js|cjs|ts|tsx|jsx|py)$/.test(relativePath)) {
        const codeSignals = /(export|module\.exports|const |let |var |function |class |import |from |def |if __name__|print\(|return |for |while )/;
        const topLevelCodeSignals =
            /\.py$/i.test(relativePath)
                ? /^\s*(?:from|import|def|class|async\s+def|if __name__\s*==|@[\w.]+|[A-Za-z_][\w]*\s*=)/m
                : /^\s*(?:const|let|var|function|class|import|export|document|window|localStorage|module\.exports)/m;
        const quotedKeyPairs = (source.match(/['"`][^'"`\n]{1,80}['"`]\s*:/g) || []).length;
        if (/^\[\s*["'`]/.test(source) && !codeSignals.test(source)) {
            return "Source file looks like a serialized array instead of code";
        }
        if (/^\{\s*['"]\w+['"]\s*:/.test(source) && !codeSignals.test(source)) {
            return "Source file looks like serialized object data instead of code";
        }
        if ((/^\[\s*\[/.test(source) || /^\[\s*\{/.test(source)) && !codeSignals.test(source)) {
            return "Source file looks like nested serialized data instead of code";
        }
        if (/^\s*[\[{]/.test(source) && quotedKeyPairs >= 2 && !topLevelCodeSignals.test(source)) {
            return "Source file looks like serialized structured data instead of real code";
        }
    }

    return null;
}

function runCommand(args, cwd, timeoutMs, outputLimit) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(args[0], args.slice(1), {
            cwd,
            windowsHide: true
        });

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

        const append = (value, chunk) => {
            const next = value + chunk.toString("utf-8");
            if (next.length <= outputLimit) {
                return next;
            }
            return `${next.slice(0, outputLimit)}\n...[truncated ${next.length - outputLimit} chars]`;
        };

        child.stdout.on("data", (chunk) => {
            stdout = append(stdout, chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderr = append(stderr, chunk);
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

async function runFirstAvailableCommand(candidates, cwd, timeoutMs, outputLimit) {
    let lastError = null;

    for (const candidate of candidates) {
        try {
            return await runCommand(candidate, cwd, timeoutMs, outputLimit);
        } catch (error) {
            if (error?.code === "ENOENT") {
                lastError = error;
                continue;
            }
            throw error;
        }
    }

    throw lastError || new Error("No compatible runtime was found to validate the source file.");
}

export async function validateSourceCandidate(relativePath, content, serviceConfig, cwd = process.cwd()) {
    const normalizedPath = String(relativePath || "").toLowerCase();
    const source = String(content || "");

    if (/\.(html?|htm)$/i.test(normalizedPath)) {
        return validateHtmlContent(source);
    }

    if (/\.css$/i.test(normalizedPath)) {
        return validateCssContent(source);
    }

    if (/\.json$/i.test(normalizedPath)) {
        return validateJsonContent(source);
    }

    if (/\.(m?js|cjs|jsx|ts|tsx)$/i.test(normalizedPath)) {
        const payloadProblem = validateLikelySourcePayload(relativePath, source);
        if (payloadProblem) {
            return payloadProblem;
        }

        if (!/\.(m?js|cjs|jsx)$/i.test(normalizedPath)) {
            return null;
        }

        const tempPath = join(
            tmpdir(),
            `teleton-code-syntax-${Date.now()}-${Math.random().toString(36).slice(2)}${extname(normalizedPath) || ".js"}`
        );

        try {
            writeFileSync(tempPath, source, "utf-8");
            const check = await runCommand(
                [process.execPath, "--check", tempPath],
                cwd,
                serviceConfig.runtime.maxShellTimeoutMs,
                12000
            );

            if (check.exitCode !== 0) {
                return `JS syntax check failed (${check.stderr || "unknown error"})`;
            }
        } finally {
            try {
                rmSync(tempPath, { force: true });
            } catch {
                // Ignore temp cleanup failures.
            }
        }
    }

    if (/\.py$/i.test(normalizedPath)) {
        const payloadProblem = validateLikelySourcePayload(relativePath, source);
        if (payloadProblem) {
            return payloadProblem;
        }

        const tempPath = join(
            tmpdir(),
            `teleton-code-syntax-${Date.now()}-${Math.random().toString(36).slice(2)}${extname(normalizedPath) || ".py"}`
        );

        try {
            writeFileSync(tempPath, source, "utf-8");
            const check = await runFirstAvailableCommand(
                [
                    ["python", "-m", "py_compile", tempPath],
                    ["python3", "-m", "py_compile", tempPath],
                    ["py", "-3", "-m", "py_compile", tempPath]
                ],
                cwd,
                serviceConfig.runtime.maxShellTimeoutMs,
                12000
            );

            if (check.exitCode !== 0) {
                return `Python syntax check failed (${check.stderr || check.stdout || "unknown error"})`;
            }
        } finally {
            try {
                rmSync(tempPath, { force: true });
            } catch {
                // Ignore temp cleanup failures.
            }
        }
    }

    return null;
}

function resolveAssetPath(entryPath, assetPath) {
    if (
        !assetPath ||
        /^(https?:)?\/\//i.test(assetPath) ||
        assetPath.startsWith("data:") ||
        assetPath.startsWith("#")
    ) {
        return null;
    }

    if (assetPath.startsWith("/")) {
        return assetPath.replace(/^\/+/, "");
    }

    const parts = String(entryPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();

    for (const part of assetPath.split("/")) {
        if (!part || part === ".") {
            continue;
        }
        if (part === "..") {
            parts.pop();
            continue;
        }
        parts.push(part);
    }

    return parts.join("/");
}

function collectHtmlAssetReferences(relativePath, content) {
    const assets = new Set();
    const source = String(content || "");
    const regex = /<(?:link|script|img|source)\b[^>]*(?:href|src)=["']([^"'#?]+(?:\?[^"']*)?)["'][^>]*>/gi;

    for (const match of source.matchAll(regex)) {
        const rawAsset = String(match[1] || "").split("#")[0].trim();
        if (!rawAsset) {
            continue;
        }

        const resolved = resolveAssetPath(relativePath, rawAsset);
        if (resolved) {
            assets.add(resolved);
        }
    }

    return [...assets];
}

function collectHtmlIds(content) {
    return new Set(
        [...String(content || "").matchAll(/\bid=["']([^"'#\s]+)["']/gi)]
            .map((match) => String(match[1] || "").trim())
            .filter(Boolean)
    );
}

function collectHtmlDataAttributes(content) {
    return new Set(
        [...String(content || "").matchAll(/\bdata-([a-z0-9_-]+)=["'][^"']*["']/gi)]
            .map((match) => String(match[1] || "").trim())
            .filter(Boolean)
    );
}

function collectHtmlClasses(content) {
    const classes = new Set();

    for (const match of String(content || "").matchAll(/\bclass=["']([^"']+)["']/gi)) {
        for (const className of String(match[1] || "")
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean)) {
            classes.add(className);
        }
    }

    return classes;
}

function camelToKebab(value) {
    return String(value || "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase();
}

function collectJsDomBindings(content) {
    const source = String(content || "");
    const ids = new Set(
        [...source.matchAll(/getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g)]
            .map((match) => String(match[1] || "").trim())
            .filter(Boolean)
    );
    const dataAttrs = new Set();
    const classes = new Set();
    const datasetAttrs = new Set(
        [...source.matchAll(/\bdataset\.([a-zA-Z0-9_]+)\b(?!\s*=)/g)]
            .map((match) => camelToKebab(match[1]))
            .filter(Boolean)
    );

    for (const match of source.matchAll(/querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
        const selector = String(match[1] || "").trim();
        if (!selector) {
            continue;
        }

        for (const idMatch of selector.matchAll(/#([a-z0-9_-]+)/gi)) {
            ids.add(String(idMatch[1] || "").trim());
        }

        for (const classMatch of selector.matchAll(/\.([a-z0-9_-]+)/gi)) {
            classes.add(String(classMatch[1] || "").trim());
        }

        for (const dataMatch of selector.matchAll(/\[data-([a-z0-9_-]+)(?:=[^\]]+)?\]/gi)) {
            dataAttrs.add(String(dataMatch[1] || "").trim());
        }
    }

    return { ids, dataAttrs, classes, datasetAttrs };
}

function collectJsGeneratedMarkupSignals(content) {
    const source = String(content || "");
    const ids = new Set();
    const classes = new Set();
    const dataAttrs = new Set();

    for (const match of source.matchAll(/\bid=["'`]([^"'`#\s]+)["'`]/gi)) {
        const id = String(match[1] || "").trim();
        if (id) {
            ids.add(id);
        }
    }

    for (const match of source.matchAll(/\bclass=["'`]([^"'`]+)["'`]/gi)) {
        for (const className of String(match[1] || "")
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean)) {
            classes.add(className);
        }
    }

    for (const match of source.matchAll(/\bclassName\s*=\s*["'`]([^"'`]+)["'`]/gi)) {
        for (const className of String(match[1] || "")
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean)) {
            classes.add(className);
        }
    }

    for (const match of source.matchAll(/\bdata-([a-z0-9_-]+)\s*=/gi)) {
        const attr = String(match[1] || "").trim();
        if (attr) {
            dataAttrs.add(attr);
        }
    }

    return { ids, classes, dataAttrs };
}

export async function validateWrittenFiles(workspace, toolCalls, serviceConfig) {
    const writtenPaths = collectWrittenPaths(toolCalls);
    const problems = [];
    const htmlFiles = [];
    const scriptFiles = [];

    for (const relativePath of writtenPaths) {
        const absolutePath = join(workspace.path, relativePath);
        let content = "";
        try {
            content = readFileSync(absolutePath, "utf-8");
        } catch (error) {
            problems.push(`${relativePath}: failed to read after write (${error.message})`);
            continue;
        }

        if (relativePath.endsWith(".html")) {
            htmlFiles.push({ path: relativePath, content });
            const problem = await validateSourceCandidate(relativePath, content, serviceConfig, workspace.path);
            if (problem) problems.push(`${relativePath}: ${problem}`);

            for (const assetPath of collectHtmlAssetReferences(relativePath, content)) {
                if (!existsSync(join(workspace.path, assetPath))) {
                    problems.push(`${relativePath}: referenced asset missing (${assetPath})`);
                }
            }
        } else if (relativePath.endsWith(".css")) {
            const problem = await validateSourceCandidate(relativePath, content, serviceConfig, workspace.path);
            if (problem) problems.push(`${relativePath}: ${problem}`);
        } else if (relativePath.endsWith(".json")) {
            const problem = await validateSourceCandidate(relativePath, content, serviceConfig, workspace.path);
            if (problem) problems.push(`${relativePath}: ${problem}`);
        } else if (/\.(m?js|cjs|py)$/.test(relativePath)) {
            scriptFiles.push({ path: relativePath, content });
            const problem = await validateSourceCandidate(relativePath, content, serviceConfig, workspace.path);
            if (problem) problems.push(`${relativePath}: ${problem}`);
        }
    }

    if (htmlFiles.length > 0 && scriptFiles.length > 0) {
        const htmlIds = new Set();
        const htmlDataAttributes = new Set();
        const htmlClasses = new Set();
        const jsGeneratedIds = new Set();
        const jsGeneratedDataAttrs = new Set();
        const jsGeneratedClasses = new Set();

        for (const htmlFile of htmlFiles) {
            for (const id of collectHtmlIds(htmlFile.content)) {
                htmlIds.add(id);
            }
            for (const attr of collectHtmlDataAttributes(htmlFile.content)) {
                htmlDataAttributes.add(attr);
            }
            for (const className of collectHtmlClasses(htmlFile.content)) {
                htmlClasses.add(className);
            }
        }

        for (const scriptFile of scriptFiles) {
            const generatedMarkup = collectJsGeneratedMarkupSignals(scriptFile.content);
            for (const id of generatedMarkup.ids) {
                jsGeneratedIds.add(id);
            }
            for (const attr of generatedMarkup.dataAttrs) {
                jsGeneratedDataAttrs.add(attr);
            }
            for (const className of generatedMarkup.classes) {
                jsGeneratedClasses.add(className);
            }
        }

        const availableIds = new Set([...htmlIds, ...jsGeneratedIds]);
        const availableDataAttributes = new Set([...htmlDataAttributes, ...jsGeneratedDataAttrs]);
        const availableClasses = new Set([...htmlClasses, ...jsGeneratedClasses]);

        for (const scriptFile of scriptFiles) {
            const bindings = collectJsDomBindings(scriptFile.content);
            const missingIds = [...bindings.ids].filter((id) => !availableIds.has(id));
            const missingDataAttrs = [...bindings.dataAttrs].filter((attr) => !availableDataAttributes.has(attr));
            const missingClasses = [...bindings.classes].filter((className) => !availableClasses.has(className));
            const missingDatasetAttrs = [...bindings.datasetAttrs].filter((attr) => !availableDataAttributes.has(attr));

            if (missingIds.length > 0) {
                problems.push(`${scriptFile.path}: missing DOM id bindings (${missingIds.join(", ")})`);
            }
            if (missingDataAttrs.length > 0) {
                problems.push(`${scriptFile.path}: missing data-* bindings (${missingDataAttrs.join(", ")})`);
            }
            if (missingClasses.length > 0) {
                problems.push(`${scriptFile.path}: missing DOM class bindings (${missingClasses.join(", ")})`);
            }
            if (missingDatasetAttrs.length > 0) {
                problems.push(`${scriptFile.path}: missing dataset bindings (${missingDatasetAttrs.join(", ")})`);
            }
        }
    }

    return { writtenPaths, problems };
}

export function detectDarkThemeInContent(content) {
    const source = String(content || "").toLowerCase();
    return (
        /background(?:-color)?\s*:\s*(#0|#1|black|rgb\(0|rgb\(1|rgba\(0)/i.test(source) ||
        /class\s*=\s*["'][^"']*(dark|theme-dark)[^"']*["']/i.test(source)
    );
}

export function promptRequestsLocalStorage(prompt) {
    return /\blocalstorage\b/i.test(String(prompt || ""));
}

export function promptRequestsJsonStorage(prompt) {
    const source = String(prompt || "");
    return (
        /\bjson\b/i.test(source) &&
        /\b(file|storage|store|persist|save|local)\b/i.test(source)
    ) ||
        /(?:json[- ]?\u0444\u0430\u0439\u043b|\u0444\u0430\u0439\u043b \u0432 json|json \u0444\u0430\u0439\u043b|\u0445\u0440\u0430\u043d[^\s]* \u0432 json|\u0441\u043e\u0445\u0440\u0430\u043d[^\s]* \u0432 json|\u043b\u043e\u043a\u0430\u043b\u044c\u043d[^\s]* json)/i.test(
            source
        );
}

export function promptRequestsDarkTheme(prompt) {
    const source = String(prompt || "");
    return /\bdark\b/i.test(source) || /(?:\u0442\u0435\u043c\u043d|\u0442\u0451\u043c\u043d)/i.test(source);
}

function collectRequestedFeatureExpectations(promptText) {
    const source = String(promptText || "");
    const expectations = [];
    const push = (problem, pattern) => expectations.push({ problem, pattern });

    if (/\brestart\b|\breset\b|(?:\u043f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u043a)|(?:\u0440\u0435\u0441\u0442\u0430\u0440\u0442)/i.test(source)) {
        push(
            "Prompt requests restart controls, but no restart/reset signal was found",
            /\brestart\b|\breset\b|(?:\u043f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u043a)|(?:\u0440\u0435\u0441\u0442\u0430\u0440\u0442)/i
        );
    }

    if (/\bpause\b|(?:\u043f\u0430\u0443\u0437)/i.test(source)) {
        push("Prompt requests pause controls, but no pause signal was found", /\bpause\b|(?:\u043f\u0430\u0443\u0437)/i);
    }

    if (/\bscore\b|\bpoints?\b|(?:\u0441\u0447[\u0435\u0451]\u0442)|(?:\u043e\u0447\u043a)/i.test(source)) {
        push(
            "Prompt requests score handling, but no score signal was found",
            /\bscore\b|\bpoints?\b|(?:\u0441\u0447[\u0435\u0451]\u0442)|(?:\u043e\u0447\u043a)/i
        );
    }

    if (/\bnext piece\b|\bnext block\b|(?:\u0441\u043b\u0435\u0434\u0443\u044e\u0449)/i.test(source)) {
        push(
            "Prompt requests a next-piece indicator, but no next-piece signal was found",
            /\bnext\b|(?:\u0441\u043b\u0435\u0434\u0443\u044e\u0449)/i
        );
    }

    if (/\bkeyboard\b|\bkeys?\b|\barrow\b|(?:\u043a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440)|(?:\u0441\u0442\u0440\u0435\u043b\u043a)/i.test(source)) {
        push(
            "Prompt requests keyboard controls, but no keyboard input signal was found",
            /addEventListener\s*\(\s*['"`]key|keydown|keyup|ArrowUp|ArrowDown|ArrowLeft|ArrowRight/i
        );
    }

    if (/\bfood\b|\bapple\b|(?:\u0435\u0434\u0430)|(?:\u044f\u0431\u043b\u043e\u043a)/i.test(source)) {
        push("Prompt requests food spawning, but no food signal was found", /\bfood\b|\bapple\b|placeFood|spawn/i);
    }

    return expectations;
}

export async function validatePromptAlignment(prompt, workspace, toolCalls, extractFileNames) {
    const writtenPaths = collectWrittenPaths(toolCalls);
    const relevantWorkspaceFiles =
        workspace?.path
            ? collectWorkspaceFiles(workspace.path, 3)
                  .filter((path) => /\.(?:html?|css|m?js|cjs|jsx|ts|tsx|py|md|txt|json)$/i.test(path))
                  .slice(0, 24)
            : [];
    const candidatePaths = [...new Set([...writtenPaths, ...relevantWorkspaceFiles])];
    if (candidatePaths.length === 0) return [];

    const problems = [];
    const contents = [];
    for (const relPath of candidatePaths) {
        try { contents.push(readFileSync(join(workspace.path, relPath), "utf-8")); } catch {}
    }

    const mergedContent = contents.join("\n").toLowerCase();
    const promptText = String(prompt || "");

    const requestedHexes = [...new Set(promptText.match(/#[0-9a-fA-F]{3,8}/g) || [])];
    for (const hex of requestedHexes) {
        if (!mergedContent.includes(hex.toLowerCase())) problems.push(`Color ${hex} missing from files`);
    }

    if (extractFileNames) {
        const requestedFiles = extractFileNames(promptText);
        for (const reqFile of requestedFiles) {
            const normalizedRequest = String(reqFile || "").replace(/\\/g, "/").toLowerCase();
            const matchedWrittenPath = writtenPaths.some((writtenPath) => {
                const normalizedWritten = String(writtenPath || "").replace(/\\/g, "/").toLowerCase();
                return (
                    normalizedWritten === normalizedRequest ||
                    normalizedWritten.endsWith(`/${normalizedRequest}`) ||
                    normalizedWritten.split("/").at(-1) === normalizedRequest
                );
            });

            if (!matchedWrittenPath && !existsSync(join(workspace.path, reqFile))) {
                problems.push(`Requested file missing: ${reqFile}`);
            }
        }
    }

    if (/\breadme\b/i.test(promptText) && !existsSync(join(workspace.path, "README.md"))) {
        problems.push("Requested file missing: README.md");
    }

    if (promptRequestsLocalStorage(promptText) && !/localstorage/i.test(mergedContent)) {
        problems.push("Prompt requires localStorage, but no reference found");
    }

    if (promptRequestsJsonStorage(promptText)) {
        if (!hasJsonStorageArtifact(workspace.path, 3)) {
            problems.push("Prompt requires local JSON storage, but no JSON storage implementation was found");
        }
    }

    if (promptRequestsDarkTheme(promptText) && !detectDarkThemeInContent(mergedContent)) {
        problems.push("Prompt requires dark theme, but no signal detected");
    }

    for (const expectation of collectRequestedFeatureExpectations(promptText)) {
        if (!expectation.pattern.test(mergedContent)) {
            problems.push(expectation.problem);
        }
    }

    return problems;
}

export function applyDeterministicPromptFixes(prompt, workspace, toolCalls) {
    const writtenPaths = collectWrittenPaths(toolCalls);
    const promptText = String(prompt || "");
    if (!(/(button|start-button|cta)/i.test(promptText) && /blue/i.test(promptText))) return false;

    for (const relPath of writtenPaths) {
        const absPath = join(workspace.path, relPath);
        const original = readFileSync(absPath, "utf-8");
        const updated = original
            .replace(/(button\s*\{[\s\S]*?background(?:-color)?\s*:\s*)([^;]+)(;)/i, `$1#0a84ff$3`)
            .replace(/(\.start-button\s*\{[\s\S]*?background(?:-color)?\s*:\s*)([^;]+)(;)/i, `$1#0a84ff$3`);

        if (updated !== original) {
            writeFileSync(absPath, updated, "utf-8");
            return true;
        }
    }
    return false;
}
