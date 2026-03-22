<p align="center">
  <img src="https://raw.githubusercontent.com/Yukinaton/teleton-code/main/docs/assets/teleton-code-banner.svg" alt="Teleton Code" width="900" />
</p>

<p align="center"><b>Local-first companion IDE for Teleton Agent with a Teleton-powered code workflow</b></p>

<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js"></a>
  <a href="https://github.com/TONresistor/teleton-agent"><img src="https://img.shields.io/badge/Teleton-Agent%20Companion-2563eb" alt="Teleton Agent companion"></a>
  <img src="https://img.shields.io/badge/Scope-Local%20First-f59e0b" alt="Local first">
  <img src="https://img.shields.io/badge/Auth-Owner%20Only-111827" alt="Owner only">
</p>

---

<p align="center">
Teleton Code is not a standalone agent platform and does not replace Teleton Agent.
It runs next to Teleton Agent on the same machine, uses the same Teleton home and workspace, and adds a coding-focused IDE with projects, chats, preview, approvals, and a Teleton-powered code agent.
</p>

## Why It Exists

Teleton Agent is the runtime.
Teleton Code adds the developer-facing IDE layer around it:

- project and chat workflow for coding sessions
- file browser and inline editing
- runnable preview for browser projects
- risky-action approvals when full access is off
- a Teleton-powered code mode tuned for inspect, edit, verify, review, and recovery

## Key Highlights

| Area | What Teleton Code adds |
| --- | --- |
| **IDE Workflow** | Projects, chats, file editing, preview, and approvals in one local interface |
| **Code Agent** | A Teleton-shaped coding loop for new chats with inspect, execute, verify, review, and recovery phases |
| **Project Instructions** | Reads `AGENTS.md` then `CLAUDE.md` (project-level first, then Teleton system fallback) and derives verification commands from them plus `package.json` scripts |
| **Preview** | Runnable browser projects open on an isolated preview origin separate from the IDE |
| **Auth** | Local owner-only access modeled after Teleton WebUI with an auth exchange URL and HttpOnly session cookie |
| **Packaging** | npm-ready CLI with `teleton-code start --webui` as the primary local entrypoint |

---

## Quick Start

### 1. Installation

**npm (recommended):**

```bash
npm install -g teleton-code@0.1.2
```

**From source (development):**

```bash
git clone https://github.com/Yukinaton/teleton-code.git
cd teleton-code
npm install
npm --prefix client-new install
npm run build
```

### 2. Start

```bash
teleton-code start --webui
```

Default local ports:

- IDE: `127.0.0.1:9999`
- Preview: `127.0.0.1:10000`

If the default pair is busy, Teleton Code automatically picks the next free pair.

### 3. Access

When `ownerOnly` is enabled, Teleton Code generates a local auth exchange URL:

```text
http://127.0.0.1:9999/auth/exchange?token=...
```

Open the current auth exchange URL from the console to enter the IDE.

Startup metadata is written to:

- `logs/current-auth-url.txt`
- `logs/current-runtime.json`

### 4. Verify

1. Open the IDE.
2. Create a project.
3. Open a new chat inside that project.
4. Ask the agent to inspect, review, explain, or build something small.

> Need more details? See [Getting Started](docs/getting-started.md) for installation notes, auth flow, approvals, and troubleshooting.

---

## Teleton Relationship

Teleton Code is intentionally a companion tool, not a fork of Teleton Agent.

### Teleton Agent owns

- the main agent runtime
- Teleton home and workspace
- base identity and runtime context
- plugin and tool ecosystem

### Teleton Code owns

- IDE UI and coding workflow
- project and chat experience
- preview, approvals, and file editing surface
- IDE-specific storage and local service state
- the code-mode layer used by the IDE

This keeps the IDE aligned with Teleton while avoiding invasive changes to Teleton core.

## How It Fits Into The Teleton Stack

| Layer | Owned by | Responsibility |
| --- | --- | --- |
| Agent runtime | Teleton Agent | core agent loop, tool ecosystem, Teleton home, base context |
| Workspace | Teleton Agent | shared `~/.teleton/workspace` and project roots |
| IDE service | Teleton Code | local HTTP service, auth exchange, preview service |
| Coding UX | Teleton Code | project/chat workflow, approvals, preview, IDE-specific blocks |
| Code workflow | Teleton Code + Teleton | Teleton runtime with an IDE-focused code mode |

---

## Agent Loop

New chats use the standard task engine:

- one unified Teleton-shaped code loop instead of phrase-based routing
- model-led mode selection: `answer`, `clarify`, `inspect`, `execute`, `review`, `recover`
- external evidence gates before finish
- risky approvals only for shell, dependency, and destructive actions

Older chats can remain on the compatibility engine and are not migrated automatically.

## Project Instructions

For new chats, Teleton Code loads instruction documents in this order:

1. `<project-root>/AGENTS.md` (if present)
2. `~/.teleton/workspace/ide/code-agent/AGENTS.md`
3. `<project-root>/CLAUDE.md` (if present)
4. `~/.teleton/workspace/ide/code-agent/CLAUDE.md`
5. known project verification commands from instruction files and from `package.json` scripts

System instruction files are created once in the Teleton workspace and are shared across projects.  
Teleton Code does not auto-create `AGENTS.md` or `CLAUDE.md` inside project folders.

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

Web search availability follows the Teleton Agent configuration. If `tavily_api_key` is not configured in Teleton, web search stays unavailable in the IDE.

---

## Documentation

| Section | Description |
| --- | --- |
| [Getting Started](docs/getting-started.md) | Installation, startup, auth flow, approvals, and troubleshooting |
| [Configuration](docs/configuration.md) | Config file, CLI flags, environment variables, data layout, and runtime artifacts |
| [Architecture](docs/architecture.md) | Runtime boundaries, task engines, storage model, preview isolation, and Teleton integration |

---

## Project Structure

```text
bin/                    CLI entrypoint
cli/                    start command and CLI flow
client-new/             React IDE frontend source
docs/                   user-facing documentation and README assets
scripts/                build, smoke, and metrics scripts
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
- IDE state: `~/.teleton/ide/teleton-code`
- Projects: `~/.teleton/workspace/projects`
- IDE workspace metadata: `~/.teleton/workspace/ide`

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

Optional metrics:

```bash
npm run agent:metrics -- path/to/state.json
```

---

## Current Scope

This release is focused on the local IDE workflow on the same machine or server where Teleton Agent already runs.

Included:

- local IDE and preview services
- Teleton-powered code workflow
- standard task engine for new chats
- approval flow for risky actions
- project, chat, archive, and workspace management

Planned later:

- Telegram Mini App deployment
- public remote access
- server onboarding for internet-facing installs

---

## Status

- **Install path**: `npm install -g teleton-code@0.1.2`
- **Current track**: local-first companion IDE for Teleton Agent
- **Not a standalone agent**: Teleton Agent remains the base platform

## Support

- **Teleton Agent repo**: [TONresistor/teleton-agent](https://github.com/TONresistor/teleton-agent)
- **This project**: companion IDE repository and npm package
