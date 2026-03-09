# supertoys

A monorepo of composable developer tools built primarily on [Bun](https://bun.sh) and Rust. Each tool is self-contained under `src/` and designed to work standalone or be chained together via the **Commander** workflow runner.

## Prerequisites

- [Bun](https://bun.sh) (latest)
- [Rust/Cargo](https://rustup.rs) (for `rs-*` and `mtls-proxy` packages)
- [ImageMagick](https://imagemagick.org) (for `scrapbook`)
- [Python 3 + Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (for `puppet-reader` OCR features)

```bash
bun install
```

---

## Tools

### Workflow & Orchestration

| Tool | Description |
|------|-------------|
| [commander](#commander) | JSON-driven task runner with sequential, parallel, and conditional execution |
| [cli-scaffold](#cli-scaffold) | Universal CLI router that auto-maps arguments to exported functions |
| [executor](#executor) | Runs shell commands and routes output to files or HTTP endpoints |
| [js-cron](#js-cron) | Cron-based task scheduler with JSON configuration |

### Web Servers & Proxies

| Tool | Description |
|------|-------------|
| [croupier](#croupier) | Static file server with range requests, directory listing, and CORS |
| [microserver](#microserver) | Serves a single file over HTTP |
| [js-proxy](#js-proxy) | YAML-configured reverse proxy with routing rules |
| [picocache](#picocache) | Caching HTTP proxy with TTL and rule-based invalidation |
| [api-router](#api-router) | File-based API route generator with dynamic parameters |
| [webhook](#webhook) | Webhook provisioning server with payload validation and forwarding |
| [http-testing](#http-testing) | Test server with echo, hash, and header inspection endpoints |

### Data Conversion & Transformation

| Tool | Description |
|------|-------------|
| [csv2json-cli](#csv2json-cli) | CSV to JSON converter with multiple output formats |
| [csv2json2sql](#csv2json2sql) | Server with bidirectional CSV/JSON and CSV-to-SQL conversion |
| [html2csv](#html2csv) | Extracts HTML elements into CSV |
| [html2md](#html2md) | Bidirectional HTML/Markdown converter |
| [md2html](#md2html) | Markdown to HTML renderer with tokenizer and AST |
| [md2json](#md2json) | Bidirectional Markdown/JSON AST converter |
| [json-xtractor](#json-xtractor) | Extracts key values from JSON arrays to text |
| [yaml2html](#yaml2html) | Converts YAML to styled HTML documents |
| [str-replacer](#str-replacer) | Applies configured string replacements to files |

### Content & Publishing

| Tool | Description |
|------|-------------|
| [minipress](#minipress) | Generates HTML documents from JSON/JS config with content blocks |
| [md-handler](#md-handler) | Serves markdown from SQLite as rendered HTML with caching |
| [no-js](#no-js) | Server-rendered HTML pages without client-side JavaScript |
| [tablemaker](#tablemaker) | <!-- TODO: Add description --> |
| [webedit](#webedit) | <!-- TODO: Add description --> |

### Networking & Security

| Tool | Description |
|------|-------------|
| [mtls](#mtls) | Mutual TLS client (TypeScript) and proxy server (Rust) |
| [auth-tools](#auth-tools) | JWT authentication library with pluggable user stores |
| [ws-tools](#ws-tools) | WebSocket server with broadcasting and HTTP-triggered messages |
| [js-cypher](#js-cypher) | Encoding, hashing, and HMAC operations CLI |

### Storage & Data

| Tool | Description |
|------|-------------|
| [rs-stor](#rs-stor) | Preallocated key-value store with REST API (Rust) |
| [rs-mq](#rs-mq) | Message queue server with REST API (Rust) |
| [rs-log](#rs-log) | Log ingestion server with local and remote output (Rust) |
| [sql-crud-tools](#sql-crud-tools) | YAML-configured PostgreSQL CRUD helpers |

### Scraping & File Utilities

| Tool | Description |
|------|-------------|
| [puppet-reader](#puppet-reader) | Puppeteer-based web scraper with OCR text extraction |
| [caravan](#caravan) | POSTs file contents to an endpoint and saves the response |
| [dirmap](#dirmap) | Generates YAML directory manifests with file previews |
| [scrapbook](#scrapbook) | ImageMagick-powered image manipulation CLI |

### Virtual Machines & Terminal

| Tool | Description |
|------|-------------|
| [js-vm](#js-vm) | x86 virtual machine emulator (v86) with multiple OS images |
| [js-term](#js-term) | xterm.js terminal interface with WebSocket VM connectivity |
| [js-tui](#js-tui) | Terminal UI framework with routing, screens, and components |

### Rust Utilities

| Tool | Description |
|------|-------------|
| [rs-h2md](#rs-h2md) | Bidirectional HTML/Markdown converter (Rust) |

---

## Tool Details

### commander

JSON-driven task runner that executes commands sequentially, in parallel, or conditionally with success/failure branching.

```bash
bun run commander -- -c workflow.json [--verbose] [--dry-run]
```

<details>
<summary>Example workflow</summary>

```json
{
  "name": "Web Crawl and Data Extraction Pipeline",
  "version": "1.0",
  "tasks": [
    {
      "name": "Crawl Website",
      "command": "bun",
      "args": ["run", "crawl", "--url", "http://localhost:3001/", "--mode", "dir", "--out", "./dist/data"]
    },
    {
      "name": "Convert HTML to CSV",
      "command": "bun",
      "args": ["run", "h2c", "dist/data/index.html", "-o", "dist/data/result.csv"]
    },
    {
      "name": "Convert CSV to JSON",
      "command": "bun",
      "args": ["run", "c2j", "--input", "dist/data/result.csv", "--output", "dist/data/result.json"]
    }
  ]
}
```
</details>

### cli-scaffold

Universal CLI router that maps positional arguments to exported functions from a `commands.ts` module.

```bash
bun run cli.ts <command> [args] [--flag=value]
```

### executor

Runs shell commands and routes stdout to files, HTTP endpoints, or both. Supports JSON/text formatting and config files.

```bash
bun run executor -- <command> [args] [-o output.txt] [-e http://endpoint] [-f json]
```

### js-cron

Cron-based task scheduler. Define schedules in a JSON config file with enable/disable toggles and async task support.

```bash
bun run src/js-cron/scheduler.ts [config.json]
```

### croupier

Static file server with HTTP 206 range request support for streaming, directory listing, configurable caching, and CORS.

```bash
bun run src/croupier/server.ts [-p 3000] [-d ./public] [--cors] [-l]
```

### microserver

Serves a single file over HTTP with configurable content type.

```bash
bun run micro --file=dist/data/result.txt [--content-type=text/plain] [--port=3000]
```

### js-proxy

YAML-configured reverse proxy with routing rules, static responses, header manipulation, and status-based fallbacks.

```bash
bun run src/js-proxy/src/server.js
```

### picocache

Caching HTTP proxy with LRU eviction, per-rule TTL, and rule-based cache invalidation. Configured via YAML.

```bash
bun run src/picocache/server.ts
```

### api-router

Generates file-based API routes from a directory structure. Maps file paths to HTTP endpoints with dynamic parameter extraction (e.g., `api/users/[id].js` maps to `/users/:id`).

```js
import { createRouter } from "./src/api-router/api-router.ts";
const router = createRouter({ dir: "./api", prefix: "/api" });
```

### webhook

Provisions dynamic webhook URLs with UUID identifiers, validates JSON payloads, forwards to configured endpoints, and provides message polling.

```bash
bun run src/webhook/server.ts
# Env: HOOK_PORT, FORWARD_URL, ALLOW_ORIGIN
```

### http-testing

Test server with endpoints for echo, MD5 hashing, and header inspection.

```bash
bun run src/http-testing/test-req.js
# Routes: /echo, /hash (POST), /headers (GET)
```

### csv2json-cli

Converts CSV files to JSON with support for array, object, and records output formats.

```bash
bun run c2j --input data.csv --output data.json [--format records] [--pretty] [--delimiter ";"]
```

### csv2json2sql

Server providing bidirectional CSV/JSON conversion and CSV-to-SQL generation with dialect support (SQLite, PostgreSQL, MySQL).

```bash
bun run src/csv2json2sql/csv2json2sql.ts [--port 3000]
# POST /convert (CSV→JSON), /to-csv (JSON→CSV), /to-sql?table=name&dialect=postgres
```

### html2csv

Parses HTML and extracts all elements into CSV with columns for tag, classes, ID, attributes, and content.

```bash
bun run h2c input.html [-o output.csv]
```

### html2md

Bidirectional HTML/Markdown converter. Automatically detects input format from file extension.

```bash
bun run src/html2md/html2md.ts input.html [-o output.md]
bun run src/html2md/html2md.ts input.md [-o output.html]
```

### md2html

Markdown-to-HTML renderer with a three-stage pipeline: tokenizer, AST parser, and HTML renderer. Supports sanitization and code highlighting.

```js
import { markdownToHtml } from "./src/md2html/index.ts";
const html = markdownToHtml(markdown, { sanitize: true, highlightCode: true });
```

### md2json

Bidirectional Markdown/JSON AST converter with support for headings, lists, code blocks, blockquotes, and inline formatting.

```js
import { markdownToJson, jsonToMarkdown } from "./src/md2json/markdown-to-json.js";
```

### json-xtractor

Extracts values for a specified key from a JSON array and writes them line-by-line to a text file.

```bash
bun run xtractor --input data.json --array data --key Content --output result.txt
```

### yaml2html

Converts YAML documents to styled HTML with CSS.

```bash
bun run src/yaml2html/cli.ts input.yaml [-o output.html]
```

### str-replacer

Applies character sequence replacements from a JSON config file to input files.

```bash
bun run src/str-replacer/index.js -i input.txt -c replacements.json [-o output.txt]
```

### minipress

Generates HTML documents from JSON/JavaScript configuration with content blocks (markdown, tables, images, video, iframes, canvas).

```bash
bun run src/minipress/src/cli.js input.json [-o output.html] [--title "Page Title"] [--pretty]
```

### md-handler

HTTP request handler that serves markdown content from SQLite databases as rendered HTML with templating and caching.

```bash
DB_PATH=content.db bun run src/md-handler/md-req-handler.js
```

### no-js

Server that renders HTML pages entirely server-side with no client-side JavaScript.

```bash
bun run src/no-js/server.js
```

### tablemaker

<!-- TODO: Add description and usage -->

### webedit

<!-- TODO: Add description and usage -->

### mtls

Mutual TLS toolkit with two components:

- **mtls-client** (TypeScript/Bun) -- CLI for making mTLS-authenticated HTTP requests
- **mtls-proxy** (Rust) -- Reverse proxy that terminates and enforces mutual TLS

```bash
# Client
bun run src/mtls/mtls-client/cli.ts --cert client.pem --key client-key.pem --ca ca.pem https://example.com

# Proxy (build with cargo)
cd src/mtls/mtls-proxy && cargo run -- -l 0.0.0.0:8443 -u http://backend:3000 -c server.pem -k server-key.pem
```

### auth-tools

Authentication library for Bun providing JWT management, account creation/confirmation, and pluggable user stores (SQLite, Redis, HTTP).

```js
import { createAuthHelpers, SecretManager } from "./src/auth-tools/index.ts";
```

### ws-tools

WebSocket server with client broadcasting and HTTP-triggered message endpoints.

```bash
bun run src/ws-tools/ws-server.ts
# HTTP triggers: /send/start, /send/restart
```

### js-cypher

Encoding, hashing, and HMAC CLI supporting base64, hex, MD5, SHA, and HMAC operations.

```bash
bun run src/js-cypher/cli.ts -a sha256 -o encode -i "hello world"
bun run src/js-cypher/cli.ts -a hmac-sha256 -k secret -i "message"
```

### rs-stor

Preallocated key-value store with REST API, memory-bounded storage, and real-time memory statistics.

```bash
cd src/rs-stor && cargo run -- [-c 10485760] [-p 3000]
```

### rs-mq

Message queue server with REST API for enqueue/dequeue, health checks, and configurable logging.

```bash
cd src/rs-mq && cargo run -- [--port 8080] [--log-mode local]
```

### rs-log

Log ingestion server that receives JSON, ND-JSON, and plain text payloads with local and remote forwarding.

```bash
cd src/rs-log && cargo run -- [--port 8080] [--log-file app.log] [--verbose]
```

### sql-crud-tools

YAML-configured TypeScript helpers for PostgreSQL CRUD operations with automatic database/table initialization.

```bash
bun run init  # Initialize from YAML config
```

```js
import { createCrud } from "./src/sql-crud-tools/index.ts";
```

### puppet-reader

Puppeteer-based web scraper that captures full-page screenshots and extracts text via Tesseract OCR. Also includes a crawl server for programmatic scraping.

```bash
# CLI scraper
bun run src/puppet-reader/index.ts -u https://example.com -o ./output

# Crawl server
bun run crawl-server
curl -X POST http://localhost:3005/assets \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"json"}'

# CLI-only crawl
bun run crawl --url https://example.com --mode dir --out ./dist/data
```

### caravan

POSTs file contents to an API endpoint and writes the response to an output file.

```bash
bun run caravan.ts --input data.csv --endpoint http://localhost:3000/convert --output result.json
```

### dirmap

Generates a YAML manifest of a directory structure with file previews and metadata. Can output to file or POST to a webhook.

```bash
bun run src/dirmap/dirmap.ts ./my-project [-o manifest.yaml] [-w http://webhook-endpoint]
```

### scrapbook

ImageMagick-powered image manipulation CLI with crop, rotate, scale, watermark, blur, grayscale, sepia, and more.

```bash
bun run src/scrapbook/scrapbook.ts -i photo.jpg -o out.jpg --scale 800x600 --watermark-text "Draft"
```

### js-vm

x86 virtual machine emulator using [v86](https://github.com/nicknisi/v86) with pre-configured OS images (Arch Linux, FreeDOS, Windows 1.01, KolibriOS) and WebSocket networking.

```bash
bun run src/js-vm/server.js
# Open browser to http://localhost:3000?vm=arch
```

### js-term

Terminal interface using xterm.js with WebSocket connectivity for VM interaction.

```bash
bun run src/js-term/server.js
# WebSocket: /ws?vm=<id>
```

### js-tui

Terminal UI framework for building interactive CLI applications with routing, screens, color support, and reusable components.

```bash
bun run src/js-tui/src/index.js
```

### rs-h2md

Bidirectional HTML/Markdown converter written in Rust.

```bash
cd src/rs-h2md && cargo run -- input.html [-o output.md]
```

---

## NPM Scripts

| Script | Tool | Description |
|--------|------|-------------|
| `bun run api-router` | api-router | File-based API route generator |
| `bun run auth-tools` | auth-tools | JWT authentication server |
| `bun run caravan` | caravan | POST file contents to an endpoint |
| `bun run cli-scaffold` | cli-scaffold | Universal CLI router |
| `bun run commander` | commander | JSON-driven task runner |
| `bun run croupier` | croupier | Static file server |
| `bun run c2j` | csv2json-cli | Convert CSV to JSON |
| `bun run csv2json2sql` | csv2json2sql | CSV/JSON/SQL conversion server |
| `bun run dirmap` | dirmap | Directory manifest generator |
| `bun run executor` | executor | Shell command runner with output routing |
| `bun run h2c` | html2csv | Convert HTML to CSV |
| `bun run html2md` | html2md | Bidirectional HTML/Markdown converter |
| `bun run http-test` | http-testing | Test server with echo/hash endpoints |
| `bun run ipsum` | ipsum-cli | Lorem ipsum generator CLI |
| `bun run js-cron` | js-cron | Cron-based task scheduler |
| `bun run js-cypher` | js-cypher | Encoding, hashing, and HMAC CLI |
| `bun run js-proxy` | js-proxy | YAML-configured reverse proxy |
| `bun run js-term` | js-term | xterm.js terminal interface |
| `bun run js-tui` | js-tui | Terminal UI framework |
| `bun run js-vm` | js-vm | x86 virtual machine emulator |
| `bun run xtractor` | json-xtractor | Extract JSON values to text |
| `bun run md-handler` | md-handler | Serve markdown from SQLite as HTML |
| `bun run md2html` | md2html | Markdown to HTML renderer |
| `bun run md2json` | md2json | Bidirectional Markdown/JSON converter |
| `bun run micro` | microserver | Serve a single file over HTTP |
| `bun run minipress` | minipress | HTML document generator from JSON config |
| `bun run no-js` | no-js | Server-rendered HTML pages |
| `bun run picocache` | picocache | Caching HTTP proxy |
| `bun run crawl` | puppet-reader | Puppeteer crawl CLI |
| `bun run crawl-server` | puppet-reader | Crawl server for programmatic scraping |
| `bun run scrapbook` | scrapbook | ImageMagick image manipulation CLI |
| `bun run sql-crud` | sql-crud-tools | PostgreSQL CRUD helpers |
| `bun run str-replacer` | str-replacer | String replacement tool |
| `bun run tablemaker` | tablemaker | Table generation server |
| `bun run webedit` | webedit | Web editor server |
| `bun run webhook` | webhook | Webhook provisioning server |
| `bun run ws-tools` | ws-tools | WebSocket server |
| `bun run yaml2html` | yaml2html | YAML to HTML converter |

## License

<!-- TODO: Add license -->
