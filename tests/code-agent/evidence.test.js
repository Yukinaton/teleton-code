import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    buildEvidence,
    extractExplicitRequestedPaths,
    hasUserRelevantProgress
} from "../../server/application/code-agent/services/evidence.js";

test("evidence marks required artifacts only when applicable", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "teleton-code-agent-evidence-"));
    try {
        writeFileSync(join(workspaceRoot, "README.md"), "# ok\n", "utf-8");

        const evidence = buildEvidence({
            mode: "act",
            toolCalls: [
                {
                    name: "code_write_file",
                    input: { path: "README.md" }
                }
            ],
            workspace: { path: workspaceRoot },
            requestedFiles: ["README.md"],
            verification: { status: "passed" },
            verificationMode: "required",
            claimMatchesEvidence: true
        });

        assert.equal(evidence.writesConfirmed, true);
        assert.equal(evidence.requiredArtifactsPresent, true);
        assert.equal(evidence.checksPassed, true);
    } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
    }
});

test("answer-mode turns treat text as progress", () => {
    assert.equal(hasUserRelevantProgress({ mode: "answer", content: "Here is the explanation." }), true);
    assert.equal(hasUserRelevantProgress({ mode: "act", changedFiles: [] }), false);
});

test("requested paths are extracted only from explicit file-like references", () => {
    const paths = extractExplicitRequestedPaths(
        'Update `src/app.js`, keep "README.md", and ignore https://example.com plus plain words.'
    );

    assert.deepEqual(paths, ["src/app.js", "README.md"]);
});
