# Goals Session Server

Session management server with REST API and MCP interfaces.

## Requirements

- Bun >= 1.0.0

## Install

```bash
bun install
```

## Start

```bash
bun start
```

Server runs on `http://localhost:3000`.

## Development

```bash
bun dev
```

Runs with file watching.

## Environment

```bash
export PORT=3000
export LLM_API_KEY=your-key
export LLM_MODEL=claude-sonnet-4-20250514
```

## Tools

The server registers these tools:

- notepad_create, notepad_write, notepad_read, notepad_list, notepad_delete
- code_editor
- file_create
- javascript_execute
- sqlite_create, database_execute, sql_runner
- http_request
- tcp_connect
- browser_request

Network tools require allowlist configuration in server.js.
