import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
    console.log("Usage: node scripts/agent-metrics.mjs <state-or-tasks-json>");
}

function readJson(filePath) {
    return JSON.parse(readFileSync(resolve(filePath), "utf-8"));
}

function toTasks(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.tasks)) {
        return payload.tasks;
    }
    throw new Error("Input file must be a task array or an object containing a tasks array.");
}

function hasWriteActivity(task) {
    return (task?.steps || []).some((step) =>
        [
            "code_write_file",
            "code_write_file_lines",
            "code_write_json",
            "code_replace_text",
            "code_patch_file",
            "code_insert_block",
            "code_make_dirs",
            "code_move_path",
            "code_delete_path"
        ].includes(step?.name)
    );
}

function hadApprovalBarrier(task) {
    return (
        task?.status === "awaiting_approval" ||
        (task?.steps || []).some((step) => step?.result?.requiresPermission === true)
    );
}

function isUnnecessaryApproval(task) {
    if (!hadApprovalBarrier(task)) {
        return false;
    }
    return !["shell", "destructive"].includes(String(task?.approvalScope || ""));
}

function isFalseCompletion(task) {
    return (
        task?.status === "completed" &&
        ["claim_mismatch", "verify_failed"].includes(String(task?.evidenceState || ""))
    );
}

function hasVerifyEvidence(task) {
    return Boolean(task?.verify) || ["verify_passed", "verify_failed"].includes(String(task?.evidenceState || ""));
}

function turnsToFirstUsefulAction(task) {
    const steps = Array.isArray(task?.steps) ? task.steps : [];
    let turns = 0;

    for (const step of steps) {
        if (step?.type !== "tool_finished") {
            continue;
        }
        turns += 1;
        if (step?.result?.success === true || step?.result?.requiresPermission === true) {
            return turns;
        }
    }

    return null;
}

function median(numbers = []) {
    if (numbers.length === 0) {
        return null;
    }
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
}

function percentage(part, total) {
    if (!total) {
        return 0;
    }
    return Number(((part / total) * 100).toFixed(2));
}

function main() {
    const input = process.argv[2];
    if (!input) {
        usage();
        process.exit(1);
    }

    const tasks = toTasks(readJson(input)).filter((task) => {
        const taskEngine = String(task?.taskEngine || "").toLowerCase();
        if (taskEngine === "standard" || taskEngine === "compatibility") {
            return true;
        }
        return (task?.agentLoopVersion || 1) >= 2;
    });
    const writes = tasks.filter(hasWriteActivity);
    const approvals = tasks.filter(hadApprovalBarrier);
    const mismatches = tasks.filter((task) => task?.evidenceState === "claim_mismatch");
    const completed = tasks.filter((task) => task?.status === "completed");
    const failed = tasks.filter((task) => task?.status === "failed");
    const falseCompletions = completed.filter(isFalseCompletion);
    const writesWithVerify = writes.filter(hasVerifyEvidence);
    const usefulTurns = tasks
        .map(turnsToFirstUsefulAction)
        .filter((value) => Number.isFinite(value));

    const report = {
        totalTasks: tasks.length,
        approvalTasks: approvals.length,
        unnecessaryApprovalRate: percentage(approvals.filter(isUnnecessaryApproval).length, approvals.length),
        falseCompletionRate: percentage(falseCompletions.length, completed.length),
        verifyBeforeFinishRateAfterWrites: percentage(writesWithVerify.length, writes.length),
        claimToolMismatchRate: percentage(mismatches.length, tasks.length),
        medianToolTurnsToFirstUsefulAction: median(usefulTurns),
        honestFailRate: percentage(failed.length, tasks.length),
        silentBadSuccessRate: percentage(falseCompletions.length, tasks.length)
    };

    console.log(JSON.stringify(report, null, 2));
}

main();
