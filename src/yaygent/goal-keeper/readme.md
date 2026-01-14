# Goal Keeper Service

An intermediary service that bridges the Goals CLI and Session Server by watching a directory for goals files and automatically triggering session creation and task list generation.

## Overview

The Goal Keeper service:
1. **Polls** a directory for new goals JSON files
2. **Validates** the goals file structure
3. **Loads** optional context files from adjacent directory
4. **Creates** a session on the Goals Session Server
5. **Triggers** goal evaluation and task list generation
6. **Moves** processed files to organized directories

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Goals CLI  │────▶│  Goal Keeper  │────▶│ Session Server  │
│             │     │    (polling)    │     │                 │
│ goals.json  │     │                 │     │ POST /sessions  │
│ + context/  │     │  - Detect       │     │ POST /evaluate  │
│             │     │  - Validate     │     │ POST /generate  │
└─────────────┘     │  - Process      │     └─────────────────┘
                    └─────────────────┘
```

## Installation

```bash
cd goal-keeper
# No dependencies to install (uses Node.js built-ins)
```

## Quick Start

```bash
# Start the session server first
cd ../goals-session-server && node server.js &

# Start the keeper
node goal-keeper.js --watch ./inbox

# Drop a goals file into ./inbox and watch it get processed
```

## Command Line Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `--watch` | `-w` | `./watch` | Directory to watch |
| `--server` | `-s` | `http://localhost:3000` | Session server URL |
| `--poll-interval` | `-p` | `2000` | Polling interval (ms) |
| `--verbose` | `-v` | `false` | Enable verbose logging |
| `--dry-run` | `-d` | `false` | Validate without server calls |
| `--no-move` | | `false` | Don't move processed files |
| `--help` | `-h` | | Show help |
| `--version` | `-V` | | Show version |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCH_PATH` | `./watch` | Directory to watch |
| `SESSION_SERVER_URL` | `http://localhost:3000` | Session server URL |
| `POLL_INTERVAL` | `2000` | Polling interval (ms) |
| `STABILITY_THRESHOLD` | `3000` | Time file must be stable (ms) |
| `MOVE_PROCESSED` | `true` | Move files after processing |
| `INCLUDE_CONTEXT` | `true` | Look for context directory |
| `LOG_LEVEL` | `info` | Logging level |

## Directory Structure

### Input Structure

```
watch/
├── my-project.json           # Goals file (required)
└── context/                  # Context directory (optional)
    ├── requirements.md
    ├── design-notes.txt
    └── api-spec.json
```

The watcher also supports goals-specific context directories:

```
watch/
├── my-project.json
└── my-project-context/       # Named after the goals file
    └── ...
```

### Output Structure

After processing, files are organized:

```
watch/
├── _processed/               # Successfully processed
│   ├── 2025-01-13T10-30-00_my-project.json
│   └── 2025-01-13T10-30-00_my-project_result.json
│
├── _failed/                  # Failed processing
│   ├── 2025-01-13T10-35-00_bad-goals.json
│   └── 2025-01-13T10-35-00_bad-goals_error.json
│
└── context/                  # Context stays in place
```

## Goals File Format

The watcher expects goals files in this format:

```json
{
  "version": "1.0",
  "metadata": {
    "name": "My Project Goals",
    "description": "Optional description"
  },
  "goals": [
    {
      "id": "goal-1",
      "objective": "Implement user authentication",
      "priority": 1,
      "criteria": {
        "success": ["Users can log in", "Sessions are secure"]
      },
      "constraints": ["Use bcrypt for passwords"]
    }
  ],
  "globalContext": {
    "projectName": "MyApp"
  }
}
```

### Required Fields
- `version` - Schema version (e.g., "1.0")
- `goals` - Array with at least one goal
  - `id` - Unique goal identifier
  - `objective` - Goal description

## Processing Pipeline

When a goals file is detected:

1. **Detection** - File appears in watch directory
2. **Stability** - Wait for file to stop changing (3s default)
3. **Validation** - Parse JSON and validate structure
4. **Context Loading** - Load adjacent context files
5. **Session Creation** - POST to `/api/sessions`
6. **Goal Evaluation** - POST to `/api/evaluate`
7. **Task Generation** - POST to `/api/tasklist/generate`
8. **Completion** - Move to `_processed/` with result

## Usage Examples

```bash
# Basic usage
node goal-keeper.js --watch ./inbox

# Custom server and verbose logging
node goal-keeper.js -w ./goals-inbox -s http://server:3000 -v

# Dry run to test validation
node goal-keeper.js -w ./inbox --dry-run

# Keep files in place (don't move)
node goal-keeper.js -w ./inbox --no-move

# Fast polling (500ms)
node goal-keeper.js -w ./inbox -p 500
```

## Integration with Goals CLI

Output from Goals CLI can be directed to the watch directory:

```bash
# Using Goals CLI to create goals file
node ../goals-cli/goals-cli.js \
  --goals ./my-goals.json \
  --context ./my-context/ \
  --output ./watch/project-goals.json

# The watcher will automatically pick it up
```

## Error Handling

### Validation Errors
Files that fail validation are moved to `_failed/` with an error report:

```json
{
  "originalPath": "./watch/bad-goals.json",
  "error": {
    "name": "FileValidationError",
    "message": "Goals validation failed: missing required field 'id'",
    "code": "FILE_VALIDATION_ERROR"
  },
  "failedAt": "2025-01-13T10:35:00Z"
}
```

### Server Errors
If the session server is unreachable or returns errors, the file is moved to `_failed/` and can be reprocessed by moving it back to the watch directory.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Clean shutdown |
| 1 | Fatal error |
| 2 | Invalid arguments |

## License

MIT