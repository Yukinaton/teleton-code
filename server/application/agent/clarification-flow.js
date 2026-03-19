import { normalizeAgentContent } from "../../lib/format-utils.js";

export async function runClarificationFlow({
    callStructuredChat,
    prompt,
    languageName,
    workspace
}) {
    const projectName = workspace?.name ? String(workspace.name).trim() : "";
    const systemPrompt = `You are Teleton Code, a senior engineering agent inside an IDE.
The owner's request is under-specified.
Ask one concise clarifying question in ${languageName}.
You may offer up to three concrete directions or defaults if that helps.
Do not inspect files.
Do not mention internal paths, workspace roots, tool names, or implementation steps.
Do not claim that you already changed or reviewed anything.
Keep the answer natural, short, and useful.`;
    const userPrompt = `Owner request:
${prompt}

Current project name:
${projectName || "(unknown)"}

Respond in ${languageName}.`;

    const text = await callStructuredChat(systemPrompt, userPrompt, {
        temperature: 0.25,
        maxTokens: languageName === "Russian" ? 450 : 380
    });

    return {
        content: normalizeAgentContent(text),
        toolCalls: []
    };
}
