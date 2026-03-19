import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { inferPreviewEntry } from "./workspace-manager.js";

function sectionize(content) {
    const source = String(content || "").replace(/\r\n/g, "\n").trim();
    if (!source) {
        return [];
    }

    const lines = source.split("\n");
    const sections = [];
    let current = { name: "narrative", lines: [] };

    for (const line of lines) {
        const heading = line.match(/^##\s+(.+?)\s*$/);
        if (heading) {
            if (current.lines.length > 0) {
                sections.push(current);
            }
            current = { name: heading[1].trim().toLowerCase(), lines: [] };
            continue;
        }
        current.lines.push(line);
    }

    if (current.lines.length > 0) {
        sections.push(current);
    }

    return sections
        .map((section) => ({
            ...section,
            text: section.lines.join("\n").trim()
        }))
        .filter((section) => section.text);
}

function collectExecutedToolCalls(task) {
    return (task?.steps || [])
        .filter(
            (step) =>
                step?.type === "tool_finished" &&
                step?.name &&
                step?.result?.requiresPermission !== true &&
                step?.result?.success !== false
        )
        .map((step) => ({
            name: step.name,
            input: step.params || {},
            result: step.result || {}
        }));
}

function dedupeToolCalls(toolCalls = []) {
    const seen = new Set();
    const output = [];

    for (const toolCall of toolCalls) {
        const key = JSON.stringify({
            name: toolCall?.name || "",
            input: toolCall?.input || {},
            path:
                toolCall?.result?.data?.path ||
                toolCall?.result?.path ||
                toolCall?.result?.data?.diff?.file ||
                ""
        });

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        output.push(toolCall);
    }

    return output;
}

function collectPaths(toolCalls = [], allowedNames = null) {
    const files = new Set();

    for (const toolCall of toolCalls) {
        if (allowedNames && !allowedNames.has(toolCall?.name)) {
            continue;
        }

        const candidates = [
            toolCall?.input?.path,
            toolCall?.input?.targetPath,
            toolCall?.args?.path,
            toolCall?.args?.targetPath,
            toolCall?.result?.path,
            toolCall?.result?.relativePath,
            toolCall?.result?.data?.path,
            toolCall?.result?.data?.relativePath,
            ...(Array.isArray(toolCall?.input?.paths) ? toolCall.input.paths : []),
            ...(Array.isArray(toolCall?.result?.files) ? toolCall.result.files : []),
            ...(Array.isArray(toolCall?.result?.data?.files) ? toolCall.result.data.files : [])
        ];

        for (const candidate of candidates) {
            if (typeof candidate === "string" && candidate.trim() && candidate.trim() !== ".") {
                files.add(candidate.replace(/\\/g, "/"));
            }
        }
    }

    return [...files];
}

function collectInspectedFiles(toolCalls = []) {
    const inspected = new Set(
        collectPaths(
            toolCalls,
            new Set([
                "code_list_files",
                "code_inspect_project",
                "code_read_file",
                "code_read_files",
                "code_search_text",
                "code_search_context",
                "code_suggest_commands",
                "code_git_status",
                "code_git_diff"
            ])
        )
    );

    for (const toolCall of toolCalls) {
        if (toolCall?.name !== "code_search_context") {
            continue;
        }

        for (const snippet of toolCall?.result?.snippets || []) {
            if (typeof snippet?.file === "string" && snippet.file.trim()) {
                inspected.add(snippet.file.replace(/\\/g, "/"));
            }
        }

        for (const match of toolCall?.result?.matches || []) {
            if (typeof match?.file === "string" && match.file.trim()) {
                inspected.add(match.file.replace(/\\/g, "/"));
            }
        }
    }

    return [...inspected].slice(0, 12);
}

function collectChangedFiles(toolCalls = []) {
    return collectPaths(
        toolCalls,
        new Set([
            "code_write_file",
            "code_write_file_lines",
            "code_create_single_page_site",
            "code_replace_text",
            "code_patch_file",
            "code_insert_block",
            "code_move_path",
            "code_delete_path",
            "code_write_json"
        ])
    ).slice(0, 12);
}

function markdownItems(text) {
    return String(text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim());
}

function containsFileReferences(items = []) {
    return items.some((item) =>
        /\b[a-z0-9_.-]+\.(html?|css|js|jsx|ts|tsx|json|md)\b/i.test(String(item || ""))
    );
}

function shouldShowDiffBlocks(task) {
    return /(\bdiff\b|\bpatch\b|\breview\b|\bchanges?\b|\u0434\u0438\u0444\u0444|\u043f\u0430\u0442\u0447|\u0440\u0435\u0432\u044c\u044e|\u0438\u0437\u043c\u0435\u043d\u0435\u043d)/i.test(
        String(task?.prompt || "")
    );
}

function summarizeRequestedActions(prompt, language = "ru") {
    const source = String(prompt || "").toLowerCase();
    const items = [];
    const push = (ru, en) => items.push(language === "ru" ? ru : en);

    if (/(create|build|implement|write|add|develop|scaffold|setup|созда|сдела|реализ|напиш|добав|собер)/i.test(source)) {
        push("создать или изменить файлы проекта", "create or edit project files");
    }
    if (/(run|start|test|lint|install|build|запуст|прове|тест|линт|установ)/i.test(source)) {
        push("запустить команды проекта или проверки", "run project commands or validation");
    }
    if (/(delete|remove|rename|move|удал|переимен|перемест)/i.test(source)) {
        push("удалить, переименовать или переместить файлы", "delete, rename, or move files");
    }
    if (/(search|docs|documentation|api|поиск|документац)/i.test(source)) {
        push("поискать релевантный контекст и документацию", "search for relevant context and documentation");
    }

    if (items.length === 0) {
        push("выполнить рабочие шаги внутри проекта", "execute work steps inside the project");
    }

    return [...new Set(items)];
}

function permissionTextForScope(scope, language = "ru") {
    const map = {
        task: {
            ru: "Агенту нужны разрешения на рабочие действия по задаче.",
            en: "The agent needs approval for execution actions in this task."
        },
        write: {
            ru: "Следующий шаг изменит файлы проекта.",
            en: "The next step will modify project files."
        },
        verify: {
            ru: "Следующий шаг запустит проверку проекта.",
            en: "The next step will run project validation."
        },
        shell: {
            ru: "Следующий шаг выполнит команду в рабочей области.",
            en: "The next step will run a command inside the workspace."
        },
        destructive: {
            ru: "Следующий шаг удалит или переместит данные проекта.",
            en: "The next step will delete or move project data."
        }
    };

    return map[scope]?.[language] || map.task[language];
}

function buildPermissionItems(task, language = "ru", options = {}) {
    const params = options.blockedParams || {};
    const path = params.path || params.targetPath || params.targetFile || "";
    const command = params.command || "";
    const paths = Array.isArray(params.paths) ? params.paths.filter(Boolean) : [];
    const scope = options.approvalScope || task?.permissionScope || "task";
    const isRussian = language === "ru";

    if (options.continuation) {
        if (command) {
            return [isRussian ? `выполнить команду \`${command}\`` : `run \`${command}\``];
        }
        if (path && scope === "destructive") {
            return [isRussian ? `удалить или переместить \`${path}\`` : `delete or move \`${path}\``];
        }
        if (path) {
            return [isRussian ? `изменить \`${path}\`` : `modify \`${path}\``];
        }
        if (paths.length > 0) {
            return [isRussian ? `создать каталоги: ${paths.join(", ")}` : `create directories: ${paths.join(", ")}`];
        }
        return [permissionTextForScope(scope, language)];
    }

    return summarizeRequestedActions(task?.prompt, language);
}

function inferPreviewBlockType(filePath) {
    const extension = extname(filePath).toLowerCase();
    if (extension === ".md") {
        return "markdown";
    }
    if ([".html", ".htm"].includes(extension)) {
        return "runnable_code";
    }
    return "code";
}

function collectChangedFilePreviewBlocks(workspace, changedFiles = []) {
    if (!workspace?.path) {
        return [];
    }

    const blocks = [];
    const seenPaths = new Set();
    for (const relativePath of changedFiles) {
        if (blocks.length >= 6) {
            break;
        }

        if (seenPaths.has(relativePath)) {
            continue;
        }
        seenPaths.add(relativePath);

        const absolutePath = join(workspace.path, relativePath);
        if (!existsSync(absolutePath)) {
            continue;
        }

        try {
            const stats = statSync(absolutePath);
            if (!stats.isFile() || stats.size > 120_000) {
                continue;
            }

            blocks.push({
                type: inferPreviewBlockType(relativePath),
                file: basename(relativePath),
                path: relativePath,
                code: readFileSync(absolutePath, "utf-8")
            });
        } catch {
            continue;
        }
    }

    return blocks;
}

function resolvePreviewEntry(workspace, changedFiles = [], inspectedFiles = []) {
    const candidate =
        [...changedFiles, ...inspectedFiles].find((file) => typeof file === "string" && file.endsWith(".html")) ||
        inferPreviewEntry(workspace);

    return typeof candidate === "string" && candidate.trim()
        ? candidate.replace(/\\/g, "/")
        : null;
}

function resolvePreviewAssetPath(entryPath, assetPath) {
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

    const baseParts = String(entryPath || "").split("/").filter(Boolean);
    baseParts.pop();
    const resolved = [];

    for (const part of [...baseParts, ...assetPath.split("/")]) {
        if (!part || part === ".") {
            continue;
        }
        if (part === "..") {
            resolved.pop();
            continue;
        }
        resolved.push(part);
    }

    return resolved.join("/");
}

function canRenderPreview(workspace, entryPath) {
    if (!workspace?.path || !entryPath) {
        return false;
    }

    const absoluteEntry = join(workspace.path, entryPath);
    if (!existsSync(absoluteEntry)) {
        return false;
    }

    try {
        const html = readFileSync(absoluteEntry, "utf-8");
        const assetRegex = /<(?:link|script|img|source)\b[^>]*(?:href|src)=["']([^"'#?]+(?:\?[^"']*)?)["'][^>]*>/gi;

        for (const match of html.matchAll(assetRegex)) {
            const resolvedAsset = resolvePreviewAssetPath(entryPath, String(match[1] || "").split("#")[0].trim());
            if (!resolvedAsset) {
                continue;
            }

            if (!existsSync(join(workspace.path, resolvedAsset))) {
                return false;
            }
        }

        return true;
    } catch {
        return false;
    }
}

function collectTerminalBlocks(task) {
    const blocks = [];
    const steps = task?.steps || [];

    for (const step of steps) {
        if (step?.type !== "tool_finished" || step?.name !== "code_run_command") {
            continue;
        }

        const command =
            step?.params?.command ||
            step?.input?.command ||
            step?.args?.command ||
            step?.result?.command ||
            "";
        const stdout = String(step?.result?.data?.stdout || step?.result?.stdout || "");
        const stderr = String(step?.result?.data?.stderr || step?.result?.stderr || "");
        const exitCode =
            typeof step?.result?.data?.exitCode === "number"
                ? step.result.data.exitCode
                : typeof step?.result?.exitCode === "number"
                  ? step.result.exitCode
                  : 0;

        blocks.push({
            type: "terminal",
            title: command || "Command",
            command,
            output: [stdout, stderr].filter(Boolean).join(stderr ? "\n" : ""),
            exitCode,
            status: exitCode === 0 ? "success" : "error"
        });
    }

    return blocks;
}

function collectSearchBlocks(toolCalls = []) {
    const blocks = [];

    for (const toolCall of toolCalls) {
        if (!["code_search_text", "code_search_context", "code_web_search"].includes(toolCall?.name)) {
            continue;
        }

        if (toolCall.name === "code_web_search") {
            const results = (toolCall?.result?.results || []).slice(0, 5).map((item) => ({
                title: item.title || item.url || "Result",
                description: item.content || item.snippet || "",
                url: item.url || ""
            }));

            if (results.length > 0) {
                blocks.push({
                    type: "search_results",
                    title: "Web search",
                    results
                });
            }
            continue;
        }

        const snippets = (toolCall?.result?.snippets || []).slice(0, 8).map((item) => ({
            file: item.file || "",
            line: item.matchLine || 0,
            text: Array.isArray(item.preview)
                ? item.preview.map((row) => `${row.line}: ${row.text}`).join("\n")
                : ""
        }));
        const matches = (toolCall?.result?.matches || []).slice(0, 8).map((item) => ({
            file: item.file || "",
            line: item.line || item.matchLine || 0,
            text: item.text || ""
        }));
        const results = [...snippets, ...matches].filter((item) => item.file || item.text);

        if (results.length > 0) {
            blocks.push({
                type: "search_results",
                title: "Code search",
                results
            });
        }
    }

    return blocks;
}

function collectDiffBlocks(toolCalls = []) {
    const latestByFile = new Map();

    for (const toolCall of toolCalls) {
        const diff = toolCall?.result?.data?.diff;
        if (!diff?.diff || !diff?.file) {
            continue;
        }

        const block = {
            type: "diff",
            file: basename(diff.file),
            path: diff.file,
            status: diff.changeKind || "modified",
            diff: diff.diff
        };

        if (latestByFile.has(diff.file)) {
            latestByFile.delete(diff.file);
        }
        latestByFile.set(diff.file, block);
    }

    return Array.from(latestByFile.values()).slice(-3);
}

function buildValidationBlock(task, sections, language) {
    const verification = sections.find((section) => section.name === "verification");
    if (verification) {
        return {
            type: "validation",
            status: task?.status === "completed" ? "success" : "warning",
            text: verification.text
        };
    }

    const checkStep = (task?.steps || []).find(
        (step) =>
            step?.type === "tool_finished" &&
            ["code_run_command", "code_run_check_suite"].includes(step?.name)
    );
    if (!checkStep) {
        return null;
    }

    const exitCode =
        typeof checkStep?.result?.data?.exitCode === "number"
            ? checkStep.result.data.exitCode
            : typeof checkStep?.result?.exitCode === "number"
              ? checkStep.result.exitCode
              : 0;

    return {
        type: "validation",
        status: exitCode === 0 ? "success" : "error",
        text:
            exitCode === 0
                ? language === "ru"
                    ? "Проверка завершилась без ошибок."
                    : "Validation completed without errors."
                : language === "ru"
                  ? "Проверка завершилась с ошибками."
                  : "Validation finished with errors."
    };
}

export function buildPermissionBlocks(task, language = "ru", options = {}) {
    const isRussian = language === "ru";
    const scope = options.approvalScope || task?.permissionScope || "task";
    const executedToolCalls = dedupeToolCalls(collectExecutedToolCalls(task));
    const changedFiles = collectChangedFiles(executedToolCalls);
    const summaryText =
        options.summaryText ||
        (options.continuation
            ? isRussian
                ? "Один рабочий шаг уже выполнен. Для продолжения нужно новое подтверждение."
                : "One execution step completed. I need another approval to continue."
            : permissionTextForScope(scope, language));

    const blocks = [
        {
            type: "permission",
            taskId: task.id,
            scope,
            title: isRussian ? "Требуется разрешение" : "Permission required",
            description: isRussian
                ? "Разрешить агенту выполнить следующий рабочий шаг или продолжить задачу."
                : "Allow the agent to execute the next work step or continue the task.",
            text: summaryText,
            items: buildPermissionItems(task, language, { ...options, approvalScope: scope })
        }
    ];

    if (changedFiles.length > 0) {
        blocks.push({
            type: "file_actions",
            files: changedFiles
        });
        blocks.push(...collectDiffBlocks(executedToolCalls));
    }

    return blocks;
}

export function buildDecisionBlocks(decision, language = "ru") {
    const isRussian = language === "ru";

    if (decision === "reject" || decision === "reject_all") {
        return [
            {
                type: "decision",
                status: "rejected",
                text: isRussian
                    ? "Разрешение отклонено. Действия не выполнялись."
                    : "Permission rejected. No actions were executed."
            },
            {
                type: "next_step",
                text: isRussian
                    ? "Уточните задачу или разрешите выполнение позже."
                    : "Clarify the task or approve execution later."
            }
        ];
    }

    return [
        {
            type: "decision",
            status: "accepted",
            text: isRussian
                ? "Разрешение получено. Продолжаю выполнение."
                : "Approval received. Starting execution."
        }
    ];
}

export function buildAssistantBlocks({ task, content, toolCalls = [], language = "ru", workspace = null }) {
    const executedToolCalls = collectExecutedToolCalls(task);
    const combinedToolCalls = dedupeToolCalls(toolCalls.length > 0 ? toolCalls : executedToolCalls);
    const sections = sectionize(content);
    const blocks = [];
    const narrative = sections.find((section) => section.name === "narrative");
    const summarySection =
        sections.find((section) => section.name === "changes") ||
        sections.find((section) => section.name === "summary");
    const planSection = sections.find((section) => section.name === "plan");
    const findingsSection = sections.find((section) => section.name === "findings");
    const nextSection = sections.find((section) => section.name === "next");
    const inspected = collectInspectedFiles(combinedToolCalls);
    const changed = collectChangedFiles(combinedToolCalls);
    const summaryItems = summarySection ? markdownItems(summarySection.text) : [];
    const summaryHasFileReferences = containsFileReferences(summaryItems);

    const hasSpecialSections = Boolean(
        summarySection ||
            planSection ||
            findingsSection ||
            nextSection ||
            sections.find((section) => section.name === "verification")
    );

    if (!hasSpecialSections && changed.length === 0 && content.trim()) {
        return [
            {
                type: "narrative",
                text: content.trim()
            }
        ];
    }

    if (narrative) {
        blocks.push({ type: "narrative", text: narrative.text });
    } else if (!planSection && !summarySection && content.trim()) {
        blocks.push({ type: "narrative", text: content.trim() });
    }

    if (inspected.length > 0 && (Boolean(findingsSection) || task?.status === "failed")) {
        blocks.push({ type: "files_inspected", files: inspected });
    }

    if (findingsSection) {
        blocks.push({
            type: "findings",
            items: markdownItems(findingsSection.text)
        });
    }

    if (planSection) {
        blocks.push({
            type: "execution_plan",
            items: markdownItems(planSection.text)
        });
    }

    if (task?.status === "failed" || !content.trim()) {
        blocks.push(...collectSearchBlocks(combinedToolCalls));
        blocks.push(...collectTerminalBlocks(task));
    }

    if (changed.length > 0) {
        if (!summaryHasFileReferences) {
            blocks.push({
                type: "file_actions",
                files: changed,
                previewable: changed.some((file) => file.endsWith(".html"))
            });
        }
        if (shouldShowDiffBlocks(task)) {
            blocks.push(...collectDiffBlocks(combinedToolCalls));
        }

        const hasHtml = changed.some((file) => file.endsWith(".html")) || inspected.some((file) => file.endsWith(".html"));
        if (hasHtml && task?.status === "completed" && workspace?.id) {
            const previewEntry = resolvePreviewEntry(workspace, changed, inspected);
            if (previewEntry && canRenderPreview(workspace, previewEntry)) {
                blocks.push({
                    type: "app_preview",
                    taskId: task.id,
                    url: `/preview/${workspace.id}/${previewEntry}`
                });
            }
        }
    }

    const validationBlock = buildValidationBlock(task, sections, language);
    if (validationBlock) {
        blocks.push(validationBlock);
    }

    if (task?.status === "failed") {
        blocks.push({
            type: "error",
            taskId: task?.id || null,
            text: content || (language === "ru" ? "Задача завершилась с ошибкой." : "Task failed.")
        });
    } else if ((task?.steps || []).some((step) => step?.level === "repair")) {
        blocks.push({
            type: "recovery",
            text:
                language === "ru"
                    ? "Во время выполнения был запущен автоматический этап исправления."
                    : "An automatic recovery pass was used during execution."
        });
    }

    if (summarySection) {
        blocks.push({
            type: "summary",
            text: summarySection.text,
            items: summaryItems,
            files: changed
        });
    }

    if (nextSection) {
        blocks.push({ type: "next_step", text: nextSection.text });
    }

    if (blocks.length === 0 && content.trim()) {
        blocks.push({ type: "summary", text: content.trim() });
    }

    return blocks;
}
