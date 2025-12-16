#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// -----------------------------
// Parse CLI arguments
// -----------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [key, val] = a.replace(/^--/, "").split("=");
    return [key, val];
  })
);

const filePath = args.file;
const contentType = args["content-type"] || "text/plain";
const port = args.port || 3000;

if (!filePath) {
  console.error("Error: --file=<path> is required");
  process.exit(1);
}

// Resolve absolute path
const resolved = path.resolve(filePath);

// Ensure file exists
if (!fs.existsSync(resolved)) {
  console.error(`Error: File not found: ${resolved}`);
  process.exit(1);
}

// -----------------------------
// Bun server source code (inline)
// -----------------------------
const bunServerCode = `
import { readFileSync } from "fs";

const filePath = ${JSON.stringify(resolved)};
const contentType = ${JSON.stringify(contentType)};

const data = readFileSync(filePath);

Bun.serve({
  port: ${port},
  fetch(req) {
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
      },
    });
  }
});

console.log("Serving", filePath, "as", contentType, "on port ${port}");
`;

// -----------------------------
// Spawn Bun server
// -----------------------------
const child = spawn("bun", ["run", "-"], { stdio: ["pipe", "inherit", "inherit"] });

// Write server code to Bun’s stdin
child.stdin.write(bunServerCode);
child.stdin.end();
