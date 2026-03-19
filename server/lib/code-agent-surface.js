const MODULES = {
    workspace: {
        label: "workspace",
        description: "Inspect project structure, read files, and gather narrow code context."
    },
    review: {
        label: "review",
        description: "Inspect repository state and diffs without changing files."
    },
    editor: {
        label: "editor",
        description: "Create or patch files inside the active project workspace."
    },
    verify: {
        label: "verify",
        description: "Run project validation such as checks, lint, build, or tests."
    },
    shell: {
        label: "shell",
        description: "Run targeted workspace commands when structured tools are not enough."
    },
    research: {
        label: "research",
        description: "Look up external documentation or API references when needed."
    },
    scaffold: {
        label: "scaffold",
        description: "Generate greenfield project shells or simple page bootstrap when explicitly requested."
    },
    destructive: {
        label: "destructive",
        description: "Delete files or folders only when removal is part of the task."
    }
};

const TOOL_SURFACE = {
    code_list_files: { module: "workspace", kind: "read", approvalScope: "read" },
    code_inspect_project: { module: "workspace", kind: "read", approvalScope: "read" },
    code_read_file: { module: "workspace", kind: "read", approvalScope: "read" },
    code_read_files: { module: "workspace", kind: "read", approvalScope: "read" },
    code_search_text: { module: "workspace", kind: "read", approvalScope: "read" },
    code_search_context: { module: "workspace", kind: "read", approvalScope: "read" },
    code_suggest_commands: { module: "workspace", kind: "read", approvalScope: "read" },
    code_git_status: { module: "review", kind: "review", approvalScope: "review" },
    code_git_diff: { module: "review", kind: "review", approvalScope: "review" },
    code_write_json: { module: "editor", kind: "write", approvalScope: "write" },
    code_write_file: { module: "editor", kind: "write", approvalScope: "write" },
    code_write_file_lines: { module: "editor", kind: "write", approvalScope: "write" },
    code_make_dirs: { module: "editor", kind: "write", approvalScope: "write" },
    code_replace_text: { module: "editor", kind: "write", approvalScope: "write" },
    code_patch_file: { module: "editor", kind: "write", approvalScope: "write" },
    code_insert_block: { module: "editor", kind: "write", approvalScope: "write" },
    code_move_path: { module: "editor", kind: "write", approvalScope: "write" },
    code_run_check_suite: { module: "verify", kind: "verify", approvalScope: "verify" },
    code_run_command: { module: "shell", kind: "shell", approvalScope: "shell" },
    code_install_dependencies: { module: "shell", kind: "shell", approvalScope: "shell" },
    code_web_search: { module: "research", kind: "research", approvalScope: "research" },
    code_create_single_page_site: { module: "scaffold", kind: "scaffold", approvalScope: "write" },
    code_delete_path: { module: "destructive", kind: "destructive", approvalScope: "destructive" }
};

const IDE_CODE_MODULES = [
    "workspace",
    "review",
    "editor",
    "verify",
    "shell",
    "research",
    "scaffold",
    "destructive"
];
const READ_ONLY_KINDS = new Set(["read", "review", "research"]);

export function listCodeAgentModules() {
    return Object.values(MODULES);
}

export function getCodeAgentSurface(toolName) {
    return TOOL_SURFACE[toolName] || null;
}

export function getCodeAgentToolModule(toolName) {
    return TOOL_SURFACE[toolName]?.module || null;
}

export function getCodeAgentToolKind(toolName) {
    return TOOL_SURFACE[toolName]?.kind || null;
}

export function getCodeAgentApprovalScope(toolName) {
    return TOOL_SURFACE[toolName]?.approvalScope || TOOL_SURFACE[toolName]?.kind || "write";
}

export function isReadOnlyCodeAgentTool(toolName) {
    return READ_ONLY_KINDS.has(getCodeAgentToolKind(toolName));
}

export function buildCodeAgentSurfacePolicy({ fullAccess = false, consultationOnly = false } = {}) {
    const allowedModules = consultationOnly
        ? ["workspace", "review", "research"]
        : [...IDE_CODE_MODULES];
    const allowedTools = Object.entries(TOOL_SURFACE)
        .filter(([, definition]) => allowedModules.includes(definition.module))
        .map(([name]) => name);
    const blockedModules = IDE_CODE_MODULES.filter((moduleName) => !allowedModules.includes(moduleName));

    return {
        allowedModules,
        blockedModules,
        allowedTools,
        approvalKinds: consultationOnly
            ? []
            : fullAccess
            ? ["destructive"]
            : ["write", "shell", "scaffold", "destructive"],
        alwaysRequireApprovalKinds: ["destructive"]
    };
}

export function describeCodeAgentModules(modules = []) {
    return modules
        .map((name) => MODULES[name])
        .filter(Boolean)
        .map((entry) => `- ${entry.label}: ${entry.description}`)
        .join("\n");
}
