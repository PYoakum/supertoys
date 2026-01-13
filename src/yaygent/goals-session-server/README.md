# Goals Session Server

A dual-purpose server that receives goals and context, manages session state, and provides REST API and MCP interfaces for LLM-driven goal evaluation and task generation.

## Quick Start

```bash
# Set API key for LLM features
export LLM_API_KEY=your-api-key

# Start server
node server.js
# Server runs on http://localhost:3000
```

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions` | Create session with goals and context |
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id` | Get session details |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/evaluate` | Evaluate goals (LLM) |
| POST | `/api/tasklist/generate` | Generate task list (LLM) |
| GET | `/api/tools` | List available tools |
| GET | `/api/tools/:name` | Get tool details |
| GET | `/health` | Health check |

## Session States

`CREATED` → `LOADED` → `EVALUATED` → `GENERATED` → `COMPLETE`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `LLM_API_KEY` | - | LLM API key |
| `LLM_MODEL` | `claude-sonnet-4-20250514` | Model name |
| `LLM_ENDPOINT` | Anthropic API | API endpoint |

## Available Tools

- `notepad_create` - Create note file
- `notepad_write` - Write to note
- `notepad_read` - Read note
- `notepad_list` - List notes
- `notepad_delete` - Delete note

## License

MIT
