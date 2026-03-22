import { json, notFound } from "../lib/http-utils.js";
import { runPowerShell } from "../lib/workspace-utils.js";

export function handleGitStatus(workspaceId, stateStore, config, response) {
    const workspace = stateStore.getWorkspace(workspaceId);
    if (!workspace) return notFound(response, "Workspace not found");

    runPowerShell(
        "git status --short --branch",
        workspace.path,
        config.runtime.maxShellTimeoutMs,
        config.runtime.maxShellOutputChars
    )
        .then((result) => {
            json(response, 200, {
                success: true,
                data: {
                    workspace: workspace.name,
                    success: result.exitCode === 0,
                    stdout: result.stdout,
                    stderr: result.stderr
                }
            });
        })
        .catch((error) => {
            json(response, 500, {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        });
}

export function handleGitDiff(workspaceId, stateStore, config, query, response) {
    const workspace = stateStore.getWorkspace(workspaceId);
    if (!workspace) return notFound(response, "Workspace not found");

    const filePath = query.get("path");
    const fileArg = filePath ? ` -- "${filePath.replace(/"/g, '\\"')}"` : "";
    const command = filePath ? `git diff${fileArg}` : "git diff --stat";
    
    runPowerShell(
        command,
        workspace.path,
        config.runtime.maxShellTimeoutMs,
        1_000_000 // DIFF_LIMIT
    )
        .then((result) => {
            json(response, 200, {
                success: true,
                data: {
                    workspace: workspace.name,
                    success: result.exitCode === 0,
                    stdout: result.stdout,
                    stderr: result.stderr
                }
            });
        })
        .catch((error) => {
            json(response, 500, {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        });
}
