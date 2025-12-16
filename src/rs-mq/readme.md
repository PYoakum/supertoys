# Message Queue Server - Rust CLI Tool

A fully-functional CLI tool written in Rust that creates a web application serving a message queue over HTTP with configurable logging.

## Quick Start

1. **Install Rust** (1.82 or newer):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Build the project**:
   ```bash
   cd mq-server
   cargo build --release
   ```

3. **Run the server**:
   ```bash
   ./target/release/mq-server
   ```

4. **Test it**:
   ```bash
   # In another terminal
   curl http://localhost:8080/health
   curl -X POST http://localhost:8080/enqueue \
     -H "Content-Type: application/json" \
     -d '{"payload": "Hello World!"}'
   curl http://localhost:8080/dequeue
   ```

## What's Included

### 📁 **mq-server/** - The complete project directory
- `src/main.rs` - Full source code (272 lines, well-commented)
- `Cargo.toml` - Dependency configuration
- `Dockerfile` - For containerized deployment

### 📖 Documentation (all in mq-server/)
- **PROJECT_OVERVIEW.md** - Start here! Complete project overview
- **README.md** - Full API documentation and user guide
- **QUICKSTART.md** - 5-minute getting started guide
- **ARCHITECTURE.md** - Technical design and internals
- **EXAMPLES.md** - Real-world configuration examples

### 🧪 Testing Scripts (all in mq-server/)
- **test_client.py** - Python test client with examples
- **examples.sh** - Bash script for testing all endpoints

### 📄 **mq-server-summary.txt** - Quick reference summary

## Features

✅ HTTP REST API for message queuing  
✅ Enqueue and dequeue operations (GET/POST)  
✅ Configurable port  
✅ Local logging (stdout)  
✅ Remote HTTP endpoint logging  
✅ Dual logging mode (local + remote)  
✅ JSON or plaintext log formats  
✅ Queue status monitoring  
✅ Health check endpoint  
✅ UUID message identifiers  
✅ Timestamps on all messages  
✅ Thread-safe async operations  
✅ Docker support  
✅ Comprehensive documentation  

## Usage Examples

```bash
# Basic usage
./mq-server

# Custom port
./mq-server --port 3000

# With HTTP logging
./mq-server --log-mode http --log-endpoint http://logs.example.com/ingest

# Full configuration
./mq-server \
  --port 9090 \
  --log-mode both \
  --log-endpoint http://logs.example.com/ingest \
  --log-format json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health check |
| `/enqueue` | POST | Add message to queue |
| `/dequeue` | GET/POST | Retrieve and remove message |
| `/status` | GET | Get current queue size |
| `/clear` | POST | Empty the entire queue |

## Technology Stack

- **Tokio** - Async runtime
- **Axum** - Web framework
- **Serde** - JSON serialization
- **Clap** - CLI parsing
- **Reqwest** - HTTP client for logging
- **Chrono** - Date/time handling
- **UUID** - Message identifiers

## Documentation Guide

1. **First time?** Read `PROJECT_OVERVIEW.md` in the mq-server directory
2. **Want to build and test?** Read `QUICKSTART.md`
3. **Need API details?** Read `README.md`
4. **Want example configs?** Read `EXAMPLES.md`
5. **Understanding the code?** Read `ARCHITECTURE.md`

## Need Help?

All documentation is in the `mq-server/` directory:
- Comprehensive API documentation
- Step-by-step guides
- Real-world examples
- Architecture explanations
- Testing instructions

## Notes

- Requires Rust 1.82 or newer
- In-memory queue (no persistence)
- Single server instance
- Great for development and testing
- Can be extended for production use

---

**Ready to start?** → Open `mq-server/PROJECT_OVERVIEW.md`

**Want to jump right in?** → Open `mq-server/QUICKSTART.md`