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
    const loopVersion = Number.isInteger(settings?.loopVersion) ? settings.loopVersion : 1;
    const isStructuredLoop = loopVersion >= 3;
    const mode = consultationOnly ? "consultation" : fullAccess ? "execution" : "approval_required";
    const surfacePolicy = buildCodeAgentSurfacePolicy({ fullAccess, consultationOnly, loopVersion });
    const moduleSummary = describeCodeAgentModules(surfacePolicy.allowedModules);
    const toolSummary = summarizeToolsByModule(surfacePolicy.allowedTools);
    const promptGuidance = isStructuredLoop
        ? `CODE MODE PROFILE: operational.
Enabled capability modules:
${moduleSummary}
Exact available tools by module:
${toolSummary}
Use the active project workspace and the exact tool surface above.
Do not claim edits, checks, completion, or artifacts without tool evidence.
Keep scope minimal and coherent with the owner's request.
Treat approval and verification as runtime constraints.
Never invent tools, hidden workflows, or extra task categories.`
        : fullAccess
            ? `CODE MODE PROFILE: execution.
Enabled capability modules:
${moduleSummary}
Exact available tools by module:
${toolSummary}
Use the narrow coding surface directly inside the active project workspace. Read first, edit intentionally, then verify.
For new or fully replaced source files, prefer one raw full-file source write.
Use line-based rewrites only for deliberate narrow repairs.
If a source-file write is rejected, do not repeat the same serialized wrapper. Repair with plain source text or a narrow patch.
Build one coherent implementation path. Do not create parallel variants, backup files, or multiple alternative entrypoints that solve the same role.
Do not start ad hoc local servers or long-running background processes unless the owner explicitly asked for that. Prefer existing preview and verification tools first.
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
Important actions require owner approval before execution. Normal file editing can proceed, but dangerous commands, dependency installs, and destructive changes must be approved.
${allowWebSearch ? "" : "External web search is disabled because Teleton Agent web search is not configured.\n"}
If the owner asks for explanation, options, tradeoffs, or explicitly says not to modify files, answer directly and do not call action tools.
After real file changes, finish only after verification or an explicit not-applicable verification reason.
For new or fully replaced source files, prefer one raw full-file source write.
Use line-based rewrites only for deliberate narrow repairs.
If a source-file write is rejected, do not repeat the same serialized wrapper. Repair with plain source text or a narrow patch.
Build one coherent implementation path. Do not create parallel variants, backup files, or multiple alternative entrypoints that solve the same role.
Do not start ad hoc local servers or long-running background processes unless the owner explicitly asked for that. Prefer existing preview and verification tools first.
Never invent tool names. Use only the exact tool names listed above.`;

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
            useTeletonSecurity: isStructuredLoop,
            useTeletonUser: false,
            useTeletonMemory: false,
            useTeletonStrategy: false,
            useIdeAgentDocs: !isStructuredLoop,
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
        executionContract: {
            loopVersion,
            modelLedLoop: loopVersion >= 2,
            requireEvidenceBeforeFinish: loopVersion >= 2
        },
        promptGuidance
    };
}
