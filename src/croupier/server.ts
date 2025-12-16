#!/usr/bin/env bun

import { parseArgs } from "util";
import { resolve, extname, join } from "path";
import { stat, readdir } from "fs/promises";
import { existsSync } from "fs";

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

interface ServerConfig {
  port: number;
  host: string;
  dir: string;
  cors: boolean;
  cache: number;
  headers: Record<string, string>;
  index: string;
  verbose: boolean;
  list: boolean;
}

function parseCliArgs(): ServerConfig {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p", default: "3000" },
      host: { type: "string", short: "h", default: "localhost" },
      dir: { type: "string", short: "d", default: "." },
      cors: { type: "boolean", default: false },
      cache: { type: "string", short: "c", default: "3600" },
      header: { type: "string", multiple: true },
      index: { type: "string", short: "i", default: "index.html" },
      verbose: { type: "boolean", short: "v", default: false },
      list: { type: "boolean", short: "l", default: false },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  // Parse custom headers
  const headers: Record<string, string> = {};
  if (values.header) {
    for (const header of values.header) {
      const [key, ...valueParts] = header.split(":");
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join(":").trim();
      }
    }
  }

  return {
    port: parseInt(values.port as string),
    host: values.host as string,
    dir: resolve(values.dir as string),
    cors: values.cors as boolean,
    cache: parseInt(values.cache as string),
    headers,
    index: values.index as string,
    verbose: values.verbose as boolean,
    list: values.list as boolean,
  };
}

function printHelp() {
  console.log(`
Bun Static Server - A fast static file server with range request support

USAGE:
  bun server.ts [OPTIONS]

OPTIONS:
  -p, --port <number>       Port to listen on (default: 3000)
  -h, --host <string>       Host to bind to (default: localhost)
  -d, --dir <path>          Directory to serve files from (default: .)
  -i, --index <filename>    Index file name (default: index.html)
  -c, --cache <seconds>     Cache-Control max-age in seconds (default: 3600)
      --cors                Enable CORS headers
      --header <name:value> Add custom header (can be used multiple times)
  -v, --verbose             Enable verbose logging
  -l, --list                Enable directory listing
      --help                Show this help message

EXAMPLES:
  # Serve current directory on port 3000
  bun server.ts

  # Serve specific directory with CORS enabled
  bun server.ts -d ./public --cors

  # Custom port and host with headers
  bun server.ts -p 8080 -h 0.0.0.0 --header "X-Custom:Value"

  # Enable directory listing and verbose logging
  bun server.ts -l -v -d ./assets

  # Disable caching
  bun server.ts -c 0
`);
}

function getMimeType(filepath: string): string {
  const ext = extname(filepath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function generateDirectoryListing(dirPath: string, requestPath: string): Promise<string> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  
  const items = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      const stats = await stat(fullPath);
      const size = entry.isDirectory() ? "-" : formatBytes(stats.size);
      const type = entry.isDirectory() ? "📁" : "📄";
      const href = join(requestPath, entry.name);
      
      return { name: entry.name, type, size, href, isDir: entry.isDirectory() };
    })
  );

  // Sort: directories first, then files, alphabetically
  items.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });

  const rows = items.map(item => 
    `<tr>
      <td>${item.type} <a href="${item.href}">${item.name}${item.isDir ? '/' : ''}</a></td>
      <td>${item.size}</td>
    </tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Directory listing: ${requestPath}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 40px auto; padding: 0 20px; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:hover { background: #f9f9f9; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>📂 Directory: ${requestPath}</h1>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Size</th>
      </tr>
    </thead>
    <tbody>
      ${requestPath !== '/' ? '<tr><td>📁 <a href="../">../</a></td><td>-</td></tr>' : ''}
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return null;

  const start = parseInt(match[1]);
  const end = match[2] ? parseInt(match[2]) : fileSize - 1;

  if (start >= fileSize || end >= fileSize || start > end) {
    return null;
  }

  return { start, end };
}

async function serveFile(
  filepath: string,
  request: Request,
  config: ServerConfig
): Promise<Response> {
  const file = Bun.file(filepath);
  const stats = await stat(filepath);
  const fileSize = stats.size;
  const mimeType = getMimeType(filepath);

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Last-Modified": stats.mtime.toUTCString(),
    ...config.headers,
  };

  // Add cache headers
  if (config.cache > 0) {
    headers["Cache-Control"] = `public, max-age=${config.cache}`;
  } else {
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  }

  // Add CORS headers
  if (config.cors) {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Range";
  }

  // Handle range requests
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, fileSize);
    
    if (!range) {
      return new Response("Invalid range", {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileSize}`,
        },
      });
    }

    const { start, end } = range;
    const contentLength = end - start + 1;
    const stream = file.slice(start, end + 1).stream();

    headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
    headers["Content-Length"] = contentLength.toString();

    return new Response(stream, {
      status: 206,
      headers,
    });
  }

  // Serve full file
  headers["Content-Length"] = fileSize.toString();
  return new Response(file, { status: 200, headers });
}

async function handleRequest(request: Request, config: ServerConfig): Promise<Response> {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);

  // Security: prevent directory traversal
  if (pathname.includes("..")) {
    return new Response("Forbidden", { status: 403 });
  }

  // Handle OPTIONS for CORS preflight
  if (request.method === "OPTIONS" && config.cors) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
      },
    });
  }

  // Only allow GET and HEAD
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Normalize path
  if (pathname.endsWith("/")) {
    pathname += config.index;
  }

  const filepath = join(config.dir, pathname);

  // Check if file exists
  if (!existsSync(filepath)) {
    return new Response("Not Found", { status: 404 });
  }

  const stats = await stat(filepath);

  // Handle directory
  if (stats.isDirectory()) {
    const indexPath = join(filepath, config.index);
    
    if (existsSync(indexPath)) {
      return serveFile(indexPath, request, config);
    }
    
    if (config.list) {
      const html = await generateDirectoryListing(filepath, pathname);
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          ...(config.cors ? { "Access-Control-Allow-Origin": "*" } : {}),
        },
      });
    }
    
    return new Response("Forbidden", { status: 403 });
  }

  // Serve file
  return serveFile(filepath, request, config);
}

async function main() {
  const config = parseCliArgs();

  // Validate directory
  if (!existsSync(config.dir)) {
    console.error(`❌ Error: Directory does not exist: ${config.dir}`);
    process.exit(1);
  }

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    async fetch(request) {
      const start = Date.now();
      const response = await handleRequest(request, config);
      const duration = Date.now() - start;

      if (config.verbose) {
        const url = new URL(request.url);
        console.log(
          `${request.method} ${url.pathname} → ${response.status} (${duration}ms)`
        );
      }

      return response;
    },
  });

  console.log(`
🚀 Static server running!

  Local:    http://${config.host}:${config.port}
  Network:  http://${config.host === 'localhost' ? 'your-ip' : config.host}:${config.port}

  Serving:  ${config.dir}
  CORS:     ${config.cors ? '✓ enabled' : '✗ disabled'}
  Caching:  ${config.cache > 0 ? `${config.cache}s` : 'disabled'}
  Listing:  ${config.list ? '✓ enabled' : '✗ disabled'}

Press Ctrl+C to stop
`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
