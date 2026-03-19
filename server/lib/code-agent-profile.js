import {
    buildCodeAgentSurfacePolicy,
    describeCodeAgentModules,
    getCodeAgentToolModule
} from "./code-agent-surface.js";

function summarizeToolsByModule(toolNames = []) {
    const grouped = new Map();

    for (const toolName of toolNames) {
        const moduleName = getCodeAgentToolModule(toolName) || "other";
        const bucket = grouped.get(moduleName) || [];
        bucket.push(toolName);
        grouped.set(moduleName, bucket);
    }

    return Array.from(grouped.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([moduleName, tools]) => `- ${moduleName}: ${tools.join(", ")}`)
        .join("\n");
}

export function buildCodeAgentProfile(settings = {}) {
    const fullAccess = settings?.fullAccess === true;
    const consultationOnly = settings?.consultationOnly === true;
    const allowWebSearch = settings?.allowWebSearch !== false;
    const mode = consultationOnly ? "consultation" : fullAccess ? "execution" : "approval_required";
    const surfacePolicy = buildCodeAgentSurfacePolicy({ fullAccess, consultationOnly });
    const moduleSummary = describeCodeAgentModules(surfacePolicy.allowedModules);
    const toolSummary = summarizeToolsByModule(surfacePolicy.allowedTools);

    return {
        id: "teleton-code",
        mode,
        allowWebSearch,
        allowedModules: surfacePolicy.allowedModules,
        blockedModules: surfacePolicy.blockedModules,
        allowedTools: surfacePolicy.allowedTools,
        contextPolicy: {
            useTeletonSoul: true,
            useTeletonIdentity: true,
            useTeletonSecurity: false,
            useTeletonUser: false,
            useTeletonMemory: false,
            useTeletonStrategy: false,
            useIdeAgentDocs: true,
            useProjectContext: true,
            useChatContext: true,
            isolateFromTeletonMemory: true
        },
        behaviorPolicy: {
            defaultMode: "auto",
            supportedModes: ["consult", "inspect", "execute", "review", "recover"],
            actWhenRequestIsClear: true,
            inspectBeforeEditing: true,
            reviewFindingsFirst: true,
            avoidFalseClaims: true
        },
        approvalPolicy: {
            requireOwnerApprovalForExecution: !fullAccess,
            requireOwnerApprovalForKinds: surfacePolicy.approvalKinds,
            alwaysRequireApprovalForKinds: surfacePolicy.alwaysRequireApprovalKinds
        },
        promptGuidance: fullAccess
            ? `CODE MODE PROFILE: execution.
Enabled capability modules:
${moduleSummary}
Exact available tools by module:
${toolSummary}
Use the narrow coding surface directly inside the active project workspace. Read first, edit intentionally, then verify.
Never invent tool names. Use only the exact tool names listed above.`
            : consultationOnly
                ? `CODE MODE PROFILE: consultation.
Enabled capability modules:
${moduleSummary}
Exact available tools by module:
${toolSummary}
This request is consultation-only. Stay in guidance, inspection, architecture, or review mode.
Do not modify files, do not run execution commands, and do not claim implementation work.
Never invent tool names. Use only the exact tool names listed above.`
            : `CODE MODE PROFILE: approval_required.
Enabled capability modules:
${moduleSummary}
Exact available tools by module:
${toolSummary}
Action tools are visible but require owner approval before execution.
${allowWebSearch ? "" : "External web search is disabled because Teleton Agent web search is not configured.\n"}
If the owner asks for explanation, options, tradeoffs, or explicitly says not to modify files, answer directly and do not call action tools.
Never invent tool names. Use only the exact tool names listed above.`
    };
}
