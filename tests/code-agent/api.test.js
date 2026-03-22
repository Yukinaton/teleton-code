import test from "node:test";
import assert from "node:assert/strict";
import {
    processCodeTurn,
    resumeCodeTurn,
    createCodeAgentTurnController,
    canResumeFromApproval
} from "../../server/application/code-agent/index.js";

test("code-agent public api exports turn entrypoints", () => {
    assert.equal(typeof processCodeTurn, "function");
    assert.equal(typeof resumeCodeTurn, "function");
    assert.equal(typeof createCodeAgentTurnController, "function");
    assert.equal(typeof canResumeFromApproval, "function");
});
