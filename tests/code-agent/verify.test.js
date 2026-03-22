import test from "node:test";
import assert from "node:assert/strict";
import { normalizeValidationProblems } from "../../server/application/code-agent/stages/verify.js";

test("verify normalizes legacy validation results into a flat problem array", () => {
    assert.deepEqual(
        normalizeValidationProblems({
            writtenPaths: ["hello.txt"],
            problems: ["hello.txt: invalid content"]
        }),
        ["hello.txt: invalid content"]
    );

    assert.deepEqual(normalizeValidationProblems(["problem-a", "", null]), ["problem-a"]);
    assert.deepEqual(normalizeValidationProblems(null), []);
});
