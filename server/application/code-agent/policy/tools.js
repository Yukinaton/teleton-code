import { buildCodeAgentProfile } from "../../../lib/code-agent-profile.js";
import { createDummyBridge } from "../runtime-utils.js";

function buildOperationalPromptGuidance() {
    return [
        "TELETON CODE LOOP CONTRACT:",
        "- Use only the available project tools inside the active workspace.",
        "- Do not claim edits, checks, completion, or artifacts without tool evidence.",
        "- Keep scope minimal and coherent with the owner's request.",
        "- Treat approval and verification as real runtime constraints.",
        "- Never invent tools, hidden workflows, or extra task types."
    ].join("\n");
}

export function createToolsPolicy({ settings = {}, allowWebSearch = false, mode = "act" } = {}) {
    const normalizedMode = String(mode || "act").trim().toLowerCase();
    const consultationOnly = normalizedMode !== "act";
    const codeAgentProfile = buildCodeAgentProfile({
        ...settings,
        consultationOnly,
        allowWebSearch,
        loopVersion: 3
    });

    return {
        codeAgentProfile: {
            ...codeAgentProfile,
            id: "teleton-code",
            promptGuidance: buildOperationalPromptGuidance()
        }
    };
}

export function buildToolContext({ adapter, settings = {}, codeAgentProfile }) {
    return {
        bridge: createDummyBridge(),
        db: adapter.db,
        config: adapter.teletonConfig,
        settings,
        codeAgentProfile
    };
}
