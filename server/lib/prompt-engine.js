import { languageLabel, resolveTaskLanguage } from "./language.js";
import { buildCodeAgentProfile } from "./code-agent-profile.js";
import { buildResponseLanguageInstruction } from "./language.js";
import { buildCodeAgentSoulText } from "./code-agent-workspace.js";

function hasMeaningfulChangesSection(content) {
    const changesMatch = String(content || "").match(/##\s+Changes([\s\S]*)/i);
    if (!changesMatch) {
        return false;
    }

    return /[A-Za-z0-9\u0400-\u04FF]/.test(changesMatch[1] || "");
}

export function isConsultationRequest(prompt) {
    const source = String(prompt || "").toLowerCase();
    return (
        /(brainstorm|tradeoffs|compare|comparison|options|variants|ideas|suggest|recommend|advice|architecture|explain|walk me through|just answer|without changing files|without editing files|don't change files|do not change files|don't edit files|do not edit files|no file changes|before touching files|before changing files|before editing anything|don't do anything yet|do not do anything yet|for now just|first just|first tell me|just discuss|only discuss|talk me through|what could you build|what can you build|what can you create|what are three|list \d+ options)/i.test(
            source
        ) ||
        /(\u0438\u0434\u0435\u0438|\u0432\u0430\u0440\u0438\u0430\u043d\u0442|\u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b|\u043f\u043e\u0441\u043e\u0432\u0435\u0442\u0443\u0439|\u043f\u043e\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0439|\u0441\u0440\u0430\u0432\u043d\u0438|\u043e\u0431\u044a\u044f\u0441\u043d\u0438|\u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440|\u043f\u0440\u043e\u0441\u0442\u043e \u043e\u0442\u0432\u0435\u0442\u044c|\u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0444\u0430\u0439\u043b\u043e\u0432|\u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439 \u0432 \u0444\u0430\u0439\u043b\u0430\u0445|\u043d\u0435 \u043c\u0435\u043d\u044f\u0439 \u0444\u0430\u0439\u043b\u044b|\u043d\u0435 \u0438\u0437\u043c\u0435\u043d\u044f\u0439 \u0444\u0430\u0439\u043b\u044b|\u043d\u0435 \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439 \u0444\u0430\u0439\u043b\u044b|\u043a\u0430\u043a\u0438\u0435 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b|\u0447\u0442\u043e \u0442\u044b \u043c\u043e\u0436\u0435\u0448\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c)/i.test(
            source
        )
    );
}

export function isExecutionRequest(prompt) {
    if (isConsultationRequest(prompt)) return false;
    
    const source = String(prompt || "").toLowerCase();
    // avoid matching "что ты сделал" (what did you do) as "сделать" (do/make)
    const isActuallyAction = (
        /(build|create|implement|write|fix|update|add|develop|scaffold|setup|refactor|edit|change|patch|generate)/i.test(source) ||
        /(\u0441\u043e\u0437\u0434\u0430|\u0441\u0434\u0435\u043b\u0430|\u043d\u0430\u043f\u0438\u0448|\u0440\u0435\u0430\u043b\u0438\u0437|\u0438\u0441\u043f\u0440\u0430\u0432|\u043e\u0431\u043d\u043e\u0432|\u0434\u043e\u0431\u0430\u0432|\u043f\u043e\u0441\u0442\u0440\u043e|\u0441\u043e\u0431\u0435\u0440|\u0432\u043d\u0435\u0434\u0440|\u043f\u043e\u0434\u043d\u0438\u043c)/i.test(source)
    );
    
    // ignore if it sounds like a past tense question about what was already done
    const isPastTenseQuestion = /(\u0447\u0442\u043e\s+\u0441\u0434\u0435\u043b\u0430\u043b|\u0447\u0442\u043e\s+\u0442\u044b\s+\u0441\u0434\u0435\u043b\u0430\u043b|\u0447\u0442\u043e\s+\u0442\u0443\u0442\s+\u0431\u044b\u043b\u043e\s+\u0441\u0434\u0435\u043b\u0430\u043d\u043e)/i.test(source);
    
    return isActuallyAction && !isPastTenseQuestion;
}

export function extractRequestedFileNames(prompt) {
    const source = String(prompt || "");
    const matches = source.match(/\b[a-z0-9_.-]+\.(html|css|js|jsx|ts|tsx|json|md)\b/gi) || [];
    const normalized = matches.map((value) => value.trim());

    if (/\breadme\b/i.test(source)) {
        normalized.push("README.md");
    }

    return [...new Set(normalized)];
}

export function needsClarificationV2(prompt) {
    if (isConsultationRequest(prompt)) return false;

    const source = String(prompt || "").toLowerCase();
    const requestedFiles = extractRequestedFileNames(prompt);
    const isCreativeBuild =
        /(site|website|landing|app|application|brand|chat|widget|dashboard|panel|tool|game|browser game|web game|bot|telegram mini app|mini app|tma|plugin|extension|portfolio|tracker|mem token|meme token|memtoken|token website|token site)/i.test(source) ||
        /(\u0441\u0430\u0439\u0442|\u043b\u0435\u043d\u0434\u0438\u043d\u0433|\u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435|\u0431\u0440\u0435\u043d\u0434|\u0447\u0430\u0442|\u0432\u0438\u0434\u0436\u0435\u0442|\u043f\u0430\u043d\u0435\u043b|\u0434\u0430\u0448\u0431\u043e\u0440\u0434|\u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442|\u0438\u0433\u0440|\u0432\u0435\u0431-\u0438\u0433\u0440|\u043c\u0438\u043d\u0438-\u0438\u0433\u0440|\u0431\u043e\u0442|\u043c\u0438\u043d\u0438\u0020\u0430\u043f\u043f|\u0442\u043c\u0430|\u043f\u043b\u0430\u0433\u0438\u043d|\u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u0438\u0435|\u043f\u043e\u0440\u0442\u0444\u043e\u043b\u0438\u043e|\u0442\u0440\u0435\u043a\u0435\u0440|\u043c\u0435\u043c\u0020\u0442\u043e\u043a\u0435\u043d|\u043c\u0435\u043c\u0442\u043e\u043a\u0435\u043d)/i.test(source);
    if (!isCreativeBuild) return false;

    const hasTechnicalShape =
        requestedFiles.length > 0 ||
        /(\bindex\.html\b|\bstyles?\.css\b|\bscript\.js\b|\bpackage\.json\b|\btsconfig\.json\b|\blocalstorage\b|\bapi\b|\broute\b|\bcomponent\b|\bpage\b|\bform\b|\bmodal\b|\bstate\b|\btheme\b|\bresponsive\b|\bjavascript\b|\bhtml\b|\bcss\b|\breact\b|\bvue\b|\bbrowser\b|\bstatic\b|\bseparate files?\b|\breadme\b|\bfilter\b|\bnotes?\b|\bcanvas\b|\bscore\b|\bcontrols?\b|\bkeyboard\b|\bmouse\b|\btouch\b|\btimer\b|\banimation\b|\bgame loop\b|\bcollision\b|\blevels?\b|\bsnake\b|\bpong\b|\btetris\b)/i.test(source) ||
        /(\u0444\u0430\u0439\u043b|\u043f\u0430\u043f\u043a|\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442|\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u0444\u043e\u0440\u043c|\u043c\u043e\u0434\u0430\u043b|\u0442\u0435\u043c\u043d|\u0430\u0434\u0430\u043f\u0442\u0438\u0432|\u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441|\u0431\u0440\u0430\u0443\u0437\u0435\u0440|\u0441\u0442\u0430\u0442\u0438\u0447|\u0440\u0430\u0437\u0434\u0435\u043b\u044c\u043d\u044b\u0435 \u0444\u0430\u0439\u043b|\u0440\u0438\u0434\u043c\u0438|\u0444\u0438\u043b\u044c\u0442\u0440|localstorage|api|\u043a\u0430\u043d\u0432\u0430\u0441|\u0441\u0447\u0435\u0442|\u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d|\u043a\u043b\u0430\u0432\u0438\u0430\u0442|\u0442\u0430\u0439\u043c\u0435\u0440|\u0430\u043d\u0438\u043c\u0430\u0446|\u0441\u0442\u043e\u043b\u043a\u043d\u043e\u0432|\u0443\u0440\u043e\u0432\u043d|\u0437\u043c\u0435\u0439\u043a|\u0442\u0435\u0442\u0440\u0438\u0441|\u043f\u043e\u043d\u0433)/i.test(source);
    if (hasTechnicalShape) return false;

    const hasIdentitySignals =
        /(name|ticker|logo|style|palette|color|links|copy|images|memes|react|vue|html|css|js|javascript|telegram|bot|widget|mini app|tma|title|subtitle|button|cta|placeholder|placeholders|landing|one-page|single page)/i.test(source) ||
        /(\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435|\u0442\u0438\u043a\u0435\u0440|\u043b\u043e\u0433\u043e\u0442\u0438\u043f|\u0441\u0442\u0438\u043b\u044c|\u043f\u0430\u043b\u0438\u0442\u0440|\u0446\u0432\u0435\u0442|\u0441\u0441\u044b\u043b\u043a|\u0442\u0435\u043a\u0441\u0442|\u043a\u0430\u0440\u0442\u0438\u043d|\u043c\u0435\u043c\u044b|\u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a|\u043f\u043e\u0434\u043f\u0438\u0441\u044c|\u043a\u043d\u043e\u043f\u043a|\u0437\u0430\u0433\u043b\u0443\u0448\u043a|\u043e\u0434\u043d\u043e\u0441\u0442\u0440\u0430\u043d\u0438\u0447|\u043b\u0435\u043d\u0434\u0438\u043d\u0433)/i.test(source);
    
    const hasExistingCodeSignals =
        /(\bbug\b|\berror\b|\bissue\b|\bfix\b|\brefactor\b|\bupdate existing\b|\bin this project\b|\bin this repo\b|\bin current repo\b|\bcurrent code\b|\bexisting\b|\bworkspace\b|\brepository\b|\bmodule\b|\bfunction\b|\bcomponent\b)/i.test(source) ||
        /(\u043e\u0448\u0438\u0431\u043a|\u0438\u0441\u043f\u0440\u0430\u0432|\u0440\u0435\u0444\u0430\u043a\u0442\u043e\u0440|\u043e\u0431\u043d\u043e\u0432\u0438 \u0441\u0443\u0449\u0435\u0441\u0442\u0432|\u0432 \u044d\u0442\u043e\u043c \u043f\u0440\u043e\u0435\u043a\u0442\u0435|\u0432 \u044d\u0442\u043e\u043c \u0440\u0435\u043f\u043e|\u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u043a\u043e\u0434|\u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449|\u0432\u043e\u0440\u043a\u0441\u043f\u0435\u0439\u0441|\u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440|\u043c\u043e\u0434\u0443\u043b|\u0444\u0443\u043d\u043a\u0446|\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442)/i.test(source);

    const isShortHighLevelPrompt =
        isExecutionRequest(prompt) &&
        requestedFiles.length === 0 &&
        source.length < 90 &&
        !hasExistingCodeSignals;

    return !hasIdentitySignals || isShortHighLevelPrompt;
}

export function shouldUseConsultationMode(prompt) {
    return (
        isConsultationRequest(prompt) ||
        needsClarificationV2(prompt)
    );
}

export function buildCodeSoul(config, _repoRoot, contextPolicy = {}) {
    return buildCodeAgentSoulText(config, contextPolicy);
}

export function shouldUseProjectActivityContext(prompt) {
    const source = String(prompt || "").toLowerCase();
    if (isConsultationRequest(prompt) || needsClarificationV2(prompt)) {
        return false;
    }

    if (extractRequestedFileNames(prompt).length >= 2) {
        return false;
    }

    return (
        /(\bcontinue\b|\bcontinue working\b|\bcurrent\b|\bexisting\b|\bin this project\b|\bin this repo\b|\bin current repo\b|\bworkspace\b|\brepository\b|\bmodule\b|\bfunction\b|\bcomponent\b|\bfix\b|\bupdate\b|\brefactor\b|\breview\b|\bbug\b|\berror\b|\bissue\b)/i.test(source) ||
        /(\u043f\u0440\u043e\u0434\u043e\u043b\u0436|\u0442\u0435\u043a\u0443\u0449|\u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449|\u0432 \u044d\u0442\u043e\u043c \u043f\u0440\u043e\u0435\u043a\u0442\u0435|\u0432 \u044d\u0442\u043e\u043c \u0440\u0435\u043f\u043e|\u0432\u043e\u0440\u043a\u0441\u043f\u0435\u0439\u0441|\u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440|\u043c\u043e\u0434\u0443\u043b|\u0444\u0443\u043d\u043a\u0446|\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442|\u0438\u0441\u043f\u0440\u0430\u0432|\u043e\u0431\u043d\u043e\u0432|\u0440\u0435\u0444\u0430\u043a\u0442\u043e\u0440|\u0440\u0435\u0432\u044c\u044e|\u043e\u0448\u0438\u0431\u043a)/i.test(source)
    );
}

function buildContextSection(sessionContext, workspaceContext, options = {}) {
    const parts = [];
    const includeProjectMetadata = options.includeProjectMetadata !== false;
    const includeProjectMemory = options.includeProjectMemory !== false;
    const includeRecentActivity = options.includeRecentActivity !== false;

    if (includeProjectMetadata && workspaceContext?.metadata?.name) {
        parts.push(`Project context:
- project: ${workspaceContext.metadata.name}
- root: ${workspaceContext.metadata.path || "unknown"}`);
    }

    if (includeProjectMemory && Array.isArray(workspaceContext?.projectMemory) && workspaceContext.projectMemory.length > 0) {
        parts.push(`Project memory:
${workspaceContext.projectMemory.slice(-8).map((item) => `- ${item}`).join("\n")}`);
    }

    if (includeRecentActivity && workspaceContext?.recentActivity) {
        parts.push(`Recent project activity:
${workspaceContext.recentActivity}`);
    }

    if (sessionContext?.summary) {
        parts.push(`Chat summary:
${sessionContext.summary}`);
    }

    if (sessionContext?.compressed) {
        parts.push(
            `Chat state:
- summarizedMessages: ${sessionContext.summarizedMessages || 0}
- recentMessages: ${sessionContext.recentMessages || 0}`
        );
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
}

export function shouldForceExecutionV2(prompt, response) {
    if (isConsultationRequest(prompt)) return false;
    if (needsClarificationV2(prompt)) return false;
    if (!isExecutionRequest(prompt)) return false;

    const toolCalls = response.toolCalls || [];
    const actionTools = new Set([
        "code_write_file",
        "code_write_file_lines",
        "code_replace_text",
        "code_patch_file",
        "code_make_dirs",
        "code_move_path",
        "code_delete_path",
        "code_run_command",
        "code_run_check_suite"
    ]);
    const usedActionTool = toolCalls.some((tc) => actionTools.has(tc?.name));

    const content = String(response.content || "");
    const hasMeaningfulChanges = hasMeaningfulChangesSection(content);
    const hasBlockingReason = /(blocked|cannot|can't|need confirmation|missing|invalid api|authentication_error|не могу|нужно подтверждение|не хватает данных)/i.test(content);
    
    // Detect "promised action" in text
    const actionKeywords = /(теперь|сейчас|создаю|записываю|запускаю|проверю|пишу|напишу|обновлю|исправлю|now|creating|writing|running|checking|updating|fixing|implementing|I will|I'll|creating a file|writing code)/i;
    const promisesAction = actionKeywords.test(content);
    const looksLikePlanOnly = /##\s+Plan/i.test(content) && !/##\s+Changes/i.test(content);

    if (hasBlockingReason) return false;
    
    // Check for specific file promises
    const filesInText = extractRequestedFileNames(content);
    
    // Safely extract written files from tool calls
    const writtenFiles = new Set();
    for (const tc of toolCalls) {
        if (!["code_write_file", "code_write_file_lines", "code_patch_file"].includes(tc.name)) continue;
        
        try {
            const args = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : (tc.args || tc.parameters || tc.arguments || {});
            const filePath = args.path || args.targetFile || args.TargetFile || args.target_file || "";
            const fileName = filePath.split(/[\\/]/).pop();
            if (fileName) writtenFiles.add(fileName);
        } catch (e) {
            // If we can't parse arguments, we can't verify. Assume failed verification for safety.
        }
    }

    let missingPromisedFile = false;
    for (const f of filesInText) {
        const pos = content.indexOf(f);
        const surrounding = content.slice(Math.max(0, pos - 60), pos + 30);
        if (actionKeywords.test(surrounding) && !writtenFiles.has(f)) {
            missingPromisedFile = true;
            break;
        }
    }

    // Diagnostic log (will appear in server console)
    if (promisesAction || missingPromisedFile || usedActionTool) {
        console.log(`[RUNTIME] Hallucination Check: promisesAction=${promisesAction}, usedActionTool=${usedActionTool}, missingPromisedFile=${missingPromisedFile}, writtenFiles=[${Array.from(writtenFiles).join(', ')}]`);
    }

    // Force repair if agent promises action but didn't call any action tool, 
    // or if specific files were promised but not written
    if ((promisesAction && !usedActionTool && !hasMeaningfulChanges) || missingPromisedFile) {
        return true;
    }

    return !usedActionTool && (!hasMeaningfulChanges || looksLikePlanOnly);
}

export function buildTaskPrompt(prompt, workspace, sessionContext = null, workspaceContext = null, settings = {}) {
    const responseLanguageInstruction = buildResponseLanguageInstruction(prompt, settings);
    const requestedFiles = extractRequestedFileNames(prompt);
    const isConsultation = isConsultationRequest(prompt);
    const clarificationRequired = needsClarificationV2(prompt);
    const codeAgentProfile = buildCodeAgentProfile(settings);
    const contextualNotes = buildContextSection(sessionContext, workspaceContext, {
        includeProjectMetadata: !clarificationRequired,
        includeProjectMemory: !isConsultation && !clarificationRequired,
        includeRecentActivity: shouldUseProjectActivityContext(prompt)
    });
    const includeWorkspaceRoot = !isConsultation && !clarificationRequired;
    const workspaceSection = [
        "Workspace:",
        `- name: ${workspace?.name || "unknown"}`,
        ...(includeWorkspaceRoot ? [`- root: ${workspace?.path || "unknown"}`] : [])
    ].join("\n");

    const explicitFileRule = requestedFiles.length >= 2 ? `The owner explicitly requested multiple files (${requestedFiles.join(", ")}). Create or update them as real artifacts.` : "";
    
    let clarificationRule = "";
    if (isConsultation) {
        clarificationRule = "This is a consultation-only request. Answer directly with options, tradeoffs, or guidance. DO NOT modify files, DO NOT run execution tools, and DO NOT claim implementation work.";
    } else if (clarificationRequired) {
        clarificationRule = "The request is under-specified. Ask one short clarifying question. Do not inspect files, do not list the workspace, and do not mention internal paths unless the owner explicitly asked about existing code. If helpful, offer up to three concrete directions the owner can choose from.";
    } else {
        clarificationRule = "If the task is clear and actionable, move forward without unnecessary questions. Inspect the relevant code first, then edit with intent.";
    }

    const newRules = `
    * OPERATE LIKE A REAL CODE AGENT: Choose between consultation, inspection, execution, review, or recovery based on the request and current state.
    * CONTEXT FIRST: For existing codebases, list/search/read the relevant files before editing. For obviously greenfield tasks inside an empty project, act directly.
    * EXECUTION DISCIPLINE: Make focused changes, then run the smallest meaningful verification available.
    * SOURCE WRITING: For HTML, CSS, JS, TS, JSX, TSX, JSON, or Markdown, write raw file content only. Never serialize source code as arrays, objects, style maps, or pseudo-JSON.
    * QUOTING SAFETY: If a source file contains many quotes, markup, or multiline text, prefer code_write_file_lines and send one plain source line per array item.
    * REVIEW MODE: If the owner asks for review, findings come first. Prioritize bugs, regressions, risk, and missing tests.
    * CONSULTATION MODE: If the owner is asking for explanation, tradeoffs, or brainstorming, answer directly and do not change files unless asked.
    * APP PREVIEW: If web files are created or updated, use preview-oriented workflow instead of inventing unnecessary local servers.
    * BE SENIOR: Provide clean, idiomatic, production-ready code. No placeholders.
    * LANGUAGE: ${responseLanguageInstruction}
    * THOUGHTS: Your visible steps should be short, factual, and tied to real work.
    * HONESTY: Never claim to have read, changed, tested, or verified something unless tools or code inspection actually confirmed it.
    * RESPONSE FORMAT: Use Markdown for narrative when needed, but keep the answer tight.`;

    return `
${workspaceSection}

Owner request:
${prompt}

Execution protocol:
Do not create files outside the active workspace root.
Follow this language rule: ${responseLanguageInstruction}
Never claim success unless tool output confirmed it.
Be precise and professional. Avoid "robotic" templates.
${explicitFileRule}
${clarificationRule}
${codeAgentProfile.promptGuidance}
${contextualNotes ? `\nRelevant IDE context:\n${contextualNotes}` : ""}
${newRules}
`.trim();
}
