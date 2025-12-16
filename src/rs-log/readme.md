# Log Server CLI Tool

A simple Rust-based CLI tool that creates a localhost server to receive and log different types of payloads (JSON, ND-JSON, or plain strings).

## Features

- Configurable port
- Configurable log file path
- Supports multiple payload types:
  - JSON (`application/json`)
  - ND-JSON/JSON Lines (`application/x-ndjson` or `application/jsonlines`)
  - Plain strings (any other content type)
- Timestamped log entries
- Verbose logging mode

## Installation

```bash
cargo build --release
```

The binary will be available at `target/release/log-server`

## Usage

### Basic usage (default port 8080, log file `server.log`):
```bash
cargo run
```

### Custom port:
```bash
cargo run -- --port 3000
```

### Custom log file:
```bash
cargo run -- --log-file /tmp/my-app.log
```

### Enable verbose logging:
```bash
cargo run -- --verbose
```

### All options:
```bash
cargo run -- --port 9000 --log-file logs/app.log --verbose
```

### Help:
```bash
cargo run -- --help
```

## API

The server exposes a single endpoint:

**POST** `/log`

Send your payload with the appropriate `Content-Type` header.

## Examples

### 1. Send JSON payload:
```bash
curl -X POST http://localhost:8080/log \
  -H "Content-Type: application/json" \
  -d '{"event": "user_login", "user_id": 123, "timestamp": "2024-01-15T10:30:00Z"}'
```

### 2. Send ND-JSON payload:
```bash
curl -X POST http://localhost:8080/log \
  -H "Content-Type: application/x-ndjson" \
  -d '{"event": "page_view", "page": "/home"}
{"event": "click", "element": "button"}
{"event": "page_view", "page": "/about"}'
```

### 3. Send plain string:
```bash
curl -X POST http://localhost:8080/log \
  -H "Content-Type: text/plain" \
  -d 'This is a simple log message'
```

### 4. Multiple JSON objects (using echo and file):
```bash
# Create a file with multiple JSON lines
echo '{"id": 1, "action": "start"}' > data.ndjson
echo '{"id": 2, "action": "process"}' >> data.ndjson
echo '{"id": 3, "action": "complete"}' >> data.ndjson

# Send to server
curl -X POST http://localhost:8080/log \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @data.ndjson
```

## Log Format

Log entries are written with the following format:

```
[YYYY-MM-DD HH:MM:SS.mmm] [TYPE] <payload>
```

Example log file content:
```
[2024-01-15 14:23:45.123] [JSON] {
  "event": "user_login",
  "user_id": 123
}
[2024-01-15 14:23:46.456] [STRING] This is a simple log message
[2024-01-15 14:23:47.789] [ND-JSON] {"event":"page_view","page":"/home"}
          {"event":"click","element":"button"}
```

## Development

Run in development mode with verbose logging:
```bash
cargo run -- --verbose
```

Run tests:
```bash
cargo test
```

## Dependencies

- `tokio` - Async runtime
- `axum` - Web framework
- `clap` - CLI argument parsing
- `serde/serde_json` - JSON serialization
- `chrono` - Timestamp formatting
- `tracing` - Logging

## License

MIT