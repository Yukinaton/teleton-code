import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPowerShell } from "./workspace-utils.js";
import { collectWrittenPaths } from "./format-utils.js";

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
    const open = (source.match(/\{/g) || []).length;
    const close = (source.match(/\}/g) || []).length;
    if (open === 0 || open !== close) return "Invalid block structure";
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

    if (/\.(m?js|cjs|ts|tsx|jsx)$/.test(relativePath)) {
        if (/^\[\s*["'`]/.test(source) && !/(export|module\.exports|const |let |var |function |class )/.test(source)) {
            return "JS/TS file looks like a serialized array instead of source code";
        }
        if (/^\{\s*['"]\w+['"]\s*:/.test(source) && !/(export default|module\.exports|const |let |var )/.test(source)) {
            return "JS/TS file looks like serialized object data instead of source code";
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
            const problem = validateHtmlContent(content);
            if (problem) problems.push(`${relativePath}: ${problem}`);

            for (const assetPath of collectHtmlAssetReferences(relativePath, content)) {
                if (!existsSync(join(workspace.path, assetPath))) {
                    problems.push(`${relativePath}: referenced asset missing (${assetPath})`);
                }
            }
        } else if (relativePath.endsWith(".css")) {
            const problem = validateCssContent(content);
            if (problem) problems.push(`${relativePath}: ${problem}`);
        } else if (relativePath.endsWith(".json")) {
            const problem = validateJsonContent(content);
            if (problem) problems.push(`${relativePath}: ${problem}`);
        } else if (/\.(m?js|cjs)$/.test(relativePath)) {
            scriptFiles.push({ path: relativePath, content });
            const payloadProblem = validateLikelySourcePayload(relativePath, content);
            if (payloadProblem) {
                problems.push(`${relativePath}: ${payloadProblem}`);
                continue;
            }
            const check = await runPowerShell(
                `node --check "${absolutePath.replace(/"/g, '\\"')}"`,
                workspace.path,
                serviceConfig.runtime.maxShellTimeoutMs,
                12000
            );
            if (check.exitCode !== 0) {
                problems.push(`${relativePath}: JS syntax check failed (${check.stderr || "unknown error"})`);
            }
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

export function promptRequestsDarkTheme(prompt) {
    const source = String(prompt || "");
    return /\bdark\b/i.test(source) || /(темн|тёмн)/i.test(source);
}

export async function validatePromptAlignment(prompt, workspace, toolCalls, extractFileNames) {
    const writtenPaths = collectWrittenPaths(toolCalls);
    if (writtenPaths.length === 0) return [];

    const problems = [];
    const contents = [];
    for (const relPath of writtenPaths) {
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

    if (promptRequestsDarkTheme(promptText) && !detectDarkThemeInContent(mergedContent)) {
        problems.push("Prompt requires dark theme, but no signal detected");
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
