# Code Agent Bible

This document is the authoritative design note for the Teleton Code agent subsystem.

It exists to keep the agent architecture simple, truthful, and maintainable.
It is not a product spec for one feature and it is not a prompt cookbook.

If future implementation work conflicts with this document, this document wins unless it is intentionally revised.

## Purpose

Teleton Code must expose a real coding agent, not a scripted chatbot.

The agent layer must:

- keep a small, deterministic execution cycle
- let the model decide how to solve the task
- prevent false claims and broken completion states
- keep UI state aligned with runtime state
- avoid task-specific recipes and domain-specific heuristics

The agent layer must not:

- decide solution architecture for the model
- force fixed file layouts for specific task types
- contain special flows for games, sites, bots, landing pages, or similar product shapes
- turn the user into an operator of raw internal repair/debug loops

## Core Principle

The code controls the cycle.
The model controls the solution.

This means:

- code owns transitions, approvals, evidence, verification, repair budget, and final status
- the model owns implementation decisions, file choices, architecture choices, and the actual coding work

## Glossary

- `mode`: the broad nature of the turn, such as `answer`, `inspect`, or `act`
- `stage`: the current internal step of the cycle, such as `grounding`, `execute`, or `verify`
- `status`: the lifecycle state of the turn, such as `running`, `completed`, `partial`, or `failed`
- `approval pause`: a temporary execution pause while a risky action is waiting for owner approval; it is not a normal stage and it is not a final status
- `evidence`: facts derived from tools, workspace state, and verification outputs
- `partial`: a useful, evidence-supported but incomplete result
- `scope expansion`: work that goes beyond the minimally sufficient change for the request

## Design Boundary

### Teleton Agent owns

- the base runtime
- model execution
- tool ecosystem
- Teleton home and shared runtime context

### Teleton Code owns

- IDE workflow
- workspace and chat integration
- coding loop controller
- truth/evidence/verification policy
- approvals and UI projection

Teleton Code is not allowed to replace Teleton Agent with a second hidden agent platform.

## Anti-Goals

The target architecture explicitly avoids these patterns:

- task-specific flows such as "if the owner asked for Tetris, do X"
- special artifact plans for specific product categories
- meta-tools like `finish_task`, `repair_task`, `ground_request`
- a second hidden orchestration platform inside Teleton Code
- a huge controller that mixes grounding, repair, verification, prompts, result shaping, and UI shaping in one file
- frontend logic that invents or reinterprets backend truth

## Required Outcomes

The agent subsystem is acceptable only if it can reliably handle ordinary coding requests across varied shapes, for example:

- small browser prototype
- small browser game
- local script or CLI tool
- Telegram bot
- targeted bug fix in an existing project
- code review or explanation without edits

The subsystem is not judged by whether it has many features.
It is judged by whether it behaves predictably and truthfully.

## Target Architecture

The agent subsystem should converge toward this compact layout:

```text
server/
  application/
    code-agent/
      index.js
      turn-controller.js
      task-state.js
      transitions.js

      stages/
        grounding.js
        clarify.js
        execute.js
        verify.js
        repair.js
        finalize.js

      services/
        evidence.js
        failures.js
        result-composer.js
        scope.js

      policy/
        tools.js
        approval.js
        runtime-budget.js
```

This is the intended architecture.
The current codebase may be transitional, but future work should move toward this layout instead of away from it.

## File Responsibilities

### `index.js`

- public entrypoint for the code-agent subsystem
- wires the controller into the rest of the server
- exports only stable entry functions

### `turn-controller.js`

- runs one turn from start to terminal outcome
- owns stage order
- owns lifecycle bookkeeping
- owns pause/resume points for approval
- does not contain domain rules for product types

### `task-state.js`

- single source of truth for one turn
- must remain small and explicit
- must not become a dumping ground for arbitrary ad hoc fields

The state shape should be intentionally limited.

### `transitions.js`

- defines allowed state transitions
- defines terminal states
- defines guards such as repair budget, approval barrier, and invalid transition rejection

This file exists so transition logic does not dissolve into `turn-controller.js`.

### `stages/grounding.js`

- decides whether the turn is `answer`, `inspect`, or `act`
- decides whether one clarification is required
- does not decide the product architecture
- does not decide file names
- does not classify tasks into solution templates

### `stages/clarify.js`

- produces at most one focused clarification question
- must never become a chatbot funnel
- must never repeat a confirmed user choice

### `stages/execute.js`

- gives the model access to the project tools
- lets the model explore, read, edit, and build
- must not force a fixed file structure
- must not hide multiple extra orchestration layers inside itself

### `stages/verify.js`

- checks the result using external evidence
- validates edits, artifacts, and checks
- does not redesign the solution
- does not create new project scope

### `stages/repair.js`

- runs only after a formal failure trigger
- is narrow and budgeted
- fixes the concrete failure class
- must not become a second unrestricted execution loop

### `stages/finalize.js`

- decides `clarification_required`, `completed`, `partial`, or `failed`
- uses evidence and failure state only
- does not invent new facts

### `services/evidence.js`

- computes and normalizes evidence about what really happened

### `services/failures.js`

- classifies runtime, tool, verify, and contract failures into a small formal set

### `services/result-composer.js`

- converts final facts into user-facing result structures and block payloads
- reads evidence as read-only input
- does not decide whether the task actually succeeded

### `services/scope.js`

- enforces minimal necessary change
- rejects silent scope expansion
- exists to stop the agent from turning a small task into a repo-wide rewrite

### `policy/tools.js`

- exposes the real tool surface to the model
- contains only project-work primitives

### `policy/approval.js`

- defines what requires approval
- integrates approval with the turn state

### `policy/runtime-budget.js`

- defines runtime limits
- limits repair attempts and execution retries
- limits output budgets

## The Only Agent Cycle

The entire subsystem should be built around one cycle:

1. grounding
2. clarify or act
3. execute
4. verify
5. repair if needed
6. finish or fail

There must not be hidden alternative cycles for specific product types.

## Stage Semantics

### 1. Grounding

Grounding answers only these questions:

- Is this an answer-only turn, an inspect turn, or an action turn?
- Is there enough information to act responsibly now?
- Is one clarification required?
- Is workspace context needed?

Grounding must not answer:

- Which stack is correct?
- Which files should exist?
- Which architecture the model should choose?
- What kind of app or product template this must be

Grounding is an execution gate, not a planner.

### 2. Clarify or Act

If the request is not ready, the system asks one focused question.

If the request is ready, the system acts.

Clarification rules:

- one question only
- no repeated asking of already confirmed choices
- no long multi-question interviews
- no hidden task planning disguised as clarification

### 3. Execute

Execute is where the model behaves as an agent.

The model can:

- inspect files
- read files
- search the codebase
- write files
- patch files
- move paths
- run checks
- run approved commands

The model decides:

- which files to create or modify
- how to structure the solution
- how to satisfy the request

The code does not decide:

- file names for a given task category
- architectural patterns for the model
- domain-specific implementation recipes

Execution must be allowed to proceed incrementally.
It must not assume that the correct behavior is "generate everything at once".

### 4. Verify

Verify is an internal stage, not a user-facing raw error dump.

Verification checks:

- whether writes were confirmed by tools
- whether artifacts required by the result actually exist
- whether syntax is valid where applicable
- whether project checks passed where applicable
- whether the final narrative matches the evidence

Verification does not decide how to solve the task.
It only decides whether the claimed result is technically and contractually supported.

### 5. Repair if Needed

Repair starts only from a formal trigger.

Allowed triggers:

- invalid edit format
- missing artifact
- verification failure
- unresolved critical tool failure
- claim/evidence mismatch

Repair rules:

- narrow
- local
- budgeted
- no scope expansion
- no repeated blind retries

Repair must not retry the same action unchanged after the same failure type unless new evidence exists or the fix strategy is materially different.

Repair must be bounded in state, not only "morally discouraged".

### 6. Finish or Fail

Finalize chooses one of:

- `clarification_required`
- `completed`
- `partial`
- `failed`

This decision is made from evidence and failure state, not from narrative tone.

## Task State

The state object must stay small and explicit.

Recommended shape:

```js
{
  mode: "answer" | "inspect" | "act",
  status: "clarification_required" | "running" | "completed" | "partial" | "failed",
  stage: "grounding" | "clarify" | "execute" | "verify" | "repair" | "finalize",
  repairAttempts: number,
  approval: {
    active: boolean,
    scope: "shell" | "destructive" | null,
    pendingAction: object | null
  },
  evidence: {
    writesConfirmed: boolean,
    requiredArtifactsPresent: boolean | null,
    checksPassed: boolean | null,
    claimMatchesEvidence: boolean,
    verificationMode: "required" | "best_effort" | "not_applicable"
  },
  scope: {
    baselineWorkspaceState: object | null,
    allowedExpansion: "minimal",
    outOfScopeDetected: boolean
  },
  summary: {
    currentAction: string | null,
    resultSummary: string | null
  }
}
```

Rules for interpreting the state:

- `stage` tells where the controller is in the cycle
- `status` tells the lifecycle state of the turn
- approval waiting is represented by `approval.active = true`; it is an overlay pause, not a normal stage and not a terminal status
- evidence fields are evaluated only when they are applicable to the current mode and requested outcome

If the state grows beyond this kind of structure, the architecture is drifting.

## Transition Rules

The transition rules must be explicit.

Valid main transitions:

- `grounding -> clarify`
- `grounding -> execute`
- `grounding -> finalize`
- `clarify -> finalize`
- `execute -> verify`
- `execute -> finalize`
- `execute -> approval_pause`
- `approval_pause -> execute`
- `approval_pause -> finalize`
- `verify -> finalize`
- `verify -> repair`
- `repair -> verify`
- `repair -> finalize`

Terminal states:

- `clarification_required`
- `completed`
- `partial`
- `failed`

Mandatory guards:

- no direct `approval_pause -> completed`
- no direct `clarification_required -> execute`
- no unbounded `repair -> verify -> repair -> verify` loop
- no retry of the same repair action unchanged after the same failure class without new evidence or a materially different fix
- no `completed` when evidence says claims do not match facts

## Scope Rules

The agent is free in implementation, but not free in scope expansion.

Scope rules:

- make the minimal sufficient change for the request
- do not silently rewrite unrelated parts of the project
- do not introduce parallel implementations for the same role
- do not change dependencies unless required and permitted
- do not broaden the task because "it seems nicer this way"
- do not perform repo-wide cleanup, restructuring, or modernization under cover of a narrow user request

Scope is not a domain-specific scenario system.
It is a general rule against sprawl.

## Baseline Workspace Truth

Before write-capable execution starts, the system should capture enough baseline workspace truth to distinguish:

- pre-existing dirty state
- pre-existing failing checks
- pre-existing missing artifacts
- agent-caused changes and failures

The subsystem must not attribute old repo problems to the current turn without evidence.

## Evidence Model

Evidence must be small and typed.

Required evidence dimensions:

- `writesConfirmed`
- `requiredArtifactsPresent`
- `checksPassed`
- `claimMatchesEvidence`
- `verificationMode`

Evidence must come from:

- tool events
- workspace reality
- check outputs
- verification outputs

Evidence fields are interpreted only when they apply to the current mode and requested outcome.
For example, required artifacts are not relevant for an answer-only or inspect-only turn.

Narrative text is not evidence.

## Failure Model

Failure types should remain few and formal:

- `invalid_edit_format`
- `tool_execution_failed`
- `verification_failed`
- `artifact_missing`
- `claim_mismatch`
- `scope_violation`
- `approval_blocked`
- `interrupted`
- `timed_out`
- `loop_stalled`

If a new failure does not fit these categories, first question the design before adding a new type.

## Approval Flow

Approval is part of the cycle, not a side system.

When approval is required:

1. execution pauses
2. `approval.active` becomes `true`
3. the pending risky action is stored
4. UI shows a clear approval block
5. after approval, execution resumes from that paused point
6. after rejection, turn ends as `partial` or `failed` depending on what was already done

Approval must not force the user to manually operate internal repair logic.
Destructive file or command actions must never execute silently when policy requires approval.

## Verification Rules

Verification exists to prevent false completion.
Verification is a fact-gathering responsibility, not an intuitive judgment layer.

Verification should use:

- project-native checks when available
- syntactic validation where applicable
- artifact existence checks
- cross-file consistency checks
- evidence/narrative alignment checks

Verification must not:

- redesign the solution
- enforce a product template
- tell the model which architecture it should have used

## Result Rules

User-facing output must be honest and calm.

The system should prefer these outcomes:

- completed: the requested work is done and supported by evidence
- partial: some useful work exists but the turn did not fully satisfy the request
- failed: the turn did not produce a reliable result
- clarification_required: the user must answer one focused question first

`partial` is valid only when user-relevant, evidence-supported progress exists.
If no such progress exists, the result should be `failed`.

The user should not usually see raw internal repair noise.

## UI Contract

Frontend should render backend truth, not reinterpret it.

UI should primarily display:

- current status
- current action
- approval block if needed
- final result summary
- partial artifacts if relevant
- final artifacts if relevant

UI should not:

- invent its own completion logic
- expose raw internal loops as the default view
- present technical verification chatter as if it were the final answer

## Tool Surface

The model should only see project-work primitives.

Allowed tool categories:

- list files
- inspect project
- read file
- search text
- write file
- patch file
- move path
- delete path
- run project check
- run command, when allowed

The model must not be given meta-tools for controlling the agent itself.

Examples of forbidden meta-tools:

- `ground_task`
- `repair_task`
- `verify_task`
- `finish_task`
- `choose_task_type`

## Prompt Rules

The system prompt must stay short and operational.

It may define:

- use tools when needed
- do not claim actions without evidence
- do not expand scope without reason
- keep changes minimal and coherent
- verification and approval are real constraints

It must not define:

- how to build a game
- how to build a website
- how to structure a Telegram bot
- what files a task category should contain
- what architecture the model should choose

The prompt is for operating the loop, not teaching coding.

## Implementation Rules

Future implementation work must follow these rules:

1. Prefer deleting domain heuristics over adding new ones.
2. Prefer shrinking controller responsibilities over expanding them.
3. Prefer evidence-based decisions over narrative-based decisions.
4. Prefer small services with one purpose over giant mixed modules.
5. Prefer runtime rules over task-specific scripts.
6. Prefer generic project tools over meta-tools.
7. Prefer one internal cycle over multiple hidden sub-cycles.
8. Prefer extending Teleton Code as a thin coding loop over turning it into a second orchestration framework on top of Teleton Agent.

## Explicit Non-Rules

The following are not allowed as architectural policy:

- "browser games always need index.html, styles.css, and script.js"
- "Telegram bots should default to Python"
- "small apps should default to one HTML page"
- "if the user mentions a game, use a canvas flow"
- "if the user asks for a landing page, create three standard files"

The model may choose these outcomes.
The code may not force them.

## Migration Direction From Current Code

The current codebase contains transitional logic.

Future refactors should move work:

- out of giant mixed controllers
- out of heuristic artifact planning
- out of frontend truth inference
- out of domain-specific prompt guidance

Future refactors should move work toward:

- one turn controller
- one compact state model
- one explicit transition table
- one formal evidence model
- one bounded repair flow
- one server-owned result contract

## Quality Gate

This architecture is only considered successful if the agent can reliably handle varied ordinary tasks without task-specific scaffolding.

Examples:

- small browser prototype
- small browser game
- Telegram bot
- local script
- review-only request
- bug fix in an existing codebase

The quality gate is not "did the model produce some output".
The quality gate is:

- did it act only when it should
- did it avoid false completion
- did it keep scope under control
- did it recover honestly
- did it keep UI aligned with runtime truth

## Final Rule

Whenever a design choice is unclear, choose the option that:

- gives the model more freedom in solving the task
- gives the system more rigor in truth, scope, and verification
- adds fewer task-specific assumptions
- keeps the execution cycle smaller

If a proposed change makes the cycle more specific, more heuristic, or more domain-aware, it is probably the wrong change.
