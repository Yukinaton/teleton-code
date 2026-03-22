import { getCodeAgentApprovalScope, getCodeAgentToolKind, getCodeAgentToolModule } from "../../lib/code-agent-surface.js";
import { COMPATIBILITY_TASK_ENGINE } from "./task-engine.js";

function normalizeVerifyCommand(command) {
    return String(command || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function summarizeAction(event) {
    if (event?.title) {
        const title = String(event.title).trim();
        if (title && title.length <= 96) {
            return title;
        }
    }

    const params = event?.params || {};
    const path = params.path || params.targetPath || params.targetFile || params.file || "";
    if (path) {
        return String(path).split(/[\\/]/).pop() || String(path).trim();
    }

    if (params.command) {
        return String(params.command).trim();
    }

    if (event?.thought) {
        const thought = String(event.thought).trim();
        if (thought && thought.length <= 120) {
            return thought;
        }
    }
    return null;
}

function coerceApprovalScope(scope) {
    return ["shell", "destructive"].includes(String(scope || "")) ? String(scope) : null;
}

function inferModeFromEvent(task, event) {
    const kind = getCodeAgentToolKind(event?.name);
    const moduleName = getCodeAgentToolModule(event?.name);
    if (moduleName === "review") {
        return "review";
    }
    if (kind === "read" || kind === "review" || kind === "research") {
        return task?.mode && task.mode !== "answer" ? task.mode : "inspect";
    }
    if (kind === "verify") {
        return "execute";
    }
    if (kind === "write" || kind === "shell" || kind === "destructive") {
        return "execute";
    }
    return task?.mode || null;
}

function inferPhaseFromEvent(task, event, verifyCommands = []) {
    const kind = getCodeAgentToolKind(event?.name);
    if (event?.type === "tool_finished" && event?.result?.requiresPermission === true) {
        return "awaiting_approval";
    }
    if (event?.type === "tool_started") {
        if (kind === "read" || kind === "review" || kind === "research") {
            return "inspecting";
        }
        if (kind === "verify") {
            return "verifying";
        }
        if (kind === "shell") {
            const command = normalizeVerifyCommand(
                event?.params?.command || event?.result?.command || ""
            );
            if (verifyCommands.some((candidate) => normalizeVerifyCommand(candidate) === command)) {
                return "verifying";
            }
            return "editing";
        }
        if (kind === "write" || kind === "destructive") {
            return "editing";
        }
    }

    if (event?.type === "tool_finished" && event?.result?.success === false) {
        const command = normalizeVerifyCommand(
            event?.params?.command || event?.result?.data?.command || event?.result?.command || ""
        );
        if (
            kind === "verify" ||
            verifyCommands.some((candidate) => normalizeVerifyCommand(candidate) === command)
        ) {
            return "verifying";
        }
        if (kind === "read" || kind === "review" || kind === "research") {
            return "inspecting";
        }
        return "editing";
    }

    if (event?.type === "tool_finished" && event?.result?.success === true) {
        if (kind === "read" || kind === "review" || kind === "research") {
            return "inspecting";
        }
        if (kind === "verify") {
            return "verifying";
        }
        if (kind === "shell") {
            const command = normalizeVerifyCommand(
                event?.params?.command || event?.result?.data?.command || event?.result?.command || ""
            );
            if (verifyCommands.some((candidate) => normalizeVerifyCommand(candidate) === command)) {
                return "verifying";
            }
        }
        if (kind === "write" || kind === "shell" || kind === "destructive") {
            return "editing";
        }
        return task?.phase || "idle";
    }

    return task?.phase || "idle";
}

function inferEvidenceState(task, event, verifyCommands = []) {
    const kind = getCodeAgentToolKind(event?.name);
    if (event?.type === "tool_finished" && event?.result?.requiresPermission === true) {
        return task?.evidenceState || "none";
    }
    if (event?.type === "tool_finished" && event?.result?.success === true) {
        if (kind === "write") {
            return "tool_confirmed";
        }
        if (kind === "verify") {
            return "verify_passed";
        }
        if (kind === "shell") {
            const command = normalizeVerifyCommand(
                event?.params?.command || event?.result?.data?.command || event?.result?.command || ""
            );
            if (verifyCommands.some((candidate) => normalizeVerifyCommand(candidate) === command)) {
                return "verify_passed";
            }
        }
    }
    if (event?.type === "tool_finished" && event?.result?.success === false) {
        if (kind === "verify") {
            return "verify_failed";
        }
        if (kind === "shell") {
            const command = normalizeVerifyCommand(
                event?.params?.command || event?.result?.data?.command || event?.result?.command || ""
            );
            if (verifyCommands.some((candidate) => normalizeVerifyCommand(candidate) === command)) {
                return "verify_failed";
            }
        }
        if (kind === "write" || kind === "shell" || kind === "destructive") {
            return "claim_mismatch";
        }
    }
    return task?.evidenceState || "none";
}

export function buildCompatibilityTaskPatchFromEvent(task, event, executionContract = {}) {
    const verifyCommands = executionContract?.verifyCommands || [];
    const patch = {
        mode: inferModeFromEvent(task, event) || task?.mode || "execute",
        phase: inferPhaseFromEvent(task, event, verifyCommands),
        currentAction: summarizeAction(event) || task?.currentAction || null,
        evidenceState: inferEvidenceState(task, event, verifyCommands),
        approvalScope: event?.result?.requiresPermission === true
            ? coerceApprovalScope(event?.result?.approvalScope || getCodeAgentApprovalScope(event?.name))
            : coerceApprovalScope(task?.approvalScope)
    };

    if (patch.evidenceState === "verify_failed") {
        patch.mode = "recover";
        patch.phase = "verifying";
    }

    if (patch.phase === "awaiting_approval") {
        patch.mode = task?.mode || "execute";
    }

    return patch;
}

export function buildCompatibilityCompletionPatch(task, result) {
    return {
        taskEngine: COMPATIBILITY_TASK_ENGINE,
        mode: result?.mode || task?.mode || "answer",
        phase: result?.phase || (task?.status === "failed" ? "failed" : "completed"),
        currentAction: null,
        resultSummary: result?.resultSummary || null,
        approvalScope: coerceApprovalScope(result?.approvalScope),
        evidenceState: result?.evidenceState || task?.evidenceState || "none",
        verify: result?.verify || null
    };
}
