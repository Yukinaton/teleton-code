# Architecture

Teleton Code is a companion IDE for Teleton Agent, not a replacement for it.

This document is publication-oriented and describes the external architecture contract.

## Design Boundary

### Teleton Agent owns

- primary agent runtime
- Teleton home and workspace
- base identity and runtime context
- plugin and tool ecosystem
- long-lived agent platform concerns

### Teleton Code owns

- IDE UI and interaction model
- project and chat workflow
- preview service for browser projects
- project file browser and editor surface
- local approval flow
- IDE-specific storage and metadata
- the IDE code-mode layer built on top of Teleton runtime

This boundary keeps the IDE aligned with Teleton without turning it into a fork of the core agent.

## Backend Shape

Current backend layers:

```text
server/
  application/
    agent/
    chat/
  config/
  infrastructure/
    filesystem/
    persistence/
  preview/
  security/
  handlers/
  lib/
```

### Stable areas

- `server/application/code-agent/*` contains the active code-agent orchestration, state model, and stage flow
- `server/infrastructure/persistence/*` contains the split state stores
- `server/security/*` contains local auth and loopback boundaries
- `server/preview/*` contains isolated preview serving

### Transitional area

- `server/lib/runtime-adapter.js` is the bridge into Teleton runtime and remains the main compatibility point between Teleton Code and Teleton Agent

## Task Engines

New chats use the standard task engine.
Older chats may remain on the compatibility engine and are not migrated automatically.

### Goal

Replace phrase-heavy routing and special-case build flows with one Teleton-shaped code loop:

- observe
- localize
- act
- verify
- recover if needed
- finish only with evidence

### Standard Engine Controller

The standard engine controller is responsible for:

- collecting project, chat, and instruction context
- invoking Teleton runtime
- observing tool events
- updating phase and evidence state
- running verification when writes happened
- allowing at most one narrow repair pass on evidence mismatch or verify failure

### Modes

The standard engine lets the model choose among:

- `answer`
- `clarify`
- `inspect`
- `execute`
- `review`
- `recover`

These are model-led, but the finish and approval gates remain deterministic.

## Task State Contract

Task state is normalized around a small phase model:

| Field | Meaning |
| --- | --- |
| `taskEngine` | `standard` or `compatibility` |
| `mode` | `answer`, `clarify`, `inspect`, `execute`, `review`, or `recover` |
| `phase` | `idle`, `inspecting`, `editing`, `verifying`, `awaiting_approval`, `completed`, or `failed` |
| `currentAction` | Short human-readable summary of the current step |
| `resultSummary` | Short final summary aligned with tool evidence |
| `approvalScope` | `shell` or `destructive` when approval is needed |
| `evidenceState` | `none`, `tool_confirmed`, `verify_passed`, `verify_failed`, or `claim_mismatch` |

UI uses this contract for the primary task card instead of exposing raw internal steps as the main status model.

## Tool Surface

The code-mode surface is intentionally narrow:

### Localize and read

- list files
- inspect project
- read file and read files
- search text and search context
- suggest commands
- git status and git diff

### Edit

- write file
- write file lines
- write JSON
- replace text
- patch file
- insert block
- make directories
- move or rename path

### Verify

- run check suite

### Research

- web search, if enabled in Teleton Agent

### Fallback and risky tools

- run command
- install dependencies
- delete path

## Approval Model

With `Full access` disabled:

### No approval required

- read, search, inspect, and review tools
- normal file creation and editing inside the active project
- project-scoped structured verification

### Approval required

- arbitrary shell commands
- dependency changes
- destructive actions

This keeps the IDE usable for ordinary coding while still gating risky operations.

## Verification And Finish

The standard engine does not treat narrative as proof.

After edits, the loop attempts verification by using:

1. structured project checks
2. known project verification commands derived from instructions or `package.json`

The turn is only considered complete when:

- changed files are confirmed by tools
- verification result is recorded, or explicitly marked not applicable
- final summary does not conflict with tool evidence
- there is no pending approval barrier

If verification fails or the narrative conflicts with evidence, the standard engine allows one narrow repair pass and then either succeeds honestly or fails honestly.

## Project Instructions

For standard-engine chats, Teleton Code treats project instructions as first-class context:

1. `<project-root>/AGENTS.md` (if present)
2. `~/.teleton/workspace/ide/code-agent/AGENTS.md`
3. `<project-root>/CLAUDE.md` (if present)
4. `~/.teleton/workspace/ide/code-agent/CLAUDE.md`
5. derived verify/setup commands and IDE project/chat context

Instructions are deduplicated and summarized before they are sent to the model.

## Storage Model

The service uses a project-plus-chat working model:

- project context
- chat context

Projects share a workspace root and project-level metadata.
Chats keep their own session state and task progression inside that project.

Current storage roots:

```text
~/.teleton/workspace/ide/projects/
~/.teleton/workspace/ide/
~/.teleton/ide/teleton-code/
```

## Preview Isolation

Preview runs on a separate local origin from the IDE itself:

- IDE service: default `127.0.0.1:9999`
- Preview service: default `127.0.0.1:10000`

This separation reduces risk from runnable HTML and JavaScript previews while keeping the local workflow simple.

## Local Auth Model

The local auth model is intentionally close to Teleton WebUI:

1. service starts
2. local token is generated
3. `/auth/exchange?token=...` issues an HttpOnly owner session cookie
4. IDE and preview routes require that session

For the current release, access remains localhost-only and owner-focused by design.
