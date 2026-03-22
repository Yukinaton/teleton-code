import {
    getCodeAgentApprovalScope,
    getCodeAgentToolKind,
    getCodeAgentToolModule,
    listCodeAgentModules
} from "./code-agent-surface.js";
import { resolveTaskLanguage } from "./language.js";
import { isDangerousCommand } from "./workspace-utils.js";

const ALWAYS_INCLUDE = new Set([
    "code_list_files",
    "code_inspect_project",
    "code_read_file",
    "code_read_files",
    "code_search_text",
    "code_search_context",
    "code_suggest_commands"
]);

const TOOL_TAGS = {
    code_list_files: ["files", "folders", "tree", "workspace", "structure", "list", "directory"],
    code_write_json: ["json", "package.json", "tsconfig", "config", "write", "object"],
    code_inspect_project: ["project", "stack", "scripts", "workspace", "inspect", "overview", "package"],
    code_read_file: ["read", "inspect", "open", "file", "source", "content"],
    code_read_files: ["read", "inspect", "multiple", "batch", "files", "context"],
    code_suggest_commands: ["commands", "scripts", "test", "build", "lint", "dev", "package", "run"],
    code_write_file: ["create", "write", "replace", "file", "source", "implement", "html", "css", "js", "full-file"],
    code_write_file_lines: ["write", "line", "rewrite", "repair", "ordered", "lines", "source"],
    code_create_single_page_site: ["site", "landing", "website", "token", "page", "html"],
    code_make_dirs: ["mkdir", "folders", "directories", "scaffold", "structure", "create"],
    code_replace_text: ["replace", "edit", "update", "text", "patch", "modify"],
    code_patch_file: ["patch", "edit", "refactor", "update", "modify", "fix"],
    code_insert_block: ["insert", "anchor", "import", "route", "script", "block", "append"],
    code_move_path: ["move", "rename", "path", "file", "folder"],
    code_delete_path: ["delete", "remove", "cleanup", "file", "folder"],
    code_search_text: ["search", "find", "grep", "symbol", "todo", "text", "query"],
    code_search_context: ["search", "context", "snippet", "usage", "reference", "implementation"],
    code_web_search: ["web", "search", "docs", "documentation", "api", "package", "reference"],
    code_run_command: ["run", "command", "terminal", "build", "test", "lint", "install", "dev", "npm", "node"],
    code_install_dependencies: ["install", "dependencies", "npm", "package", "library", "dependency"],
    code_run_check_suite: ["check", "verify", "lint", "test", "build", "validation"],
    code_git_status: ["git", "status", "branch", "changes", "repository"],
    code_git_diff: ["git", "diff", "patch", "changes", "review", "repository"]
};

const INTENT_PATTERNS = {
    inspect: /(\bread\b|\binspect\b|\bopen\b|\bunderstand\b|\blook\b|\banaly[sz]e\b|\bstudy\b|\bwhat\b|\bshow\b|\bfind\b|\bsearch\b|проч|посмотр|изуч|найд|покаж|прочит|анализ|структур)/i,
    create: /(\bcreate\b|\bbuild\b|\bimplement\b|\bscaffold\b|\bsetup\b|\bmake\b|\bwrite\b|\badd\b|созда|сдела|реализ|собер|напиш|добав|подним)/i,
    edit: /(\bedit\b|\bchange\b|\bupdate\b|\bmodify\b|\brefactor\b|\bfix\b|\bpatch\b|\brewrite\b|измени|обнов|исправ|рефактор|поправ|патч)/i,
    run: /(\brun\b|\bstart\b|\btest\b|\bbuild\b|\blint\b|\binstall\b|\bnpm\b|\bpnpm\b|\byarn\b|\bnode\b|\bserve\b|запуст|проверь|тест|собер|установ|линт)/i,
    git: /(\bgit\b|\bcommit\b|\bdiff\b|\bbranch\b|\bstatus\b|\brepository\b|репозитор|коммит|ветк|дифф|статус)/i,
    web: /(\bhtml\b|\bcss\b|\bjs\b|\bjavascript\b|\bpage\b|\bsite\b|\bwebsite\b|\blanding\b|\breact\b|\bvue\b|сайт|лендинг|страниц|html|css|js|react|vue)/i,
    external: /(\bdocs?\b|\bdocumentation\b|\bapi reference\b|\bofficial\b|\bsearch the web\b|\bweb search\b|\bnpm package\b|\bpackage docs\b|\bmdn\b|\bstackoverflow\b|\bhow to\b|документац|официальн|веб[- ]?поиск|найди в интернете|поищи в интернете|api reference)/i
};

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-zа-я0-9._-]+/gi, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 2);
}

function inferIntent(query) {
    const source = String(query || "");
    return {
        inspect:
            INTENT_PATTERNS.inspect.test(source) ||
            /(проч|посмотр|изуч|найд|покаж|анализ|структур)/i.test(source),
        create:
            INTENT_PATTERNS.create.test(source) ||
            /(созда|сдела|реализ|собер|напи|добав|подним)/i.test(source),
        edit:
            INTENT_PATTERNS.edit.test(source) ||
            /(измени|обнов|исправ|рефактор|поправ|патч)/i.test(source),
        run:
            INTENT_PATTERNS.run.test(source) ||
            /(запуст|проверь|тест|собер|установ|линт)/i.test(source),
        git:
            INTENT_PATTERNS.git.test(source) ||
            /(репозитор|коммит|ветк|дифф|статус)/i.test(source),
        web:
            INTENT_PATTERNS.web.test(source) ||
            /(сайт|лендинг|страниц|html|css|js|react|vue)/i.test(source),
        external:
            INTENT_PATTERNS.external.test(source) ||
            /(документац|официальн|веб[- ]?поиск|найди в интернете|поищи в интернете)/i.test(source)
    };
}

function isSinglePageWebPrompt(query) {
    const source = String(query || "").toLowerCase();
    return /(site|website|landing|landing page|single page|one page|html page|web page|token site|token landing|сайт|лендинг|одностранич|веб-страниц)/i.test(
        source
    );
}

function scoreTool(query, tool) {
    const tokens = tokenize(query);
    const haystack = `${tool.name} ${tool.description || ""}`.toLowerCase();
    const tags = TOOL_TAGS[tool.name] || [];
    const intent = inferIntent(query);
    let score = ALWAYS_INCLUDE.has(tool.name) ? 20 : 0;

    for (const token of tokens) {
        if (haystack.includes(token)) {
            score += 3;
        }
        if (tags.some((tag) => tag.includes(token) || token.includes(tag))) {
            score += 5;
        }
    }

    if (intent.inspect && ["code_list_files", "code_inspect_project", "code_read_file", "code_read_files", "code_search_text", "code_search_context", "code_suggest_commands"].includes(tool.name)) {
        score += 20;
    }
    if (intent.create && ["code_write_file", "code_write_file_lines", "code_make_dirs", "code_patch_file"].includes(tool.name)) {
        score += 18;
    }
    if (intent.edit && ["code_patch_file", "code_replace_text", "code_read_file", "code_read_files"].includes(tool.name)) {
        score += 18;
    }
    if (intent.run && ["code_run_command"].includes(tool.name)) {
        score += 24;
    }
    if (intent.run && ["code_run_check_suite", "code_install_dependencies"].includes(tool.name)) {
        score += 18;
    }
    if (intent.git && ["code_git_status", "code_git_diff"].includes(tool.name)) {
        score += 24;
    }
    if (intent.external && tool.name === "code_web_search") {
        score += 28;
    }
    if (intent.web && ["code_write_file"].includes(tool.name)) {
        score += 10;
    }

    if (tool.name === "code_create_single_page_site") {
        if (isSinglePageWebPrompt(query)) {
            score += 16;
        } else {
            score -= 18;
        }
    }

    if (tool.name === "code_web_search" && !intent.external) {
        score -= 20;
    }

    if (tool.category === "data-bearing" && !intent.create && !intent.edit) {
        score += 4;
    }

    return score;
}

function uniqueTools(tools) {
    const seen = new Set();
    const output = [];

    for (const tool of tools) {
        if (!tool || seen.has(tool.name)) {
            continue;
        }
        seen.add(tool.name);
        output.push(tool);
    }

    return output;
}

function setFrom(values) {
    return Array.isArray(values) ? new Set(values) : new Set();
}

function tryConsumeSingleStepGrant(context, toolKind) {
    if (!context?.settings?.approvalGrant) {
        return false;
    }

    if (toolKind === "read" || toolKind === "review" || toolKind === "research") {
        return false;
    }

    const grant = context.settings.approvalGrant;
    if (
        grant.mode === "single_step" &&
        Number.isInteger(grant.remainingActionSteps) &&
        grant.remainingActionSteps > 0
    ) {
        grant.remainingActionSteps -= 1;
        return true;
    }

    return false;
}

function isPackageMutationCommand(command) {
    return /\b(?:npm|pnpm|yarn|bun|pip|cargo|go)\b.+\b(?:install|add|update|upgrade|remove|uninstall)\b/i.test(
        String(command || "")
    );
}

function normalizeCommand(command) {
    return String(command || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function isSafeProjectVerifyCommand(command, context) {
    const normalized = normalizeCommand(command);
    if (!normalized) {
        return false;
    }

    const executionContract = context?.executionContract || {};
    const verifyCommands = Array.isArray(executionContract.verifyCommands)
        ? executionContract.verifyCommands
        : [];

    if (verifyCommands.some((candidate) => normalizeCommand(candidate) === normalized)) {
        return true;
    }

    return /^\s*(?:npm|pnpm|yarn|bun)\s+run\s+(?:check|lint|test|build|verify|typecheck)\b/i.test(command);
}

function shouldRequireCommandApproval(command, context) {
    if (context.settings?.fullAccess) {
        return false;
    }

    if (isSafeProjectVerifyCommand(command, context)) {
        return false;
    }

    return isDangerousCommand(command) || isPackageMutationCommand(command);
}

export class CodeToolRegistry {
    constructor(tools, hooks = {}) {
        this.tools = new Map();
        this.hooks = hooks;
        this.activeProfiles = new Map();
        this.executionContracts = new Map();
        this.policy = { 
            allowWebSearch: true,
            requireApproval: new Set([
                "code_delete_path",
                "code_install_dependencies"
            ])
        };

        for (const definition of tools) {
            this.tools.set(definition.tool.name, definition);
        }
    }

    get count() {
        return this.tools.size;
    }

    getToolIndex() {
        return null;
    }

    getToolCategory(name) {
        return this.tools.get(name)?.tool.category;
    }

    getToolModule(name) {
        return getCodeAgentToolModule(name);
    }

    getAvailableModules(chatId) {
        const visibleTools = this.getAll(chatId);
        const modules = new Set(
            visibleTools.map((tool) => this.getToolModule(tool.name)).filter(Boolean)
        );
        return Array.from(modules).sort();
    }

    getModuleToolCount(moduleName, chatId) {
        return this.getModuleTools(moduleName, chatId).length;
    }

    getModuleTools(moduleName, chatId) {
        return this.getAll(chatId)
            .filter((tool) => this.getToolModule(tool.name) === moduleName)
            .map((tool) => ({
                name: tool.name,
                category: tool.category
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    getProfile(chatId) {
        if (!chatId) {
            return null;
        }
        return this.activeProfiles.get(chatId) || null;
    }

    setChatProfile(chatId, profile) {
        if (!chatId || !profile) {
            return;
        }
        this.activeProfiles.set(chatId, profile);
    }

    clearChatProfile(chatId) {
        if (!chatId) {
            return;
        }
        this.activeProfiles.delete(chatId);
    }

    getChatExecutionContract(chatId) {
        if (!chatId) {
            return null;
        }
        return this.executionContracts.get(chatId) || null;
    }

    setChatExecutionContract(chatId, contract) {
        if (!chatId || !contract) {
            return;
        }
        this.executionContracts.set(chatId, contract);
    }

    clearChatExecutionContract(chatId) {
        if (!chatId) {
            return;
        }
        this.executionContracts.delete(chatId);
    }

    getAll(chatId) {
        return this.filterByPolicy(Array.from(this.tools.values()).map((entry) => entry.tool), chatId);
    }

    isToolEnabled(name, chatId) {
        return this.getAll(chatId).some((tool) => tool.name === name);
    }

    setPolicy(policy = {}) {
        this.policy = {
            allowWebSearch: policy.allowWebSearch !== false,
            requireApproval: policy.requireApproval || this.policy.requireApproval
        };
    }

    filterByPolicy(tools, chatId) {
        const profile = this.getProfile(chatId);
        const allowedTools = profile?.allowedTools ? new Set(profile.allowedTools) : null;
        const blockedTools = profile?.blockedTools ? new Set(profile.blockedTools) : null;
        const allowedModules = profile?.allowedModules ? new Set(profile.allowedModules) : null;
        const blockedModules = profile?.blockedModules ? new Set(profile.blockedModules) : null;
        const allowWebSearch = profile?.allowWebSearch !== false && this.policy.allowWebSearch !== false;

        return tools.filter((tool) => {
            const toolModule = this.getToolModule(tool.name);
            if (!allowWebSearch && tool.name === "code_web_search") {
                return false;
            }
            if (allowedModules && toolModule && !allowedModules.has(toolModule)) {
                return false;
            }
            if (blockedModules && toolModule && blockedModules.has(toolModule)) {
                return false;
            }
            if (allowedTools && !allowedTools.has(tool.name)) {
                return false;
            }
            if (blockedTools && blockedTools.has(tool.name)) {
                return false;
            }
            return true;
        });
    }

    applyLimit(tools, toolLimit) {
        if (toolLimit === null || toolLimit === undefined || tools.length <= toolLimit) {
            return tools;
        }
        return tools.slice(0, toolLimit);
    }

    getForContext(_isGroup, toolLimit, chatId) {
        const tools = this.getAll(chatId);
        return this.applyLimit(tools, toolLimit);
    }

    selectToolsForQuery(query, chatId) {
        const allTools = this.getAll(chatId);
        const prioritized = [];
        const remaining = [];

        for (const tool of allTools) {
            if (ALWAYS_INCLUDE.has(tool.name)) {
                prioritized.push(tool);
            } else {
                remaining.push(tool);
            }
        }

        return uniqueTools([...prioritized, ...remaining]);
    }

    async getForContextWithRAG(query, _queryEmbedding, isGroup, toolLimit, chatId) {
        const selected = this.selectToolsForQuery(query, chatId);
        if (selected.length === 0) {
            return this.getForContext(isGroup, toolLimit, chatId);
        }
        return this.applyLimit(selected, toolLimit);
    }

    describeCapabilities(chatId) {
        const tools = this.getAll(chatId);
        const moduleEntries = listCodeAgentModules().map((entry) => ({
            name: entry.label,
            description: entry.description,
            tools: tools
                .filter((tool) => this.getToolModule(tool.name) === entry.label)
                .map((tool) => tool.name)
        }));
        return {
            totalTools: tools.length,
            modules: moduleEntries.filter((entry) => entry.tools.length > 0),
            actionTools: tools.filter((tool) => tool.category === "action").map((tool) => tool.name),
            dataTools: tools.filter((tool) => tool.category === "data-bearing").map((tool) => tool.name)
        };
    }

    shouldRequireApproval(toolName, context, profile) {
        const toolKind = getCodeAgentToolKind(toolName) || "write";
        const approvalScope = getCodeAgentApprovalScope(toolName);
        const alwaysRequireApprovalKinds = setFrom(
            profile?.approvalPolicy?.alwaysRequireApprovalForKinds
        );
        const restrictedApprovalKinds = setFrom(
            profile?.approvalPolicy?.requireOwnerApprovalForKinds
        );

        if (alwaysRequireApprovalKinds.has(toolKind)) {
            return {
                required: !context.approved,
                scope: approvalScope
            };
        }

        if (tryConsumeSingleStepGrant(context, toolKind)) {
            return {
                required: false,
                scope: approvalScope
            };
        }

        const requiresExecutionApproval = profile?.approvalPolicy?.requireOwnerApprovalForExecution;
        if (requiresExecutionApproval && restrictedApprovalKinds.has(toolKind) && !context.approved) {
            return {
                required: true,
                scope: approvalScope
            };
        }

        if (toolName === "code_run_command") {
            const command =
                context?.toolCall?.arguments?.command ||
                context?.toolCall?.params?.command ||
                context?.command ||
                "";
            return {
                required: !context.approved && shouldRequireCommandApproval(command, context),
                scope: approvalScope
            };
        }

        if (toolName === "code_install_dependencies") {
            return {
                required: !context.settings?.fullAccess && !context.approved,
                scope: approvalScope
            };
        }

        if (this.policy.requireApproval.has(toolName) && !context.settings?.fullAccess && !context.approved) {
            return {
                required: true,
                scope: approvalScope
            };
        }

        return {
            required: false,
            scope: approvalScope
        };
    }

    getToolDisplayInfo(name, params = {}, context = {}) {
        const path = params.path || params.targetFile || params.TargetFile || params.targetPath || params.target_file || "";
        const filename = path.split(/[\\/]/).pop() || "";
        const command = params.command || "";
        const language = resolveTaskLanguage(context?.prompt, context?.settings || {});

        if (language === "en") {
            const englishInfo = {
                code_read_file: {
                    title: "Reading code",
                    thoughts: [
                        `Reviewing ${filename || "the file"} to understand the current implementation.`,
                        `Opening ${filename || "the file"} to locate the integration points.`,
                        `Inspecting ${filename || "the file"} before making any changes.`,
                        `Reading ${filename || "the file"} to see how the logic is structured.`
                    ]
                },
                code_list_files: {
                    title: "Project overview",
                    thoughts: [
                        "Mapping the project file tree first.",
                        "Reviewing the workspace structure to find the relevant modules.",
                        "Checking what already exists in this workspace."
                    ]
                },
                code_write_file: {
                    title: "Creating file",
                    thoughts: [
                        `Writing ${filename || "a new file"} with the requested implementation.`,
                        `Creating ${filename || "a new file"} and laying down the main logic.`,
                        `Adding ${filename || "a new file"} based on the current plan.`,
                        `Building out ${filename || "a new module"} with the required pieces.`
                    ]
                },
                code_patch_file: {
                    title: "Updating code",
                    thoughts: [
                        `Applying a targeted change to ${filename || "the file"}.`,
                        `Adjusting the implementation in ${filename || "the file"}.`,
                        `Patching ${filename || "the file"} to resolve the current issue.`,
                        `Updating specific sections in ${filename || "the file"}.`
                    ]
                },
                code_run_command: {
                    title: "Running command",
                    thoughts: [
                        `Running \`${command}\` to validate the project state.`,
                        `Executing \`${command}\` in the workspace terminal.`,
                        `Checking the project by running \`${command}\`.`
                    ]
                },
                code_inspect_project: {
                    title: "Project analysis",
                    thoughts: [
                        "Running a deeper audit of the codebase.",
                        "Inspecting how the main pieces of the project fit together.",
                        "Scanning the project for architectural clues and likely issues."
                    ]
                },
                code_search_context: {
                    title: "Searching context",
                    thoughts: [
                        "Searching the codebase for related symbols and references.",
                        "Looking for similar implementation patterns elsewhere in the project.",
                        "Gathering context on how this module is used."
                    ]
                }
            };

            const toolInfo = englishInfo[name] || {
                title: name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
                thoughts: [`Executing ${filename || name} for the current task.`]
            };

            return {
                title: toolInfo.title,
                thought: toolInfo.thoughts[Math.floor(Math.random() * toolInfo.thoughts.length)]
            };
        }
        
        const info = {
            code_read_file: { 
                title: "Изучение кода", 
                thoughts: [
                    `Анализирую содержимое ${filename || 'файла'} для понимания текущей логики.`,
                    `Читаю ${filename}, чтобы найти точки интеграции.`,
                    `Внимательно изучаю ${filename}, разбираюсь в реализации.`,
                    `Проверяю структуру ${filename} перед внесением изменений.`
                ]
            },
            code_list_files: { 
                title: "Обзор проекта", 
                thoughts: [
                    "Выстраиваю карту файлов проекта.",
                    "Изучаю структуру директорий для поиска нужных модулей.",
                    "Смотрю, какие файлы уже созданы в пространстве."
                ]
            },
            code_write_file: { 
                title: "Создание файла", 
                thoughts: [
                    `Проектирую и создаю ${filename}. Реализую задуманный функционал.`,
                    `Записываю основную логику в ${filename}.`,
                    `Формирую содержимое ${filename} согласно архитектурному плану.`,
                    `Создаю новый модуль ${filename} с необходимыми компонентами.`
                ]
            },
            code_patch_file: { 
                title: "Правка кода", 
                thoughts: [
                    `Вношу точечные исправления в ${filename}.`,
                    `Оптимизирую логику в ${filename}.`,
                    `Корректирую реализацию в ${filename} для устранения проблемы.`,
                    `Обновляю специфические участки кода в ${filename}.`
                ]
            },
            code_run_command: { 
                title: "Команда", 
                thoughts: [
                    `Запускаю \`${command}\` для проверки проекта.`,
                    `Выполняю \`${command}\` в терминале для сборки или тестов.`,
                    `Проверяю состояние систем через \`${command}\`.`
                ]
            },
            code_inspect_project: {
                title: "Анализ проекта",
                thoughts: [
                    "Провожу глубокий аудит кодовой базы.",
                    "Изучаю взаимосвязи между компонентами системы.",
                    "Сканирую проект на предмет потенциальных проблем и архитектурных решений."
                ]
            },
            code_search_context: {
                title: "Поиск контекста",
                thoughts: [
                    "Ищу в коде упоминания связанных функций и переменных.",
                    "Пытаюсь найти похожие паттерны реализации в других частях проекта.",
                    "Собираю данные о том, как данный модуль используется в системе."
                ]
            }
        };

        const toolInfo = info[name] || { 
            title: name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), 
            thoughts: [`Выполняю операцию ${filename || name} для реализации текущего этапа задачи.`] 
        };

        return {
            title: toolInfo.title,
            thought: toolInfo.thoughts[Math.floor(Math.random() * toolInfo.thoughts.length)]
        };
    }

    async execute(toolCall, context) {
        const definition = this.tools.get(toolCall.name);

        if (!definition) {
            return {
                success: false,
                error: `Unknown tool: ${toolCall.name}`
            };
        }

        const profile = this.getProfile(context.chatId);
        const toolModule = this.getToolModule(toolCall.name);
        if (profile?.allowedModules && toolModule && !profile.allowedModules.includes(toolModule)) {
            return {
                success: false,
                error: `Tool '${toolCall.name}' is not enabled for module '${toolModule}' in profile '${profile.id || "default"}'.`
            };
        }
        if (profile?.blockedModules && toolModule && profile.blockedModules.includes(toolModule)) {
            return {
                success: false,
                error: `Tool '${toolCall.name}' is blocked for module '${toolModule}' in profile '${profile.id || "default"}'.`
            };
        }
        if (profile?.allowedTools && !profile.allowedTools.includes(toolCall.name)) {
            return {
                success: false,
                error: `Tool '${toolCall.name}' is not enabled for profile '${profile.id || "default"}'.`
            };
        }
        if (profile?.blockedTools && profile.blockedTools.includes(toolCall.name)) {
            return {
                success: false,
                error: `Tool '${toolCall.name}' is blocked for profile '${profile.id || "default"}'.`
            };
        }

        const params = toolCall.arguments || {};
        const displayInfo = this.getToolDisplayInfo(toolCall.name, params, context);
        const executionContext = {
            ...context,
            toolCall,
            command: params.command,
            executionContract:
                context?.executionContract ||
                this.getChatExecutionContract(context?.chatId) ||
                null
        };
        const approval = this.shouldRequireApproval(toolCall.name, executionContext, profile);
        if (approval.required) {
            const result = {
                success: false,
                error: `Permission denied: Tool '${toolCall.name}' requires explicit user approval.`,
                requiresPermission: true,
                toolCallId: toolCall.id,
                approvalScope: approval.scope
            };
            await this.hooks.onToolFinish?.({
                name: toolCall.name,
                params,
                toolCallId: toolCall.id,
                result,
                status: "waiting",
                title: displayInfo.title,
                thought: displayInfo.thought,
                durationMs: 0,
                chatId: context.chatId
            });
            return result;
        }
        const startedAt = Date.now();

        await this.hooks.onToolStart?.({
            name: toolCall.name,
            params,
            toolCallId: toolCall.id,
            title: displayInfo.title,
            thought: displayInfo.thought,
            chatId: context.chatId
        });

        try {
            const result = await definition.executor(params, executionContext);
            await this.hooks.onToolFinish?.({
                name: toolCall.name,
                params,
                toolCallId: toolCall.id,
                result,
                status: result.success ? "success" : "failed",
                title: displayInfo.title,
                thought: displayInfo.thought,
                durationMs: Date.now() - startedAt,
                chatId: context.chatId
            });
            return result;
        } catch (error) {
            const result = {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
            await this.hooks.onToolFinish?.({
                name: toolCall.name,
                params,
                toolCallId: toolCall.id,
                result,
                status: "failed",
                title: displayInfo.title,
                thought: displayInfo.thought,
                durationMs: Date.now() - startedAt,
                chatId: context.chatId
            });
            return result;
        }
    }
}
