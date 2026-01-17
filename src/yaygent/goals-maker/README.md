# Goals Generator TUI (Bun)

Terminal-based application for generating `goals.json` files using LLM providers. Pure JavaScript, zero dependencies, runs on Bun.

## Requirements

- [Bun](https://bun.sh/) v1.0.0+

## Installation

```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Clone/download and run
bun run goals_generator.js
```

Or make executable:

```bash
chmod +x goals_generator.js
./goals_generator.js
```

## Usage

```bash
bun run start
```

Or directly:

```bash
bun goals_generator.js
```

## Features

- Zero external dependencies (uses Bun built-ins + native fetch)
- Interactive TUI with arrow key navigation
- Password masking for API key input
- Multiline text input for goals description
- Spinner animation during LLM calls
- JSON validation before saving

## Flow

1. **Select LLM Provider**: Arrow keys to navigate, Enter to select
2. **Configure Connection**: Enter API endpoint, model name, and API key
3. **Describe Goals**: Multiline input, type `.done` on new line to submit
4. **Generate**: LLM generates valid `goals.json`
5. **Save**: Review and save to file
6. **Post-Generation Menu**: Choose execution mode

## Post-Generation Options

After generating goals, you can:

| Option | Description |
|--------|-------------|
| **Run Agent** | Execute the pipeline with default settings |
| **Run Agent (Debug)** | Execute with verbose debug output |
| **Putter (Throttled)** | Slow execution with 5s delays to avoid rate limits |
| **Vigilant Mode** | Auto-retry workflow with error learning (up to 3 attempts) |
| **Add New Goals** | Generate additional goals to append |
| **Run Agent (Advanced)** | Launch full TUI for granular configuration |
| **Do Nothing** | Exit the application |

### Vigilant Mode

Vigilant mode automatically retries failed workflows by:

1. Running the pipeline in debug mode
2. On failure, collecting error logs from the output directory
3. Copying logs to context directory as `attempt-{N}-logs/`
4. Cloning the goals file with suffix `-attempt-{N}.json`
5. Injecting an "error-assessment" goal that:
   - Reviews error logs from the previous attempt
   - Creates notes with actionable suggestions
   - All other goals depend on this assessment
6. Retrying with the updated goals

Default: 3 retry attempts. Configurable via CLI: `--vigilant-attempts <n>`

## Supported Providers

| Provider | Default Endpoint | Default Model |
|----------|-----------------|---------------|
| Anthropic | `https://api.anthropic.com/v1/messages` | `claude-sonnet-4-20250514` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o` |
| Custom | User-defined | User-defined |

Custom providers assume OpenAI-compatible API format.

## Output Schema

```json
{
  "version": "1.0",
  "metadata": {
    "name": "string",
    "description": "string",
    "author": "AI Generated",
    "created": "ISO-8601 timestamp",
    "tags": ["string"]
  },
  "goals": [
    {
      "id": "kebab-case-id",
      "objective": "Clear statement",
      "priority": 1,
      "criteria": {
        "success": ["condition"],
        "acceptance": ["requirement"],
        "validation": "manual|automated|hybrid"
      },
      "constraints": ["limitation"],
      "dependencies": ["goal-id"],
      "context": {"key": "value"}
    }
  ],
  "globalContext": {"key": "value"}
}
```

## Keyboard Controls

| Key | Action |
|-----|--------|
| ↑/k | Move selection up |
| ↓/j | Move selection down |
| Enter | Confirm selection |
| Ctrl+C | Exit |

## Why Bun?

- Native TypeScript/JavaScript runtime
- Built-in fetch API
- Fast startup time
- No node_modules bloat for this use case
