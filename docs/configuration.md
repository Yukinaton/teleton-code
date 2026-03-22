# Configuration

Teleton Code uses a small JSON config file, a few CLI flags, and runtime environment variables.

## Config File

File:

```text
teleton-code.config.json
```

Default shape:

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

## Server

| Key | Description | Default |
| --- | --- | --- |
| `server.host` | Bind address for IDE and preview services | `127.0.0.1` |
| `server.port` | IDE port | `9999` |
| `server.previewPort` | Preview port | `10000` |

If the configured pair is unavailable, Teleton Code automatically chooses the next free pair.

## Security

| Key | Description | Default |
| --- | --- | --- |
| `security.ownerOnly` | Require a local owner session to use the IDE | `true` |
| `security.loopbackOnly` | Restrict access to localhost | `true` |

In the current release, Teleton Code is intentionally local-only.

## CLI Flags

```text
teleton-code start [--webui] [--host 127.0.0.1] [--port 9999] [--preview-port 10000]
```

Additional overrides:

- `--teleton-home <path>`
- `--teleton-package <path>`
- `--auth-token <token>`

`--webui` is a Teleton-style alias for the local IDE WebUI flow. It does not start the Teleton Agent WebUI itself.

## Environment Variables

| Variable | Description |
| --- | --- |
| `TELETON_HOME` | Override the Teleton home directory |
| `TELETON_CODE_TELETON_PACKAGE` | Override the Teleton package path |
| `TELETON_CODE_HOST` | Override the bind host |
| `TELETON_CODE_PORT` | Override the IDE port |
| `TELETON_CODE_PREVIEW_PORT` | Override the preview port |
| `TELETON_CODE_AUTH_TOKEN` | Override the generated local auth token |

## Teleton Detection

Teleton Code resolves the Teleton package in this order:

1. `TELETON_CODE_TELETON_PACKAGE`
2. sibling clone `../teleton-agent`
3. local clone `./teleton-agent`
4. global npm install root from `npm root -g`

This keeps the IDE install independent from how Teleton itself was installed.

## Data Layout

Teleton Code stores runtime data under the Teleton home, not in the repository:

```text
~/.teleton/
  config.yaml
  workspace/
    projects/
    ide/
      code-agent/
      projects/
      chats/
  ide/
    teleton-code/
      state.json
```

### What lives where

- `workspace/projects/` contains project files
- `workspace/ide/code-agent/` contains IDE-specific agent workspace files
- `workspace/ide/projects/` contains IDE project metadata
- `workspace/ide/chats/` contains IDE chat metadata
- `ide/teleton-code/state.json` stores local IDE service state

## Project Instructions

For new chats, Teleton Code loads instruction documents in this order:

1. `<project-root>/AGENTS.md` (if present)
2. `~/.teleton/workspace/ide/code-agent/AGENTS.md`
3. `<project-root>/CLAUDE.md` (if present)
4. `~/.teleton/workspace/ide/code-agent/CLAUDE.md`
5. known project verification commands from instruction files and from `package.json` scripts

System instruction files are created once in the Teleton workspace and are shared across projects.
Teleton Code does not auto-create `AGENTS.md` or `CLAUDE.md` inside project folders.

## Verification Commands

The standard task engine derives safe project verification commands from:

- active instruction files from project root and Teleton system fallback
- `package.json` scripts such as `check`, `lint`, `test`, `build`, `verify`, and `typecheck`

These commands can run without approval when they stay inside the project verification contract.

## Web Search

Web search availability follows the Teleton Agent configuration:

- if `tavily_api_key` is present in Teleton config, web search is available to the IDE code mode
- if it is missing, web search remains disabled in the IDE

## Auth And Runtime Artifacts

The running service writes current startup metadata to:

- `logs/current-auth-url.txt`
- `logs/current-runtime.json`

These files describe the current running instance and should be preferred over old console logs.

## Preview Isolation

Preview runs on a separate local origin from the IDE itself:

- IDE service: default `127.0.0.1:9999`
- Preview service: default `127.0.0.1:10000`

This keeps runnable browser output separated from the IDE origin.
