export function normalizeSectionName(rawName) {
    const value = rawName.trim().toLowerCase();
    if (value === "plan") {
        return "Plan";
    }
    if (value === "changes") {
        return "Changes";
    }
    if (value === "verification") {
        return "Verification";
    }
    if (value === "next") {
        return "Next";
    }
    return rawName.trim();
}

export function dedupeLines(lines) {
    const output = [];
    let previous = null;

    for (const line of lines) {
        const current = line.trimEnd();
        if (!current && !previous) {
            continue;
        }
        if (current === previous) {
            continue;
        }
        output.push(current);
        previous = current || null;
    }

    while (output.length > 0 && !output.at(-1)) {
        output.pop();
    }

    return output;
}

export function normalizeAgentContent(content) {
    const source = String(content || "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (!source.includes("## ")) {
        return source;
    }

    const sections = new Map();
    let currentSection = null;

    for (const line of source.split("\n")) {
        const match = line.match(/^##\s+(.+?)\s*$/);
        if (match) {
            currentSection = normalizeSectionName(match[1]);
            if (!sections.has(currentSection)) {
                sections.set(currentSection, []);
            }
            continue;
        }

        if (!currentSection) {
            currentSection = "Summary";
            if (!sections.has(currentSection)) {
                sections.set(currentSection, []);
            }
        }

        sections.get(currentSection).push(line);
    }

    const orderedSections = ["Summary", "Plan", "Changes", "Verification", "Next"];
    const chunks = [];

    for (const sectionName of orderedSections) {
        if (!sections.has(sectionName)) {
            continue;
        }
        const lines = dedupeLines(sections.get(sectionName));
        if (lines.length === 0) {
            continue;
        }
        if (sectionName !== "Summary") {
            chunks.push(`## ${sectionName}`);
        }
        chunks.push(lines.join("\n").trim());
    }

    for (const [sectionName, lines] of sections.entries()) {
        if (orderedSections.includes(sectionName)) {
            continue;
        }
        const normalizedLines = dedupeLines(lines);
        if (normalizedLines.length === 0) {
            continue;
        }
        chunks.push(`## ${sectionName}`);
        chunks.push(normalizedLines.join("\n").trim());
    }

    return chunks.filter(Boolean).join("\n\n").trim();
}

export function repairLikelyMojibakeText(content) {
    const source = String(content ?? "");
    if (!/[ÃâÐÑ]/.test(source)) {
        return source;
    }

    try {
        const repaired = Buffer.from(source, "latin1").toString("utf8");
        const weirdBefore = (source.match(/[ÃâÐÑ]/g) || []).length;
        const weirdAfter = (repaired.match(/[ÃâÐÑ]/g) || []).length;
        return weirdAfter < weirdBefore ? repaired : source;
    } catch {
        return source;
    }
}

export function collectWrittenPaths(toolCalls = []) {
    const files = new Set();
    for (const toolCall of toolCalls) {
        const actionTools = [
            "code_write_file", 
            "code_write_file_lines", 
            "code_create_single_page_site", 
            "code_replace_text", 
            "code_patch_file",
            "code_write_json"
        ];
        if (!actionTools.includes(toolCall?.name)) {
            continue;
        }
        const path = toolCall?.input?.path;
        if (typeof path === "string" && path.trim() && path.trim() !== ".") {
            files.add(path.trim());
        }
    }
    return [...files];
}

export function looksMostlyEnglish(text) {
    const source = String(text || "");
    const latin = (source.match(/[A-Za-z]/g) || []).length;
    const cyrillic = (source.match(/[А-Яа-яЁё]/g) || []).length;
    
    // If there is any cyrillic, be very careful about calling it "English"
    if (cyrillic > 10) {
        return latin > cyrillic * 5 && latin > 150;
    }
    
    return latin > cyrillic * 2 && latin > 80;
}

export function looksMostlyEnglishV2(text) {
    return looksMostlyEnglish(text);
}
