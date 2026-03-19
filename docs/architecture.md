# Architecture

Teleton Code is a companion IDE for Teleton Agent, not a replacement for it.

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
- code-focused approval flow
- project file browser and editor surface
- preview service for browser projects
- IDE-specific storage and metadata

This boundary keeps the IDE aligned with Teleton without turning it into a fork of the core agent.

## Runtime Shape

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

### What is already clean

- `server/application/agent/*` contains the active agent flows
- `server/infrastructure/persistence/*` contains the split state stores
- `server/security/*` contains auth and loopback boundaries
- `server/preview/*` contains isolated preview serving

### What remains transitional

- `server/lib/runtime-adapter.js` is now a thin runtime bridge, but still remains the bridge point into lower-level runtime concerns
- `server/lib/*` still contains some shared low-level modules that are being normalized gradually

## Agent Execution Modes

Teleton Code deliberately separates several interaction modes:

- `clarification`: ask follow-up questions before acting
- `consultation`: explain, review, or inspect without executing writes
- `execution`: perform meaningful file or shell actions
- `approval`: pause for important write or execution steps when full access is off
- `repair`: recover from failed build or validation attempts

This prevents the IDE agent from behaving like a blind file generator on every vague prompt.

## Storage Model

The service uses a two-level working model:

- `project context`
- `chat context`

Projects share a workspace root and project-level metadata.
Chats keep their own session state and task progression inside that project.

Current storage roots:

```text
~/.teleton/workspace/projects/
~/.teleton/workspace/ide/
~/.teleton/ide/teleton-code/
```

## Preview Isolation

Preview runs on a separate local origin from the IDE itself:

- IDE service: default `127.0.0.1:9999`
- Preview service: default `127.0.0.1:10000`

This separation reduces risk from runnable HTML and JavaScript previews while keeping the workflow simple for local use.

## Local Auth Model

The local auth model is intentionally close to Teleton WebUI:

1. service starts
2. local token is generated
3. `/auth/exchange?token=...` issues an HttpOnly owner session cookie
4. IDE and preview routes require that session

For the current local release, access remains localhost-only and owner-focused by design.
