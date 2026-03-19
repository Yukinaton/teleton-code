# Configuration

Teleton Code uses a small JSON config file and a few runtime environment variables.

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
  memory.db
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
- `workspace/ide/code-agent/` contains IDE-specific agent markdown files
- `workspace/ide/projects/` and `workspace/ide/chats/` contain IDE metadata
- `ide/teleton-code/state.json` stores local IDE service state

## Auth Artifacts

The running service writes the current startup metadata to:

- `logs/current-auth-url.txt`
- `logs/current-runtime.json`

These files always describe the current running instance and should be preferred over old console logs.
