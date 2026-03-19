<p align="center">
  <img src="https://raw.githubusercontent.com/Yukinaton/teleton-code/main/docs/assets/teleton-code-banner.svg" alt="Teleton Code" width="900" />
</p>

<p align="center"><b>Companion IDE for Teleton Agent with a Teleton-powered code workflow</b></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js"></a>
  <a href="https://github.com/TONresistor/teleton-agent"><img src="https://img.shields.io/badge/Teleton-Agent%20Companion-2563eb" alt="Teleton Agent companion"></a>
  <img src="https://img.shields.io/badge/Scope-Local%20Release-f59e0b" alt="Local release">
  <img src="https://img.shields.io/badge/Auth-Owner%20Only-111827" alt="Owner only">
</p>

---

<p align="center">
Teleton Code is not a separate agent platform and does not replace Teleton Agent.
It is an IDE layer that runs next to Teleton Agent on the same machine or server, uses the same Teleton home and workspace, and provides a coding-focused interface with projects, chats, approvals, preview, and a Teleton-powered code agent.
</p>

## Why It Exists

Teleton Agent is the core agent platform.
Teleton Code adds the developer-facing IDE experience around it:

- project and chat workflow for coding sessions
- file browser and inline editing
- runnable preview for browser projects
- approvals for important write and execution actions
- a Teleton-powered code agent tuned for software work

## Key Highlights

| Area | What Teleton Code adds |
| --- | --- |
| **IDE Workflow** | Projects, chats, file editing, approvals, and preview in one local interface |
| **Code Agent** | A Teleton-powered coding mode tuned for inspect, explain, edit, verify, and recover flows |
| **Workspace Model** | Project files live under `~/.teleton/workspace/projects` with IDE metadata stored separately |
| **Preview** | Runnable browser projects open on an isolated local preview origin |
| **Auth** | Local owner-only access modeled after Teleton WebUI |
| **Packaging** | npm-ready CLI packaging with `teleton-code start --open` as the main entrypoint |

---

## Quick Start

### 1. Installation

**npm (target public install):**

```bash
npm install -g teleton-code@latest
```

**Current repository install:**

```bash
git clone <your-repo-url>
cd Pure-IDE
npm install
npm --prefix client-new install
npm run build
```

Until the first npm publish, use the repository install flow above.

### 2. Start

```bash
teleton-code start --open
```

Default local ports:

- IDE: `127.0.0.1:9999`
- Preview: `127.0.0.1:10000`

If the default pair is busy, Teleton Code automatically picks the next free pair.

### 3. Access

When `ownerOnly` is enabled, Teleton Code generates a local auth exchange URL similar to Teleton WebUI:

```text
http://127.0.0.1:9999/auth/exchange?token=...
```

If you start with `--open`, the browser receives the local owner session automatically.

The current active URL is always written to:

- `logs/current-auth-url.txt`
- `logs/current-runtime.json`

### 4. Verify

1. Open the IDE.
2. Create a project.
3. Open a new chat inside that project.
4. Ask the agent to inspect, explain, or build something small.

> **Need more details?** See [Getting Started](docs/getting-started.md) for installation notes, auth flow, troubleshooting, and first-run checks.

---

## Teleton Relationship

Teleton Code is intentionally designed as a companion tool, not as a fork of Teleton Agent.

### Teleton Agent owns

- the main agent runtime
- Teleton home and workspace
- base agent identity and runtime context
- plugin and tool ecosystem

### Teleton Code owns

- IDE UI and coding workflow
- project and chat experience
- approvals, preview, and file editing surface
- IDE-specific metadata and local service state

This keeps the IDE aligned with Teleton while avoiding changes to Teleton core just to make the IDE work.

## How It Fits Into The Teleton Stack

| Layer | Owned by | Responsibility |
| --- | --- | --- |
| Agent runtime | Teleton Agent | core agent loop, tool ecosystem, Teleton home, base context |
| Workspace | Teleton Agent | shared `~/.teleton/workspace` and project roots |
| IDE service | Teleton Code | local HTTP service, auth exchange, preview service |
| Coding UX | Teleton Code | project/chat workflow, approvals, preview, IDE-specific blocks |
| Code workflow | Teleton Code + Teleton | Teleton runtime with an IDE-focused code agent surface |

---

## Requirements

- Node.js `20.0.0+`
- Teleton Agent already installed on the same machine
- Teleton config available in `~/.teleton/config.yaml`

Teleton Code auto-detects Teleton in this order:

1. `TELETON_CODE_TELETON_PACKAGE`
2. sibling clone `../teleton-agent`
3. local clone `./teleton-agent`
4. global npm install root from `npm root -g`

---

## Configuration

The local service reads `teleton-code.config.json`:

```json
{
  "version": 1,
  "server": {
    "host": "127.0.0.1",
    "port": 9999,
    "previewPort": 10000
  },
  "security": {
    "ownerOnly": true,
    "loopbackOnly": true
  }
}
```

Useful runtime overrides:

- `TELETON_HOME`
- `TELETON_CODE_TELETON_PACKAGE`
- `TELETON_CODE_HOST`
- `TELETON_CODE_PORT`
- `TELETON_CODE_PREVIEW_PORT`
- `TELETON_CODE_AUTH_TOKEN`

---

## Documentation

| Section | Description |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Installation, startup, auth flow, and troubleshooting |
| [Configuration](docs/configuration.md) | Config file, environment variables, ports, and data layout |
| [Architecture](docs/architecture.md) | Runtime boundaries, storage model, and Teleton integration |

---

## Project Structure

```text
bin/                    CLI entrypoint
cli/                    start command and CLI flow
client-new/             React IDE frontend source
docs/                   user-facing documentation and README assets
scripts/                build sync and smoke scripts
server/
  application/          agent and chat use-cases
  handlers/             API handlers
  infrastructure/       persistence and filesystem layers
  preview/              isolated preview serving
  security/             local auth and loopback guards
  lib/                  runtime bridge and low-level IDE modules
  public/               packaged frontend build used at runtime
```

---

## Local Data Layout

- Teleton home: `~/.teleton`
- IDE data: `~/.teleton/ide/teleton-code`
- Projects: `~/.teleton/workspace/projects`
- IDE metadata: `~/.teleton/workspace/ide`

Legacy repo-local state folders are not part of the target layout and are ignored during normal development and packaging.

---

## Development Checks

```bash
npm run check
npm run smoke:tools
npm --prefix client-new run lint
npm run build
npm run pack:check
```

---

## Current Scope

This release is focused on the local IDE workflow on the same machine or server where Teleton Agent already runs.

Included:

- local IDE and preview services
- Teleton-powered code workflow
- approval flow for important actions
- project, chat, archive, and workspace management

Planned later:

- Telegram Mini App deployment
- public remote access
- server onboarding for internet-facing installs

---

## Status

- **Current release**: local companion IDE for Teleton Agent
- **Publication goal**: clean npm package + public repo frontpage + next-stage deployment story
- **Not a standalone agent**: Teleton Agent remains the base platform

## Support

- **Teleton Agent repo**: [TONresistor/teleton-agent](https://github.com/TONresistor/teleton-agent)
- **This project**: companion IDE repository and local release track
