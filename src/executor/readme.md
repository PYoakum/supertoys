# CLI Executor

A powerful CLI tool built with Bun for running bash scripts and executables with flexible output handling. Send command output to files, remote endpoints, or stdout with full control over formatting and execution.

## Features

- ✅ Execute bash scripts, shell commands, and binary executables
- ✅ Save output to files
- ✅ Send output to remote HTTP/HTTPS endpoints
- ✅ JSON or plain text output formatting
- ✅ Configurable via CLI arguments or config files
- ✅ Custom HTTP headers and methods
- ✅ Execution timeout support
- ✅ Include/exclude stderr in output
- ✅ Built with Bun for maximum performance

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime installed

### Setup

```bash
# Clone or create the project
cd cli-executor

# Install dependencies
bun install

# Make the CLI executable globally (optional)
bun link
```

## Usage

### Basic Commands

```bash
# Run a command and print output
bun run src/index.ts echo "Hello, World!"

# Save output to a file
bun run src/index.ts -o output.txt ls -la

# Send output to a remote endpoint
bun run src/index.ts -e https://api.example.com/logs date

# Execute a bash script
bun run src/index.ts ./my-script.sh arg1 arg2
```

### Advanced Examples

#### JSON Output Format

```bash
# Output as JSON with metadata
bun run src/index.ts -o results.json -f json curl https://api.github.com
```

#### Custom HTTP Headers

```bash
# Send to endpoint with authentication
bun run src/index.ts \
  -e https://api.example.com/data \
  -m POST \
  -h "Authorization: Bearer YOUR_TOKEN" \
  -h "Content-Type: application/json" \
  -f json \
  ./script.sh
```

#### Using Config File

Create a `config.json`:

```json
{
  "endpoint": "https://api.example.com/logs",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer YOUR_TOKEN",
    "X-Custom-Header": "value"
  },
  "format": "json",
  "includeStderr": true,
  "timeout": 30000
}
```

Then run:

```bash
bun run src/index.ts -c config.json ./long-running-script.sh
```

#### Timeout Control

```bash
# Kill command if it runs longer than 5 seconds
bun run src/index.ts -t 5000 sleep 10
```

#### Include stderr in Output

```bash
# Capture both stdout and stderr
bun run src/index.ts --stderr -o full-output.txt ./script-with-errors.sh
```

## CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--output <file>` | `-o` | Write output to file | - |
| `--endpoint <url>` | `-e` | Send output to remote endpoint | - |
| `--method <method>` | `-m` | HTTP method for endpoint | POST |
| `--header <header>` | `-h` | Add HTTP header (repeatable) | - |
| `--config <file>` | `-c` | Load configuration from file | - |
| `--timeout <ms>` | `-t` | Execution timeout in milliseconds | - |
| `--format <format>` | `-f` | Output format: text, json | text |
| `--stderr` | - | Include stderr in output | false |
| `--no-trim` | - | Don't trim whitespace from output | false |
| `--version` | `-v` | Show version | - |
| `--help` | - | Show help message | - |

## Configuration File Format

```json
{
  "output": "output.txt",
  "endpoint": "https://api.example.com/webhook",
  "method": "PUT",
  "headers": {
    "Authorization": "Bearer token",
    "Custom-Header": "value"
  },
  "timeout": 30000,
  "format": "json",
  "includeStderr": true,
  "trim": true
}
```

**Note:** CLI arguments take precedence over config file values.

## Output Formats

### Text Format (default)

Plain text output from the command:

```
File content here
Line 2
Line 3
```

### JSON Format

Structured output with metadata:

```json
{
  "command": "ls -la",
  "exitCode": 0,
  "executionTime": 42,
  "stdout": "total 24\ndrwxr-xr-x...",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Building a Standalone Binary

```bash
# Compile to a single executable
bun run build

# Run the compiled binary
./cli-executor --help
```

## Example Scripts

### Basic Bash Script

Create `test.sh`:

```bash
#!/bin/bash
echo "Current date: $(date)"
echo "User: $USER"
ls -la
```

Run it:

```bash
chmod +x test.sh
bun run src/index.ts ./test.sh
```

### Sending Logs to a Webhook

```bash
bun run src/index.ts \
  -e https://hooks.example.com/webhook \
  -f json \
  -h "X-API-Key: secret" \
  ./deployment-script.sh
```

### Monitoring Script Output

```bash
# Save and send output simultaneously
bun run src/index.ts \
  -o deployment.log \
  -e https://monitoring.example.com/api/logs \
  -f json \
  ./deploy.sh
```

## Error Handling

- Non-zero exit codes are preserved and returned
- Stderr is logged to console by default (unless `--stderr` flag is used)
- Timeout errors are reported clearly
- HTTP errors include status codes and response bodies

## Development

```bash
# Run in development mode with auto-reload
bun run dev

# Run tests (when implemented)
bun test
```

bun run ./index.ts ./test-script.sh

bun run ./index.ts -o results.json -f json curl https://api.github.com
