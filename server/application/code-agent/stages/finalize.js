import { hasUserRelevantProgress } from "../services/evidence.js";
import { assertCanFinalize } from "../transitions.js";

function shouldComplete({ state, failures, verification, content, changedFiles }) {
    if ((failures || []).length > 0) {
        return false;
    }

    if (state?.evidence?.claimMatchesEvidence === false) {
        return false;
    }

    if (state?.evidence?.requiredArtifactsPresent === false) {
        return false;
    }

    if (verification?.status === "failed") {
        return false;
    }

    if (String(state?.mode || "") === "act") {
        return hasUserRelevantProgress({
            mode: state?.mode,
            changedFiles,
            content
        });
    }

    return String(content || "").trim().length > 0;
}

export function decideFinalStatus({
    state,
    content = "",
    changedFiles = [],
    verification = null,
    failures = [],
    forcedStatus = null
} = {}) {
    if (forcedStatus) {
        return forcedStatus;
    }

    if (
        shouldComplete({
            state,
            failures,
            verification,
            content,
            changedFiles
        })
    ) {
        return "completed";
    }

    if (
        hasUserRelevantProgress({
            mode: state?.mode,
            changedFiles,
            content
        })
    ) {
        return "partial";
    }

    return "failed";
}

export function runFinalizeStage({
    state,
    content = "",
    changedFiles = [],
    verification = null,
    failures = [],
    forcedStatus = null
} = {}) {
    const status = decideFinalStatus({
        state,
        content,
        changedFiles,
        verification,
        failures,
        forcedStatus
    });

    assertCanFinalize(state, status);

    return {
        status
    };
}
