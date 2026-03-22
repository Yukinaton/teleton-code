import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function shouldSkipWorkspaceEntry(name) {
    return String(name || "").startsWith(".teleton-workspace");
}

export function collectWorkspaceFiles(rootPath, depth = 3, prefix = "") {
    if (!rootPath || !existsSync(rootPath) || depth < 0) {
        return [];
    }

    try {
        const files = [];
        const entries = readdirSync(rootPath, { withFileTypes: true });
        for (const entry of entries) {
            if (shouldSkipWorkspaceEntry(entry.name)) {
                continue;
            }
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                files.push(...collectWorkspaceFiles(join(rootPath, entry.name), depth - 1, relativePath));
                continue;
            }
            files.push(relativePath.replace(/\\/g, "/"));
        }
        return files;
    } catch {
        return [];
    }
}

export function readWorkspaceFileSafe(rootPath, relativePath) {
    if (!rootPath || !relativePath) {
        return "";
    }

    try {
        return readFileSync(join(rootPath, String(relativePath).replace(/\\/g, "/")), "utf-8");
    } catch {
        return "";
    }
}

function browserEntryScore(filePath) {
    const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
    const baseName = normalized.split("/").pop() || "";
    if (baseName === "index.html" || baseName === "index.htm") {
        return 0;
    }
    if (/(?:^|\/)(?:app|game|main)\.html?$/.test(normalized)) {
        return 1;
    }
    return 2;
}

function sortBrowserEntries(files = []) {
    return [...files].sort((left, right) => {
        const scoreDelta = browserEntryScore(left) - browserEntryScore(right);
        if (scoreDelta !== 0) {
            return scoreDelta;
        }
        return String(left).localeCompare(String(right));
    });
}

function resolveBrowserAssetPath(entryPath, assetPath) {
    const normalizedAsset = String(assetPath || "").trim();
    if (
        !normalizedAsset ||
        /^(https?:)?\/\//i.test(normalizedAsset) ||
        normalizedAsset.startsWith("data:") ||
        normalizedAsset.startsWith("#")
    ) {
        return null;
    }

    if (normalizedAsset.startsWith("/")) {
        return normalizedAsset.replace(/^\/+/, "");
    }

    const parts = String(entryPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    parts.pop();

    for (const part of normalizedAsset.split("/")) {
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

function collectHtmlAssetReferences(entryPath, source) {
    const stylesheets = new Set();
    const scripts = new Set();
    const html = String(source || "");

    for (const match of html.matchAll(/<link\b[^>]*href=["']([^"'#?]+(?:\?[^"']*)?)["'][^>]*>/gi)) {
        const resolved = resolveBrowserAssetPath(entryPath, String(match[1] || "").split("#")[0].trim());
        if (resolved && /\.css$/i.test(resolved)) {
            stylesheets.add(resolved);
        }
    }

    for (const match of html.matchAll(/<script\b[^>]*src=["']([^"'#?]+(?:\?[^"']*)?)["'][^>]*>/gi)) {
        const resolved = resolveBrowserAssetPath(entryPath, String(match[1] || "").split("#")[0].trim());
        if (resolved && /\.(?:m?js|cjs|jsx|ts|tsx)$/i.test(resolved)) {
            scripts.add(resolved);
        }
    }

    return {
        stylesheets: [...stylesheets],
        scripts: [...scripts]
    };
}

export function collectBrowserArtifactSet(rootPath, depth = 3) {
    const files = collectWorkspaceFiles(rootPath, depth);
    const htmlEntries = sortBrowserEntries(files.filter((file) => /\.(?:html?|htm)$/i.test(file)));
    if (htmlEntries.length === 0) {
        return {
            entry: null,
            htmlSource: "",
            stylesheets: [],
            scripts: []
        };
    }

    const entry = htmlEntries[0];
    const htmlSource = readWorkspaceFileSafe(rootPath, entry);
    const fileSet = new Set(files.map((file) => String(file).replace(/\\/g, "/")));
    const references = collectHtmlAssetReferences(entry, htmlSource);

    let stylesheetPaths = references.stylesheets.filter((file) => fileSet.has(file));
    let scriptPaths = references.scripts.filter((file) => fileSet.has(file));

    if (stylesheetPaths.length === 0) {
        stylesheetPaths = files.filter((file) => /\.css$/i.test(file)).slice(0, 3);
    }

    if (scriptPaths.length === 0) {
        scriptPaths = files.filter((file) => /\.(?:m?js|cjs|jsx|ts|tsx)$/i.test(file)).slice(0, 3);
    }

    return {
        entry,
        htmlSource,
        stylesheets: stylesheetPaths.map((file) => ({
            path: file,
            content: readWorkspaceFileSafe(rootPath, file)
        })),
        scripts: scriptPaths.map((file) => ({
            path: file,
            content: readWorkspaceFileSafe(rootPath, file)
        }))
    };
}

export function hasRunnableSourceFile(rootPath, depth = 3) {
    return collectWorkspaceFiles(rootPath, depth).some((file) => /\.(?:py|js|mjs|cjs|ts|tsx|jsx)$/i.test(file));
}

export function hasReadmeFile(rootPath, depth = 3) {
    return collectWorkspaceFiles(rootPath, depth).some((file) => /(?:^|\/)README\.md$/i.test(file));
}

function sourceImplementsJsonStorage(source) {
    const text = String(source || "");
    if (!/['"`][^'"`\n]+\.json['"`]/i.test(text)) {
        return false;
    }

    return (
        /\bJSON\.(?:parse|stringify)\b/.test(text) ||
        /\bjson\.(?:load|dump|loads|dumps)\b/.test(text) ||
        /\breadFileSync\b|\bwriteFileSync\b/.test(text) ||
        /\bwith\s+open\s*\(/.test(text) ||
        /\bopen\s*\(/.test(text)
    );
}

export function hasJsonStorageArtifact(rootPath, depth = 3) {
    const files = collectWorkspaceFiles(rootPath, depth);
    if (files.some((file) => /\.json$/i.test(file))) {
        return true;
    }

    const sourceFiles = files.filter((file) => /\.(?:py|js|mjs|cjs|ts|tsx|jsx)$/i.test(file));
    return sourceFiles.some((file) => sourceImplementsJsonStorage(readWorkspaceFileSafe(rootPath, file)));
}
