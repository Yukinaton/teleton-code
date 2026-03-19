import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listWorkspaceTree } from "../../lib/workspace-utils.js";
import { repairLikelyMojibakeText } from "../../lib/format-utils.js";
import { extractRequestedFileNames, isConsultationRequest } from "../../lib/prompt-engine.js";
import { validatePromptAlignment, validateWrittenFiles } from "../../lib/validation-engine.js";

function extractJsonObject(text) {
    const source = String(text || "").trim();
    if (!source) {
        return null;
    }

    const direct = (() => {
        try {
            return JSON.parse(source);
        } catch {
            return null;
        }
    })();
    if (direct && typeof direct === "object") {
        return direct;
    }

    const match = source.match(/\{[\s\S]*\}/);
    if (!match) {
        return null;
    }

    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}

function stripCodeFences(text, targetPath = "") {
    const source = String(text || "").trim();
    const extension = String(targetPath || "").split(".").pop() || "";
    const fenced = source.match(/^```(?:[\w+-]+)?\n([\s\S]*?)\n```$/);
    if (fenced) {
        return fenced[1].trim();
    }

    const inlineFence = source.match(
        new RegExp(
            "^```(?:" + extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")?\\n([\\s\\S]*?)\\n```$",
            "i"
        )
    );
    if (inlineFence) {
        return inlineFence[1].trim();
    }

    return source;
}

function extractTaggedFileContents(text = "") {
    return [...String(text || "").replace(/\r\n/g, "\n").matchAll(/<<<FILE:([^\n>]+)\n([\s\S]*?)>>>FILE/g)]
        .map((match) => ({
            path: String(match[1] || "").trim(),
            content: String(match[2] || "").trim()
        }))
        .filter((item) => item.path && item.content);
}

function summarizeGeneratedFile(path, content) {
    const preview = String(content || "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .slice(0, 4)
        .join(" ")
        .slice(0, 220);

    return {
        path,
        preview
    };
}

function namespaceLocalStorageKeys(content, namespace) {
    const source = String(content ?? "");
    if (!namespace || !/localStorage\.(?:getItem|setItem|removeItem)\(/.test(source)) {
        return source;
    }

    return source.replace(
        /\blocalStorage\.(getItem|setItem|removeItem)\(\s*(['"`])([^'"`]+)\2/g,
        (match, method, quote, key) => {
            const normalizedKey = String(key || "").trim();
            if (!normalizedKey || normalizedKey.startsWith(`${namespace}:`)) {
                return match;
            }
            return `localStorage.${method}(${quote}${namespace}:${normalizedKey}${quote}`;
        }
    );
}

export function isGreenfieldBuildRequest(prompt, workspace) {
    if (!workspace || isConsultationRequest(prompt)) {
        return false;
    }

    const source = String(prompt || "");
    if (!/(build|create|implement|make|scaffold|ship|assemble|prototype|СЃРѕР±РµСЂРё|СЃРѕР·РґР°Р№|СЃРґРµР»Р°Р№|СЂРµР°Р»РёР·СѓР№|РїРѕРґРіРѕС‚РѕРІСЊ|РїРѕСЃС‚СЂРѕР№)/i.test(source)) {
        return false;
    }

    const entries = listWorkspaceTree(workspace.path, "", 2).entries.filter(
        (entry) => entry?.path && entry.path !== ".teleton-workspace"
    );

    if (entries.length > 4) {
        return false;
    }

    return /(site|website|landing|page|browser|frontend|ui|widget|todo|notes|tracker|dashboard|html|css|javascript|js|readme|СЃР°Р№С‚|Р»РµРЅРґРёРЅРі|СЃС‚СЂР°РЅРёС†Р°|Р±СЂР°СѓР·РµСЂ|РёРЅС‚РµСЂС„РµР№СЃ|С‚СЂРµРєРµСЂ|Р·Р°РјРµС‚Рє|СЂРёРґРјРё|html|css|javascript|С„СЂРѕРЅС‚)/i.test(
        source
    );
}

function buildFallbackStructuredPlan(prompt) {
    const requestedFiles = extractRequestedFileNames(prompt);
    const lowerRequested = new Set(requestedFiles.map((file) => file.toLowerCase()));
    const isStaticWebTask = /(site|website|landing|page|browser|frontend|ui|widget|todo|notes|tracker|dashboard|html|css|javascript|js|СЃР°Р№С‚|Р»РµРЅРґРёРЅРі|СЃС‚СЂР°РЅРёС†Р°|Р±СЂР°СѓР·РµСЂ|РёРЅС‚РµСЂС„РµР№СЃ|С‚СЂРµРєРµСЂ|Р·Р°РјРµС‚Рє)/i.test(
        String(prompt || "")
    );
    const files = [];

    if (isStaticWebTask || requestedFiles.length === 0) {
        if (!lowerRequested.size || lowerRequested.has("index.html")) {
            files.push({ path: "index.html", purpose: "Primary browser entry for the app." });
        }
        if (!lowerRequested.size || lowerRequested.has("styles.css")) {
            files.push({ path: "styles.css", purpose: "App styling for the browser UI." });
        }
        if (!lowerRequested.size || lowerRequested.has("script.js")) {
            files.push({ path: "script.js", purpose: "Client-side app logic for the browser UI." });
        }
    }

    for (const file of requestedFiles) {
        if (!files.some((item) => item.path.toLowerCase() === file.toLowerCase())) {
            files.push({ path: file, purpose: `Requested project file ${file}.` });
        }
    }

    if (/readme/i.test(String(prompt || "")) && !files.some((item) => item.path.toLowerCase() === "readme.md")) {
        files.push({ path: "README.md", purpose: "Short project usage notes." });
    }

    return {
        directories: [],
        files,
        checks: []
    };
}

function extractMissingRequestedFiles(problems = []) {
    return [
        ...new Set(
            problems
                .map((problem) => String(problem || "").match(/^Requested file missing: (.+)$/)?.[1]?.trim())
                .filter(Boolean)
        )
    ];
}

function extractMissingAssetFiles(problems = []) {
    return [
        ...new Set(
            problems
                .map((problem) => String(problem || "").match(/referenced asset missing \((.+)\)/)?.[1]?.trim())
                .filter(Boolean)
        )
    ];
}

function extractDomRepairTargets(problems = []) {
    const hasDomBindingProblem = problems.some((problem) =>
        /missing DOM id bindings|missing DOM class bindings|missing data-\* bindings|missing dataset bindings/i.test(
            String(problem || "")
        )
    );

    if (!hasDomBindingProblem) {
        return [];
    }

    return ["index.html", "script.js"];
}

export async function runStructuredBuildFlowV2({
    serviceConfig,
    toolRegistry,
    callStructuredChat,
    sessionId,
    prompt,
    settings,
    language,
    languageName,
    workspace,
    onTaskEvent,
    sessionChatId,
    logger = {}
}) {
    const chatId = sessionChatId(sessionId);
    const executionContext = {
        chatId,
        prompt,
        settings,
        command: ""
    };
    const successfulToolCalls = [];
    const requestedFiles = extractRequestedFileNames(prompt);
    const workspaceEntries = listWorkspaceTree(workspace.path, "", 2).entries
        .filter((entry) => entry?.path && entry.path !== ".teleton-workspace")
        .slice(0, 24)
        .map((entry) => `${entry.isDir ? "dir" : "file"}:${entry.path}`)
        .join("\n");

    const planPrompt = `You are planning a greenfield build inside Teleton Code IDE.
Return JSON only with this shape:
{
  "directories": ["optional/path"],
  "files": [{ "path": "index.html", "purpose": "why this file exists" }],
  "checks": ["optional validation command without shell operators"]
}

Rules:
- Keep the plan minimal and implementable.
- Prefer root-level browser files like index.html, styles.css, script.js for small static apps.
- Include README.md when the owner requested it or when multiple files are created.
- Do not include explanations outside JSON.

Owner request:
${prompt}

Current workspace snapshot:
${workspaceEntries || "(empty)"}

Explicit requested files:
${requestedFiles.length > 0 ? requestedFiles.join(", ") : "(none)"}`;

    await onTaskEvent({
        type: "planning",
        name: "structured_plan",
        title: language === "ru" ? "РЎС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ РїР»Р°РЅ" : "Structured plan",
        thought:
            language === "ru"
                ? "РЎРЅР°С‡Р°Р»Р° СЃРѕР±РёСЂР°СЋ РјРёРЅРёРјР°Р»СЊРЅС‹Р№ РёСЃРїРѕР»РЅРёРјС‹Р№ РїР»Р°РЅ РїСЂРѕРµРєС‚Р°."
                : "Building a minimal executable project plan first.",
        status: "running",
        durationMs: 0,
        chatId
    });

    let plan = buildFallbackStructuredPlan(prompt);
    try {
        const planText = await callStructuredChat(
            `You are a senior software engineer planning files for a new project. Reply in ${languageName}. JSON only.`,
            planPrompt,
            { temperature: 0.1, maxTokens: 1400 }
        );
        const parsedPlan = extractJsonObject(planText);
        if (parsedPlan && Array.isArray(parsedPlan.files) && parsedPlan.files.length > 0) {
            plan = {
                directories: Array.isArray(parsedPlan.directories)
                    ? parsedPlan.directories.filter((item) => typeof item === "string")
                    : [],
                files: parsedPlan.files
                    .filter((item) => item && typeof item.path === "string")
                    .map((item) => ({
                        path: item.path,
                        purpose: typeof item.purpose === "string" ? item.purpose : `Project file ${item.path}.`
                    })),
                checks: Array.isArray(parsedPlan.checks)
                    ? parsedPlan.checks.filter((item) => typeof item === "string")
                    : []
            };
        }
    } catch (error) {
        if (typeof logger.warn === "function") {
            logger.warn(`Structured planning fallback used: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    await onTaskEvent({
        type: "planning",
        name: "structured_plan",
        title: language === "ru" ? "РЎС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅС‹Р№ РїР»Р°РЅ" : "Structured plan",
        thought:
            language === "ru"
                ? `РџРѕРґРіРѕС‚РѕРІРёР» РїР»Р°РЅ: ${plan.files.map((file) => file.path).join(", ")}.`
                : `Prepared the plan: ${plan.files.map((file) => file.path).join(", ")}.`,
        status: "success",
        durationMs: 0,
        chatId,
        result: { success: true, data: plan }
    });

    if (Array.isArray(plan.directories) && plan.directories.length > 0) {
        const dirResult = await toolRegistry.execute(
            {
                id: `structured-dirs-${Date.now()}`,
                name: "code_make_dirs",
                arguments: { paths: plan.directories }
            },
            executionContext
        );
        if (!dirResult?.success) {
            throw new Error(String(dirResult?.error || "Failed to create directories"));
        }
        successfulToolCalls.push({
            name: "code_make_dirs",
            input: { paths: plan.directories },
            result: dirResult
        });
    }

    const generatedFiles = [];
    const writtenPaths = new Set();
    const localStorageNamespace = `teleton-code:${workspace.id}`;
    const coordinatedStaticBundle =
        plan.files.some((item) => item.path.toLowerCase().endsWith(".html")) &&
        plan.files.some((item) => item.path.toLowerCase().endsWith(".css")) &&
        plan.files.some((item) => /\.(m?js|cjs)$/i.test(item.path));
    const buildRepairTargets = (validationProblems = [], alignmentIssues = []) =>
        [
            ...extractMissingRequestedFiles(alignmentIssues).map((path) => ({
                path,
                purpose: `Requested project file ${path}.`,
                hints: alignmentIssues.filter((problem) => String(problem || "").includes(path)).join("; ")
            })),
            ...extractMissingAssetFiles(validationProblems).map((path) => ({
                path,
                purpose: `Referenced asset required by the generated preview at ${path}.`,
                hints: validationProblems.filter((problem) => String(problem || "").includes(path)).join("; ")
            })),
            ...extractDomRepairTargets(validationProblems).map((path) => ({
                path,
                purpose: `Repair DOM bindings and runtime wiring for ${path}.`,
                hints: validationProblems.join("; "),
                forceRewrite: true
            }))
        ].filter(
            (file, index, items) =>
                items.findIndex((candidate) => candidate.path === file.path) === index
        );
    const persistGeneratedContent = async (filePath, content) => {
        const normalizedContent = namespaceLocalStorageKeys(
            repairLikelyMojibakeText(stripCodeFences(content, filePath)),
            localStorageNamespace
        );
        const writeResult = await toolRegistry.execute(
            {
                id: `structured-write-${filePath}-${Date.now()}`,
                name: "code_write_file",
                arguments: {
                    path: filePath,
                    content: normalizedContent
                }
            },
            executionContext
        );

        if (!writeResult?.success) {
            throw new Error(String(writeResult?.error || `Failed to write ${filePath}`));
        }

        successfulToolCalls.push({
            name: "code_write_file",
            input: {
                path: filePath,
                content: normalizedContent
            },
            result: writeResult
        });
        writtenPaths.add(filePath);

        const preview = summarizeGeneratedFile(filePath, normalizedContent);
        const existingIndex = generatedFiles.findIndex((item) => item.path === filePath);
        if (existingIndex >= 0) {
            generatedFiles[existingIndex] = preview;
        } else {
            generatedFiles.push(preview);
        }
    };
    const runCoordinatedStaticBundle = async (mode = "plan", issues = []) => {
        if (!coordinatedStaticBundle || plan.files.length === 0) {
            return false;
        }

        const plannedFiles = plan.files.map((item) => item.path);
        const currentFileDump =
            mode === "repair"
                ? plannedFiles
                      .map((filePath) => {
                          const absolutePath = join(workspace.path, filePath);
                          if (!existsSync(absolutePath)) {
                              return `FILE ${filePath}: (missing)`;
                          }
                          return `FILE ${filePath}:\n${readFileSync(absolutePath, "utf-8")}`;
                      })
                      .join("\n\n")
                : "(no existing files)";
        const bundlePrompt = `Generate a coordinated browser-app file bundle for Teleton Code IDE.
Return ONLY tagged file blocks in this exact format:
<<<FILE:index.html
...full contents...
>>>FILE
<<<FILE:styles.css
...full contents...
>>>FILE

Rules:
- Provide one tagged block for every planned file.
- Do not use Markdown fences.
- Keep HTML, CSS, and JS selectors fully aligned.
- Keep asset references relative to the project root.
- Use plain source code only.
- If localStorage is used, prefix keys with "${localStorageNamespace}:".
- Prefer ASCII-only source text and UI symbols unless non-ASCII copy is explicitly required by the owner.

Owner request:
${prompt}

Planned files:
${plannedFiles.map((filePath) => `- ${filePath}`).join("\n")}

${mode === "repair" ? `Current file contents:
${currentFileDump}

Validation and alignment issues to fix:
${issues.join("\n") || "(none)"}` : "This is the initial coordinated generation pass."}`;

        const bundleText = await callStructuredChat(
            `You are generating a coordinated browser-app bundle for Teleton Code IDE. Reply only with tagged file blocks for the planned files. Language for prose: ${languageName}.`,
            bundlePrompt,
            { temperature: mode === "repair" ? 0.05 : 0.15, maxTokens: 9000 }
        );

        const bundleFiles = extractTaggedFileContents(bundleText);
        const missingFiles = plannedFiles.filter(
            (filePath) => !bundleFiles.some((item) => item.path === filePath)
        );

        if (missingFiles.length > 0) {
            return false;
        }

        for (const filePath of plannedFiles) {
            const entry = bundleFiles.find((item) => item.path === filePath);
            if (!entry) {
                return false;
            }
            await persistGeneratedContent(filePath, entry.content);
        }

        await onTaskEvent({
            type: "planning",
            name: "structured_bundle",
            title: language === "ru" ? "РЎР±РѕСЂРєР° СЃРІСЏР·Р°РЅРЅРѕРіРѕ bundle" : "Building coordinated bundle",
            thought:
                language === "ru"
                    ? "РЎРІСЏР·Р°РЅРЅС‹Р№ РЅР°Р±РѕСЂ С„Р°Р№Р»РѕРІ Р·Р°РїРёСЃР°РЅ РІ workspace Рё РѕС‚РїСЂР°РІР»РµРЅ РЅР° РїСЂРѕРІРµСЂРєСѓ."
                    : "The coordinated file set was written into the workspace and sent to verification.",
            status: "success",
            durationMs: 0,
            chatId
        });

        return true;
    };
    const writeGeneratedFile = async (file, reason = "plan") => {
        const siblingSummary = generatedFiles
            .slice(-3)
            .map((item) => `- ${item.path}: ${item.preview}`)
            .join("\n");
        let lastWriteError = null;

        await onTaskEvent({
            type: "planning",
            name: "structured_write",
            title: language === "ru" ? "РџРѕРґРіРѕС‚РѕРІРєР° С„Р°Р№Р»Р°" : "Preparing file",
            thought:
                language === "ru"
                    ? `РЎРѕР±РёСЂР°СЋ ${file.path}${reason === "repair" ? " РїРѕСЃР»Рµ РїСЂРѕРІРµСЂРєРё" : ""}.`
                    : `Building ${file.path}${reason === "repair" ? " after verification" : ""}.`,
            status: "running",
            durationMs: 0,
            chatId
        });

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const generationPrompt = `Generate the full contents for one project file.
Return ONLY raw file contents for ${file.path}.
Do not use Markdown fences.
Do not serialize code as arrays, objects, or pseudo-JSON.
Write plain source code or plain Markdown only.

Owner request:
${prompt}

File path:
${file.path}

File purpose:
${file.purpose}

Planned project files:
${plan.files.map((item) => `- ${item.path}`).join("\n")}

Recently generated sibling files:
${siblingSummary || "(none yet)"}

Repair hints:
${file.hints || "(none)"}

Important compatibility rules:
- If you write index.html for a static browser app, reference styles.css and script.js when those files exist in the plan.
- If you write README.md, describe how to open or use the project in this IDE workspace.
- If the file is a referenced asset, keep paths consistent with existing HTML references.
- If you touch HTML and JS, keep ids, classes, and data-* selectors aligned across both files.
- If you use localStorage, use a workspace-scoped key prefix "${localStorageNamespace}:".
- Prefer ASCII-only source text and UI symbols unless non-ASCII copy is explicitly required by the owner.
- Reply in ${languageName} where natural, but keep source code syntax correct.`;

            const rawContent = await callStructuredChat(
                `You are generating one file for Teleton Code IDE. Reply with raw file contents only. Language for prose: ${languageName}.`,
                generationPrompt,
                { temperature: attempt === 0 ? 0.2 : 0.05, maxTokens: 5000 }
            );
            try {
                await persistGeneratedContent(file.path, rawContent);
                lastWriteError = null;
                break;
            } catch (error) {
                lastWriteError = error instanceof Error ? error.message : String(error);
            }
        }

        if (lastWriteError) {
            throw new Error(
                language === "ru"
                    ? `РќРµ СѓРґР°Р»РѕСЃСЊ РєРѕСЂСЂРµРєС‚РЅРѕ СЃРѕР±СЂР°С‚СЊ ${file.path}: ${lastWriteError}`
                    : `Failed to build ${file.path}: ${lastWriteError}`
            );
        }

        await onTaskEvent({
            type: "planning",
            name: "structured_write",
            title: language === "ru" ? "РџРѕРґРіРѕС‚РѕРІРєР° С„Р°Р№Р»Р°" : "Preparing file",
            thought:
                language === "ru"
                    ? `${file.path} СЃРѕР±СЂР°РЅ Рё Р·Р°РїРёСЃР°РЅ РІ workspace.`
                    : `${file.path} was generated and written into the workspace.`,
            status: "success",
            durationMs: 0,
            chatId
        });
    };
    const runCoordinatedDomRepair = async (validationProblems = []) => {
        const htmlPath =
            plan.files.find((item) => item.path.toLowerCase().endsWith(".html"))?.path || "index.html";
        const scriptPath =
            plan.files.find((item) => /\.(m?js|cjs)$/i.test(item.path))?.path || "script.js";
        const htmlAbsolutePath = join(workspace.path, htmlPath);
        const scriptAbsolutePath = join(workspace.path, scriptPath);

        if (!existsSync(htmlAbsolutePath) || !existsSync(scriptAbsolutePath)) {
            return false;
        }

        await onTaskEvent({
            type: "planning",
            name: "structured_dom_repair",
            title: language === "ru" ? "РЎРѕРіР»Р°СЃРѕРІР°РЅРёРµ HTML Рё JS" : "Aligning HTML and JS",
            thought:
                language === "ru"
                    ? "Р§РёРЅСЋ HTML Рё JS РєР°Рє СЃРІСЏР·Р°РЅРЅСѓСЋ РїР°СЂСѓ, С‡С‚РѕР±С‹ СѓР±СЂР°С‚СЊ РєРѕРЅС„Р»РёРєС‚ СЃРµР»РµРєС‚РѕСЂРѕРІ."
                    : "Repairing HTML and JS together so selector bindings stay aligned.",
            status: "running",
            durationMs: 0,
            chatId
        });

        const htmlContent = readFileSync(htmlAbsolutePath, "utf-8");
        const scriptContent = readFileSync(scriptAbsolutePath, "utf-8");
        const domRepairPrompt = `Repair the browser app by fixing selector and DOM binding mismatches between ${htmlPath} and ${scriptPath}.
Return ONLY tagged file blocks in this exact format:
<<<FILE:${htmlPath}
...full contents...
>>>FILE
<<<FILE:${scriptPath}
...full contents...
>>>FILE

Rules:
- Keep the product requested by the owner intact.
- Keep HTML, JS ids, classes, and data-* selectors fully consistent.
- Do not leave orphaned selectors.
- Preserve localStorage behavior when already present.
- Use plain source code only. No Markdown fences.
- Prefer simple browser JavaScript without frameworks.
- If you use filter buttons, keep the filter values consistent across HTML and JS.

Owner request:
${prompt}

Validation problems:
${validationProblems.join("\n")}

Current ${htmlPath}:
${htmlContent}

Current ${scriptPath}:
${scriptContent}`;

        const repairText = await callStructuredChat(
            `You are repairing a broken HTML+JS pair for Teleton Code IDE. Reply only with tagged file blocks for ${htmlPath} and ${scriptPath}.`,
            domRepairPrompt,
            { temperature: 0.05, maxTokens: 7000 }
        );
        const repairedFiles = extractTaggedFileContents(repairText);
        const repairedHtml = repairedFiles.find((item) => item.path === htmlPath);
        const repairedScript = repairedFiles.find((item) => item.path === scriptPath);

        if (!repairedHtml || !repairedScript) {
            return false;
        }

        await persistGeneratedContent(htmlPath, repairedHtml.content);
        await persistGeneratedContent(scriptPath, repairedScript.content);

        await onTaskEvent({
            type: "planning",
            name: "structured_dom_repair",
            title: language === "ru" ? "РЎРѕРіР»Р°СЃРѕРІР°РЅРёРµ HTML Рё JS" : "Aligning HTML and JS",
            thought:
                language === "ru"
                    ? "HTML Рё JS РїРµСЂРµРїРёСЃР°РЅС‹ СЃРѕРІРјРµСЃС‚РЅРѕ Рё СЃРЅРѕРІР° РѕС‚РїСЂР°РІР»РµРЅС‹ РЅР° РїСЂРѕРІРµСЂРєСѓ."
                    : "HTML and JS were repaired together and sent back through verification.",
            status: "success",
            durationMs: 0,
            chatId
        });

        return true;
    };

    const generatedByBundle = await runCoordinatedStaticBundle("plan");

    if (!generatedByBundle) {
        for (const file of plan.files) {
            await writeGeneratedFile(file, "plan");
        }
    }

    let validation = await validateWrittenFiles(workspace, successfulToolCalls, serviceConfig);
    let alignmentProblems = await validatePromptAlignment(
        prompt,
        workspace,
        successfulToolCalls,
        extractRequestedFileNames
    );

    for (let repairPass = 0; repairPass < 3; repairPass += 1) {
        if (validation.problems.length === 0 && alignmentProblems.length === 0) {
            break;
        }

        const repairTargets = buildRepairTargets(validation.problems, alignmentProblems);
        if (repairTargets.length === 0) {
            break;
        }

        if (coordinatedStaticBundle) {
            const repairedBundle = await runCoordinatedStaticBundle("repair", [
                ...validation.problems,
                ...alignmentProblems
            ]);
            if (repairedBundle) {
                validation = await validateWrittenFiles(workspace, successfulToolCalls, serviceConfig);
                alignmentProblems = await validatePromptAlignment(
                    prompt,
                    workspace,
                    successfulToolCalls,
                    extractRequestedFileNames
                );
                continue;
            }
        }

        if (extractDomRepairTargets(validation.problems).length > 0) {
            const repaired = await runCoordinatedDomRepair(validation.problems);
            if (repaired) {
                validation = await validateWrittenFiles(workspace, successfulToolCalls, serviceConfig);
                alignmentProblems = await validatePromptAlignment(
                    prompt,
                    workspace,
                    successfulToolCalls,
                    extractRequestedFileNames
                );
                continue;
            }
        }

        for (const file of repairTargets) {
            if (writtenPaths.has(file.path) && !file.forceRewrite) {
                continue;
            }
            const existingPlanFile = plan.files.find((item) => item.path === file.path);
            if (existingPlanFile) {
                existingPlanFile.purpose = file.purpose || existingPlanFile.purpose;
                existingPlanFile.hints = file.hints || existingPlanFile.hints || "";
                existingPlanFile.forceRewrite = file.forceRewrite === true;
            } else {
                plan.files.push(file);
            }
            await writeGeneratedFile(existingPlanFile || file, "repair");
        }

        validation = await validateWrittenFiles(workspace, successfulToolCalls, serviceConfig);
        alignmentProblems = await validatePromptAlignment(
            prompt,
            workspace,
            successfulToolCalls,
            extractRequestedFileNames
        );
    }

    if (validation.problems.length > 0 || alignmentProblems.length > 0) {
        throw new Error([...validation.problems, ...alignmentProblems].join("; "));
    }

    const summaryLines = generatedFiles.map((file) => `- ${file.path}`);
    return {
        content: [
            "## Changes",
            ...summaryLines,
            "",
            "## Verification",
            language === "ru"
                ? "- РЎС‚СЂСѓРєС‚СѓСЂРёСЂРѕРІР°РЅРЅР°СЏ СЃР±РѕСЂРєР° Р·Р°РІРµСЂС€РµРЅР°, С„Р°Р№Р»С‹ Р·Р°РїРёСЃР°РЅС‹ Рё РїСЂРѕРІРµСЂРєР° РїСЂРѕР№РґРµРЅР°."
                : "- Structured build completed, files were written, and verification passed."
        ].join("\n"),
        toolCalls: successfulToolCalls
    };
}
