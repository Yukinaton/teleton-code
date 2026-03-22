import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    captureBaselineWorkspaceState,
    detectScopeIssues
} from "../../server/application/code-agent/services/scope.js";

test("baseline workspace truth captures top-level manifests", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "teleton-code-agent-scope-"));
    try {
        writeFileSync(join(workspaceRoot, "package.json"), "{}\n", "utf-8");
        writeFileSync(join(workspaceRoot, "README.md"), "# test\n", "utf-8");

        const baseline = captureBaselineWorkspaceState({ path: workspaceRoot });
        assert.equal(baseline.exists, true);
        assert.deepEqual(baseline.dependencyManifests, ["package.json"]);
    } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
    }
});

test("scope flags manifest edits without elevated mode", () => {
    const issues = detectScopeIssues({
        workspace: { path: process.cwd() },
        changedFiles: ["package.json"],
        settings: { fullAccess: false }
    });

    assert.equal(issues.length > 0, true);
});
