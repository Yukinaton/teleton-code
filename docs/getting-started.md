# Getting Started

Teleton Code is designed to run next to an existing Teleton Agent installation.

## Prerequisites

- Node.js `20.0.0+`
- Teleton Agent already installed and configured
- Teleton home available at `~/.teleton`
- A valid `~/.teleton/config.yaml`

If Teleton is installed in a non-standard location, export:

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
npm install -g teleton-code@latest
```

This is the intended public install command after the first npm publish.

### From source

```bash
git clone <your-repo-url>
cd Pure-IDE
npm install
npm --prefix client-new install
npm run build
```

## Start

```bash
teleton-code start --open
```

Available flags:

```text
teleton-code start [--host 127.0.0.1] [--port 9999] [--preview-port 10000] [--open]
```

Common overrides:

- `--teleton-home <path>`
- `--teleton-package <path>`
- `--auth-token <token>`

## Auth Flow

When local owner-only mode is enabled, Teleton Code behaves similarly to Teleton WebUI:

1. The service generates a local auth token.
2. Opening `/auth/exchange?token=...` sets an HttpOnly session cookie.
3. The browser then accesses the IDE normally at `/`.

The current valid auth URL is always written to:

- `logs/current-auth-url.txt`
- `logs/current-runtime.json`

If you start with `--open`, the auth link is opened automatically.

## First Run Checklist

1. Start the service.
2. Open the IDE in the browser.
3. Create a new project.
4. Create a new chat inside that project.
5. Ask the agent to inspect or create something small.
6. Verify preview works for browser projects.
7. Verify approvals appear only for important write or execution actions.

## Troubleshooting

### Teleton package not found

Set `TELETON_CODE_TELETON_PACKAGE` explicitly or install `teleton` globally with npm.

### Browser says `Unauthorized`

Open the latest URL from `logs/current-auth-url.txt`.

### Default ports are busy

Teleton Code will automatically pick the next free pair and write the final runtime ports to `logs/current-runtime.json`.

### Preview is empty

Make sure the project contains a runnable browser entry file such as `index.html`, and check that the preview port is reachable locally.
