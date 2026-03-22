import { validateWrittenFiles } from "../../../lib/validation-engine.js";
import { hasConfirmedFileWrites, collectChangedFilesFromToolCalls } from "../tool-call-utils.js";
import {
    runVerificationGate as runVerificationGateService,
    reconcileVerificationResult as reconcileVerificationResultService
} from "../verification.js";
import {
    buildEvidence,
    extractExplicitRequestedPaths,
    normalizePath,
    pathExistsInWorkspace
} from "../services/evidence.js";
import { buildFailures } from "../services/failures.js";
import { detectScopeIssues } from "../services/scope.js";

function collectMinimalAlignmentProblems({ mode, prompt, workspace, changedFiles = [] }) {
    if (String(mode || "") !== "act" || !workspace?.path) {
        return [];
    }

    const requestedFiles = extractExplicitRequestedPaths(prompt);
    if (requestedFiles.length === 0) {
        return [];
    }

    const normalizedChangedFiles = changedFiles.map((value) => normalizePath(value)).filter(Boolean);
    const problems = [];

    for (const requestedFile of requestedFiles) {
        const normalizedRequest = normalizePath(requestedFile);
        const touched = normalizedChangedFiles.includes(normalizedRequest);

        if (!touched && !pathExistsInWorkspace(workspace, normalizedRequest)) {
            problems.push(`Requested file missing: ${requestedFile}`);
        }
    }

    return problems;
}

function hasProjectMutations(toolCalls = [], changedFiles = []) {
    if (changedFiles.length > 0 || hasConfirmedFileWrites(toolCalls)) {
        return true;
    }

    return toolCalls.some((toolCall) =>
        ["code_make_dirs", "code_move_path", "code_delete_path", "code_run_check_suite", "code_run_command"].includes(
            toolCall?.name
        )
    );
}

function resolveClaimMatchesEvidence({
    alignmentProblems
}) {
    return !(Array.isArray(alignmentProblems) && alignmentProblems.length > 0);
}

export function normalizeValidationProblems(validationResult) {
    if (Array.isArray(validationResult)) {
        return validationResult.filter(Boolean);
    }

    if (Array.isArray(validationResult?.problems)) {
        return validationResult.problems.filter(Boolean);
    }

    return [];
}

export async function runVerifyStage({
    adapter,
    chatId,
    prompt,
    content,
    settings = {},
    mode = "act",
    workspace = null,
    projectInstructions = { verifyCommands: [], setupCommands: [] },
    toolCalls = [],
    failedToolEvents = [],
    verificationMode = "best_effort",
    approval = {},
    baselineWorkspaceState = null
}) {
    const changedFiles = collectChangedFilesFromToolCalls(toolCalls);
    const writesConfirmed = hasConfirmedFileWrites(toolCalls);
    const projectMutations = hasProjectMutations(toolCalls, changedFiles);

    let verification = {
        status: "not_applicable",
        reason: "No project changes were made.",
        knownCommands: projectInstructions?.verifyCommands || []
    };
    let validationProblems = [];
    let alignmentProblems = [];

    if (workspace?.path && projectMutations) {
        verification = await runVerificationGateService({
            adapter,
            chatId,
            prompt,
            settings,
            projectInstructions,
            combinedToolCalls: toolCalls,
            failedToolEvents
        });

        if (writesConfirmed) {
            validationProblems = normalizeValidationProblems(
                await validateWrittenFiles(workspace, toolCalls, adapter.serviceConfig)
            );
        }

        alignmentProblems = collectMinimalAlignmentProblems({
            mode,
            prompt,
            workspace,
            changedFiles
        });
        verification = reconcileVerificationResultService({
            verification,
            validationProblems,
            changedFiles
        });
    }

    const scopeIssues = detectScopeIssues({
        workspace,
        changedFiles,
        approval,
        settings,
        baselineWorkspaceState
    });
    const claimMatchesEvidence = resolveClaimMatchesEvidence({
        alignmentProblems
    });
    const evidence = buildEvidence({
        mode,
        toolCalls,
        changedFiles,
        workspace,
        requestedFiles: extractExplicitRequestedPaths(prompt),
        verification,
        verificationMode,
        claimMatchesEvidence
    });
    const failures = buildFailures({
        verification,
        validationProblems,
        alignmentProblems,
        scopeIssues,
        failedToolEvents,
        toolCalls,
        verifyCommands: projectInstructions?.verifyCommands || [],
        approvalActive: approval?.active === true
    });

    return {
        verification,
        validationProblems,
        alignmentProblems,
        scopeIssues,
        evidence,
        failures,
        changedFiles
    };
}
