# Bun Request Handler

A production-ready HTTP request handler for Bun that serves markdown content from SQL databases as rendered HTML.

## Features

- 🚀 **Fast**: Built specifically for Bun's performance
- 🔒 **Secure**: SQL injection prevention, HTML sanitization, rate limiting
- 📦 **Zero Config**: Works out of the box with sensible defaults
- ⚙️ **Configurable**: YAML-based configuration for customization
- 🔄 **Caching**: Built-in response caching with TTL
- 📡 **Streaming**: Support for streaming large datasets
- 🎨 **Templating**: Variable substitution with filters
- 🌐 **CORS**: Configurable cross-origin support

## Quick Start

### 1. Setup

```bash
# Run the setup script to create database and config
bun run setup.js
```

### 2. Start Server

```bash
# Start with defaults
bun run request-handler.js

# Or with custom settings
PORT=8080 bun run request-handler.js
```

### 3. Test It

```bash
# List posts
curl http://localhost:3000/api/posts

# Get single post
curl http://localhost:3000/api/posts/getting-started-with-bun

# With query params
curl "http://localhost:3000/api/posts?limit=5&orderBy=created_at&order=DESC"
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check & endpoint list |
| GET | `/api/posts` | List all published posts |
| GET | `/api/posts/:slug` | Get post by slug |
| GET | `/api/posts/:id` | Get post by ID |
| GET | `/api/posts/stream` | Stream all posts |
| GET | `/api/content/:table` | Generic content endpoint |

## Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `limit` | Max results to return | `?limit=10` |
| `offset` | Skip N results | `?offset=20` |
| `page` | Page number (with limit) | `?page=2&limit=10` |
| `orderBy` | Sort field | `?orderBy=created_at` |
| `order` | Sort direction | `?order=DESC` |
| `status` | Filter by status | `?status=published` |
| `author` | Filter by author | `?author=John` |
| `category` | Filter by category | `?category=tutorials` |
| `format` | Response format | `?format=json` |
| `pretty` | Pretty print HTML | `?pretty=true` |
| `nocache` | Bypass cache | `?nocache=true` |

## Configuration

### Environment Variables

```bash
# Server
PORT=3000
HOST=0.0.0.0

# Database
DB_PATH=./content.db
CONFIG_PATH=./config.yaml

# API
BASE_PATH=/api

# Caching
CACHE=true
CACHE_TTL=300

# Site Info
SITE_NAME=My Site
SITE_URL=http://localhost:3000

# Rate Limiting
RATE_LIMIT=false
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# Environment
NODE_ENV=development
```

### YAML Configuration

```yaml
# config.yaml

# Content transformations
overrides:
  - field: content
    from: "[PLACEHOLDER]"
    to: "Actual Value"
    global: true

# SQL Security
sqlSanitization:
  allowedTables:
    - posts
    - pages
  allowedColumns:
    - id
    - title
    - content
  maxLimit: 100

# HTML Security
htmlSanitization:
  allowedTags:
    - p
    - h1
    - h2
    - a
    - img
  allowedAttributes:
    a:
      - href
      - title
```

## Programmatic Usage

### Basic Usage

```javascript
import { startServer } from './request-handler.js';

await startServer({
  port: 3000,
  dbPath: './content.db',
  configPath: './config.yaml'
});
```

### With Existing Server

```javascript
import { createHandler } from './request-handler.js';

const handler = await createHandler({
  dbPath: './content.db',
  basePath: '/api'
});

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname.startsWith('/api')) {
      return handler.handle(req);
    }
    
    return new Response('Hello!');
  }
});
```

### Custom Filters

```javascript
import { createHandler } from './request-handler.js';

const handler = await createHandler({ dbPath: './content.db' });

// Register custom filter
handler.registerFilter('currency', (value, args) => {
  const currency = args?.[0] || 'USD';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(Number(value));
});

handler.start();

// Use in markdown: {{price | currency:"EUR"}}
```

## Built-in Filters

| Filter | Description | Example |
|--------|-------------|---------|
| `uppercase` | Convert to uppercase | `{{name \| uppercase}}` |
| `lowercase` | Convert to lowercase | `{{name \| lowercase}}` |
| `capitalize` | Capitalize first letter | `{{name \| capitalize}}` |
| `trim` | Remove whitespace | `{{text \| trim}}` |
| `truncate:N` | Truncate to N chars | `{{text \| truncate:100}}` |
| `date` | Format date | `{{created_at \| date}}` |
| `date:iso` | ISO format | `{{created_at \| date:iso}}` |
| `date:short` | Short format | `{{created_at \| date:short}}` |
| `escape` | HTML escape | `{{html \| escape}}` |
| `json` | JSON stringify | `{{obj \| json}}` |
| `default:val` | Default value | `{{name \| default:Anonymous}}` |
| `readingTime` | Estimated read time | `{{content \| readingTime}}` |
| `excerpt:N` | Generate excerpt | `{{content \| excerpt:150}}` |
| `slug` | URL-safe slug | `{{title \| slug}}` |
| `prettyDate` | Human-readable date | `{{created_at \| prettyDate}}` |

## Markdown Templates

Store markdown with template variables in your database:

```markdown
# {{title}}

*By {{author}} on {{created_at | prettyDate}}*

{{content}}

{{#if featured_image}}
![Featured]({{featured_image}})
{{/if}}

---

Tags: {{tags}}
© {{currentYear}} {{siteName}}
```

### Available Variables

| Variable | Description |
|----------|-------------|
| `siteName` | From config |
| `siteUrl` | From config |
| `currentYear` | Current year |
| `currentPath` | Request path |
| `requestTime` | Request timestamp |
| Plus all database columns... |

## Security

### SQL Injection Prevention

- Table/column whitelist validation
- Parameterized queries
- Input sanitization

### XSS Prevention

- HTML tag whitelist
- Attribute filtering
- Script/event handler removal
- javascript: URL blocking

### Rate Limiting

```javascript
await startServer({
  rateLimit: {
    enabled: true,
    maxRequests: 100,
    windowMs: 60000 // 1 minute
  }
});
```

## Caching

Built-in response caching with configurable TTL:

```javascript
await startServer({
  enableCache: true,
  cacheTTL: 300 // 5 minutes
});
```

Bypass cache with `?nocache=true` query parameter.

## Streaming

For large datasets, use the streaming endpoint:

```bash
curl http://localhost:3000/api/posts/stream
```

Or programmatically:

```javascript
const handler = await createHandler({ dbPath: './content.db' });

for (const html of handler.helper.queryStream({ table: 'posts' })) {
  console.log(html);
}
```

## Examples

See `usage-examples-handler.js` for comprehensive examples:

```bash
# Quick start
bun run usage-examples-handler.js quickstart

# Custom config
bun run usage-examples-handler.js config

# With authentication
bun run usage-examples-handler.js auth

# Full HTML pages
bun run usage-examples-handler.js fullpage

# Server-sent events
bun run usage-examples-handler.js sse

# Health checks
bun run usage-examples-handler.js health
```

## Files

| File | Description |
|------|-------------|
| `request-handler.js` | Main handler implementation |
| `setup.js` | Database & config setup script |
| `usage-examples-handler.js` | Usage examples |
| `config.yaml` | Configuration file |
| `content.db` | SQLite database |

## Requirements

- Bun 1.0+
- `yaml` package for config parsing

## License

MIT

## Contributing

Contributions welcome! Please ensure all tests pass before submitting PRs.