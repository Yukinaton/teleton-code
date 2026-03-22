const DEFAULT_CODE_AGENT_OUTPUT_LIMIT = 1800;
const MIN_CODE_AGENT_OUTPUT_LIMIT = 128;

function normalizePositiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveCodeAgentOutputTokenLimit(config, override = null) {
    const configured = normalizePositiveInteger(config?.agent?.max_tokens);
    const requestedOverride = normalizePositiveInteger(override);
    const effectiveBase = requestedOverride || configured || DEFAULT_CODE_AGENT_OUTPUT_LIMIT;
    return Math.max(
        MIN_CODE_AGENT_OUTPUT_LIMIT,
        Math.min(effectiveBase, DEFAULT_CODE_AGENT_OUTPUT_LIMIT)
    );
}

export function buildCodeAgentRuntimeConfig(config) {
    const outputLimit = resolveCodeAgentOutputTokenLimit(config);
    return {
        config: {
            ...config,
            agent: {
                ...(config?.agent || {}),
                max_tokens: outputLimit
            }
        },
        outputLimit
    };
}

export function clampStructuredChatOptions(options = {}, config) {
    const outputLimit = resolveCodeAgentOutputTokenLimit(config, options?.maxTokens);
    return {
        ...options,
        maxTokens: outputLimit
    };
}

export function parseAffordableTokenLimit(error) {
    const message = String(error instanceof Error ? error.message : error || "");
    const match = message.match(/can only afford\s+(\d+)\s+tokens/i);
    if (!match?.[1]) {
        return null;
    }

    const affordable = normalizePositiveInteger(match[1]);
    if (!affordable) {
        return null;
    }

    return Math.max(MIN_CODE_AGENT_OUTPUT_LIMIT, affordable - 16);
}

export function deriveRetryOutputTokenLimit(currentLimit, error) {
    const current = normalizePositiveInteger(currentLimit);
    const affordable = parseAffordableTokenLimit(error);
    if (!current || !affordable || affordable >= current) {
        return null;
    }

    return Math.max(MIN_CODE_AGENT_OUTPUT_LIMIT, Math.min(affordable, Math.floor(current * 0.75)));
}
