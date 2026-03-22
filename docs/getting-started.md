# Getting Started

Teleton Code is designed to run next to an existing Teleton Agent installation.

## Prerequisites

- Node.js `20.0.0+`
- Teleton Agent already installed and configured
- Teleton home available at `~/.teleton`
- a valid `~/.teleton/config.yaml`

If Teleton is installed in a non-standard location, override the package path:

```bash
export TELETON_CODE_TELETON_PACKAGE=/absolute/path/to/teleton
```

On Windows PowerShell:

```powershell
$env:TELETON_CODE_TELETON_PACKAGE="C:\path\to\teleton"
```

## Installation

### npm

```bash
npm install -g teleton-code@0.1.2
```

### From source

```bash
git clone https://github.com/Yukinaton/teleton-code.git
cd teleton-code
npm install
npm --prefix client-new install
npm run build
```

## Start

```bash
teleton-code start --webui
```

Available flags:

```text
teleton-code start [--webui] [--host 127.0.0.1] [--port 9999] [--preview-port 10000]
```

Common overrides:

- `--teleton-home <path>`
- `--teleton-package <path>`
- `--auth-token <token>`

## Auth Flow

When local owner-only mode is enabled, Teleton Code behaves similarly to Teleton WebUI:

1. the service generates a local auth token
2. opening `/auth/exchange?token=...` sets an HttpOnly session cookie
3. the browser then accesses the IDE normally at `/`

The current valid auth URL is written to:

- `logs/current-auth-url.txt`
- `logs/current-runtime.json`

Open the current auth exchange URL from the console to enter the IDE.

## First Run Checklist

1. Start the service.
2. Open the IDE in the browser.
3. Create a new project.
4. Create a new chat inside that project.
5. Ask the agent to inspect, explain, review, or create something small.
6. Verify preview works for browser projects.
7. Verify approvals appear only for risky shell, dependency, or destructive actions.

## Agent Behavior

### New chats

New chats use the standard task engine:

- one unified Teleton-shaped coding loop
- model-led mode selection
- external evidence before finish
- project instructions from `AGENTS.md` and `CLAUDE.md` (project-level first, then Teleton system fallback)

### Compatibility chats

Existing chats are not migrated automatically and can continue to use the compatibility engine.

## Approvals

With `Full access` disabled:

- normal file reads and edits inside the active project do not require approval
- structured verification can run without approval
- arbitrary shell commands, dependency changes, and destructive actions do require approval

With `Full access` enabled:

- normal shell and project actions proceed without the extra approval step
- destructive actions are still treated as high-trust operations by design

## Project Instructions

For new chats, Teleton Code loads instruction documents in this order:

1. `<project-root>/AGENTS.md` (if present)
2. `~/.teleton/workspace/ide/code-agent/AGENTS.md`
3. `<project-root>/CLAUDE.md` (if present)
4. `~/.teleton/workspace/ide/code-agent/CLAUDE.md`
5. known project verification commands from instruction files and from `package.json` scripts

System instruction files are created once in the Teleton workspace and are shared across projects.
Teleton Code does not auto-create `AGENTS.md` or `CLAUDE.md` inside project folders.

Known verification commands are derived from instruction files and from `package.json` scripts such as:

- `npm run check`
- `npm run lint`
- `npm run test`
- `npm run build`

## Web Search

Web search availability is inherited from Teleton Agent.

- if `tavily_api_key` is configured in Teleton, web search is available in the IDE
- if it is missing, web search remains unavailable in the IDE

## Troubleshooting

### Teleton package not found

Set `TELETON_CODE_TELETON_PACKAGE` explicitly or install `teleton` globally with npm.

### Browser says `Unauthorized`

Open the latest URL from `logs/current-auth-url.txt`.

### Default ports are busy

Teleton Code will automatically pick the next free pair and write the final runtime ports to `logs/current-runtime.json`.

### Preview is empty

Make sure the project contains a runnable browser entry file such as `index.html`, and check that the preview port is reachable locally.

### Web search is unavailable

Enable `tavily_api_key` in the Teleton Agent configuration first.
