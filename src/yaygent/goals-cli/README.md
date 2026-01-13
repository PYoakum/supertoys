# Goals CLI

A command-line tool for goal-driven AI workflows with context management. Part of the Goals and Context Management System.

## Overview

Goals CLI orchestrates goal-driven AI workflows by:

1. Loading and validating goal definitions from a JSON file
2. Aggregating context from a directory of files
3. Connecting to a configured LLM endpoint
4. Executing the workflow and reporting results

## Installation

```bash
# Clone or copy the project
cd goals-cli

# No npm install needed - uses Bun built-in APIs
```

## Requirements

- Bun >= 1.0.0
- An LLM API key (Anthropic, OpenAI, or compatible endpoint)

## Quick Start

```bash
# Set your API key
export GOALS_API_KEY=your-api-key

# Run with goals and context
bun goals-cli.js --goals ./goals.json --context ./context/

# Dry run to validate without executing
bun goals-cli.js --goals ./goals.json --context ./context/ --dry-run
```

## Usage

```bash
bun goals-cli.js --goals <path> --context <path> [options]
```

### Required Arguments

| Argument | Alias | Description |
|----------|-------|-------------|
| `--goals` | `-g` | Path to the goals JSON file |
| `--context` | `-c` | Path to the context directory |

### Optional Arguments

| Argument | Alias | Default | Description |
|----------|-------|---------|-------------|
| `--config` | `-C` | `./configuration.js` | Path to configuration file |
| `--output` | `-o` | `stdout` | Output destination (file path or 'stdout') |
| `--format` | `-f` | `json` | Output format: json, markdown, text |
| `--verbose` | `-v` | `false` | Enable verbose logging to stderr |
| `--dry-run` | `-d` | `false` | Validate inputs without executing |
| `--help` | `-h` | - | Display help information |
| `--version` | `-V` | - | Display version information |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOALS_API_KEY` | API key for the LLM endpoint |
| `GOALS_API_URL` | Override endpoint URL from config |
| `GOALS_MODEL` | Override model name from config |
| `GOALS_CONFIG` | Path to configuration file |

## Goals File Format

Goals are defined in a JSON file with the following structure:

```json
{
  "version": "1.0",
  "metadata": {
    "name": "Project Goals",
    "description": "Description of the goals",
    "author": "author-name",
    "tags": ["tag1", "tag2"]
  },
  "goals": [
    {
      "id": "goal-id",
      "objective": "Clear statement of what should be accomplished",
      "priority": 1,
      "criteria": {
        "success": ["Criterion 1", "Criterion 2"],
        "acceptance": ["Minimum requirement"],
        "validation": "automated"
      },
      "constraints": ["Constraint 1"],
      "dependencies": ["other-goal-id"],
      "context": {
        "key": "value"
      }
    }
  ],
  "globalContext": {
    "key": "value"
  }
}
```

### Goal Properties

| Property | Required | Description |
|----------|----------|-------------|
| `id` | Yes | Unique identifier (kebab-case) |
| `objective` | Yes | What should be accomplished (min 10 chars) |
| `priority` | No | Priority level 1-10 (1=highest, default=5) |
| `criteria` | No | Success and acceptance criteria |
| `constraints` | No | Limitations or restrictions |
| `dependencies` | No | IDs of goals that must complete first |
| `context` | No | Goal-specific key-value pairs |

## Context Directory

The context directory can contain any text files that provide relevant information for the AI:

```
context/
├── requirements.md
├── notes.txt
├── api-spec.json
└── subdirectory/
    └── more-context.md
```

### Supported File Types

- Markdown (`.md`)
- Text (`.txt`)
- JSON (`.json`)
- JavaScript (`.js`)
- YAML (`.yaml`, `.yml`)
- HTML (`.html`)
- Any other text-based file

### Context Options

Configure context loading behavior via the configuration file:

```javascript
// In configuration.js
{
  contextOptions: {
    recursive: true,           // Traverse subdirectories
    extensions: ['*'],         // File extensions to include ('*' = all)
    exclude: ['node_modules'], // Patterns to exclude
    maxFileSize: 1048576,      // Max file size (1MB)
    maxTotalSize: 10485760     // Max total size (10MB)
  }
}
```

## Configuration

Create a `configuration.js` file to customize the CLI behavior:

```javascript
export default {
  endpoint: {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "anthropic-version": "2024-01-01"
    },
    timeout: 120000
  },

  auth: {
    type: "header",  // "bearer", "header", or "query"
    token: process.env.GOALS_API_KEY,
    headerName: "x-api-key"
  },

  model: {
    name: "claude-sonnet-4-20250514",
    parameters: {
      temperature: 0.7,
      maxTokens: 4096
    }
  },

  output: {
    defaultFormat: "json",
    prettyPrint: true
  },

  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2
  }
};
```

## Examples

### Basic Execution

```bash
bun goals-cli.js -g ./goals.json -c ./context/
```

### Save Output to File

```bash
bun goals-cli.js -g ./goals.json -c ./context/ -o result.json
```

### Markdown Output

```bash
bun goals-cli.js -g ./goals.json -c ./context/ -f markdown -o report.md
```

### Dry Run with Verbose Output

```bash
bun goals-cli.js -g ./examples/goals.json -c ./examples/context/ --dry-run --verbose
```

### Custom Configuration

```bash
bun goals-cli.js -g ./goals.json -c ./context/ -C ./my-config.js
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test test/goal-manager.test.js

# Run with coverage
bun test --coverage
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Validation error |
| 5 | API error |
| 10 | Interrupted (SIGINT) |

## Project Structure

```
goals-cli/
├── goals-cli.js          # Main CLI entry point
├── configuration.js      # Default configuration
├── package.json
├── README.md
│
├── lib/
│   ├── goal-manager.js      # Goal loading and validation
│   ├── context-loader.js    # Context file loading
│   ├── prompt-client.js     # LLM API client
│   ├── argument-parser.js   # CLI argument parsing
│   ├── output-formatter.js  # Output formatting
│   └── errors.js            # Custom error classes
│
├── schemas/
│   └── goals.schema.json    # JSON schema for validation
│
├── examples/
│   ├── goals.json
│   ├── configuration.js
│   └── context/
│
└── test/
    ├── goal-manager.test.js
    ├── context-loader.test.js
    ├── argument-parser.test.js
    └── fixtures/
```

## License

MIT
