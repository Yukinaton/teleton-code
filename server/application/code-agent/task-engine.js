export const STANDARD_TASK_ENGINE = "standard";
export const COMPATIBILITY_TASK_ENGINE = "compatibility";

function normalizeTaskEngineValue(value) {
    if (value === STANDARD_TASK_ENGINE || value === COMPATIBILITY_TASK_ENGINE) {
        return value;
    }

    return null;
}

export function taskEngineFromVersion(agentLoopVersion) {
    if (!Number.isInteger(agentLoopVersion)) {
        return null;
    }

    return agentLoopVersion >= 3 ? STANDARD_TASK_ENGINE : COMPATIBILITY_TASK_ENGINE;
}

export function resolveTaskEngine(source, fallback = STANDARD_TASK_ENGINE) {
    const explicitEngine = normalizeTaskEngineValue(source?.taskEngine);
    if (explicitEngine) {
        return explicitEngine;
    }

    return taskEngineFromVersion(source?.agentLoopVersion) || fallback;
}

export function isStandardTaskEngine(source) {
    return resolveTaskEngine(source) === STANDARD_TASK_ENGINE;
}

export function isCompatibilityTaskEngine(source) {
    return resolveTaskEngine(source) === COMPATIBILITY_TASK_ENGINE;
}
