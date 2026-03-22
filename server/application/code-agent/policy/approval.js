export function resolveApprovalRequest(event) {
    if (event?.type !== "tool_finished" || event?.result?.requiresPermission !== true) {
        return null;
    }

    const scope = ["shell", "destructive"].includes(String(event?.result?.approvalScope || ""))
        ? String(event.result.approvalScope)
        : "shell";

    return {
        scope,
        pendingAction: {
            name: event?.name || null,
            params: event?.params || {}
        }
    };
}

export function approvalDecisionToSettings(currentSettings = {}, decision) {
    if (decision === "accept_all") {
        return {
            ...currentSettings,
            fullAccess: true,
            approvalMode: "all",
            approvalGrant: null
        };
    }

    if (decision === "accept") {
        return {
            ...currentSettings,
            fullAccess: false,
            approvalMode: "single_step",
            approvalGrant: {
                mode: "single_step",
                remainingActionSteps: 1
            }
        };
    }

    return {
        ...currentSettings,
        approvalGrant: null
    };
}
