#!/usr/bin/env bun

/**
 * Bun mTLS HTTP Client CLI
 * Command-line tool for making HTTP requests with mutual TLS authentication
 */

import { parseArgs } from "util";
import { request } from "./lib";
import type { RequestOptions } from "./lib";

const VERSION = "1.0.0";

function printHelp() {
  console.log(`
Bun mTLS HTTP Client v${VERSION}

Usage: bmtls [options] <url>

HTTP Methods:
  -X, --method <METHOD>         HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, PURGE)
                                Default: GET

Request Body:
  -d, --data <DATA>             Request body (string or JSON)
  -f, --file <PATH>             Read request body from file
  --json <JSON>                 Send JSON data (sets Content-Type)

Headers:
  -H, --header <HEADER>         Add header (format: "Key: Value")
                                Can be used multiple times

mTLS Certificates:
  --cert <PATH|STRING>          Client certificate (PEM file path or PEM string)
  --key <PATH|STRING>           Client private key (PEM file path or PEM string)
  --ca <PATH|STRING>            CA certificate (PEM file path or PEM string)
  --passphrase <PASS>           Passphrase for encrypted private key

Options:
  -o, --output <FILE>           Write response to file
  -i, --include                 Include response headers in output
  -v, --verbose                 Verbose output
  -k, --insecure                Allow insecure SSL connections
  --timeout <MS>                Request timeout in milliseconds (default: 30000)
  --no-redirect                 Don't follow redirects
  -h, --help                    Show this help message
  --version                     Show version number

Examples:
  # Simple GET request
  bmtls https://api.example.com/users

  # POST with JSON data
  bmtls -X POST --json '{"name":"John"}' https://api.example.com/users

  # mTLS request
  bmtls --cert client.pem --key client-key.pem --ca ca.pem https://secure.example.com

  # PUT with file upload
  bmtls -X PUT -f data.json https://api.example.com/resource/123

  # Multiple headers
  bmtls -H "Authorization: Bearer token" -H "X-Custom: value" https://api.example.com

  # Save response to file
  bmtls https://api.example.com/data -o response.json
`);
}

function printVersion() {
  console.log(`bmtls version ${VERSION}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--version")) {
    printVersion();
    process.exit(0);
  }

  try {
    const parsed = parseArgs({
      args,
      options: {
        method: { type: "string", short: "X" },
        data: { type: "string", short: "d" },
        file: { type: "string", short: "f" },
        json: { type: "string" },
        header: { type: "string", short: "H", multiple: true },
        cert: { type: "string" },
        key: { type: "string" },
        ca: { type: "string" },
        passphrase: { type: "string" },
        output: { type: "string", short: "o" },
        include: { type: "boolean", short: "i" },
        verbose: { type: "boolean", short: "v" },
        insecure: { type: "boolean", short: "k" },
        timeout: { type: "string" },
        "no-redirect": { type: "boolean" },
      },
      allowPositionals: true,
    });

    const url = parsed.positionals[0];
    if (!url) {
      console.error("Error: URL is required");
      console.error("Run 'bmtls --help' for usage information");
      process.exit(1);
    }

    // Parse method
    const method = (parsed.values.method?.toUpperCase() || "GET") as RequestOptions["method"];
    const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "PURGE"];
    if (!validMethods.includes(method)) {
      console.error(`Error: Invalid method '${method}'. Valid methods: ${validMethods.join(", ")}`);
      process.exit(1);
    }

    // Parse headers
    const headers: Record<string, string> = {};
    if (parsed.values.header) {
      const headerArray = Array.isArray(parsed.values.header) 
        ? parsed.values.header 
        : [parsed.values.header];
      
      for (const header of headerArray) {
        const colonIndex = header.indexOf(":");
        if (colonIndex === -1) {
          console.error(`Error: Invalid header format '${header}'. Expected 'Key: Value'`);
          process.exit(1);
        }
        const key = header.substring(0, colonIndex).trim();
        const value = header.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    // Parse body
    let body: any = undefined;
    let bodyFromFile = false;

    if (parsed.values.json) {
      try {
        body = JSON.parse(parsed.values.json);
      } catch (error) {
        console.error(`Error: Invalid JSON in --json: ${error}`);
        process.exit(1);
      }
    } else if (parsed.values.file) {
      body = parsed.values.file;
      bodyFromFile = true;
    } else if (parsed.values.data) {
      // Try to parse as JSON, otherwise use as string
      try {
        body = JSON.parse(parsed.values.data);
      } catch {
        body = parsed.values.data;
      }
    }

    // Parse certificate config
    let cert = undefined;
    if (parsed.values.cert && parsed.values.key) {
      cert = {
        cert: parsed.values.cert,
        key: parsed.values.key,
        ca: parsed.values.ca,
        passphrase: parsed.values.passphrase,
      };
    } else if (parsed.values.cert || parsed.values.key) {
      console.error("Error: Both --cert and --key are required for mTLS");
      process.exit(1);
    }

    // Parse timeout
    const timeout = parsed.values.timeout ? parseInt(parsed.values.timeout) : 30000;
    if (isNaN(timeout)) {
      console.error(`Error: Invalid timeout value '${parsed.values.timeout}'`);
      process.exit(1);
    }

    // Parse redirect
    const redirect = parsed.values["no-redirect"] ? "error" : "follow";

    // Verbose output
    if (parsed.values.verbose) {
      console.error(`> ${method} ${url}`);
      if (cert) {
        console.error(`> Using mTLS with cert: ${cert.cert.substring(0, 50)}...`);
      }
      Object.entries(headers).forEach(([key, value]) => {
        console.error(`> ${key}: ${value}`);
      });
      if (body) {
        console.error(`> Body: ${typeof body === "string" ? body.substring(0, 100) : JSON.stringify(body).substring(0, 100)}...`);
      }
      console.error("");
    }

    // Make the request
    const startTime = performance.now();
    const response = await request(url, {
      method,
      headers,
      body,
      bodyFromFile,
      cert,
      timeout,
      redirect: redirect as "follow" | "error",
      rejectUnauthorized: !parsed.values.insecure,
    });
    const duration = performance.now() - startTime;

    // Verbose output
    if (parsed.values.verbose) {
      console.error(`< HTTP ${response.status} ${response.statusText}`);
      console.error(`< Time: ${duration.toFixed(2)}ms`);
      Object.entries(response.headers).forEach(([key, value]) => {
        console.error(`< ${key}: ${value}`);
      });
      console.error("");
    }

    // Prepare output
    let output = "";

    if (parsed.values.include) {
      output += `HTTP ${response.status} ${response.statusText}\n`;
      Object.entries(response.headers).forEach(([key, value]) => {
        output += `${key}: ${value}\n`;
      });
      output += "\n";
    }

    output += response.text;

    // Write output
    if (parsed.values.output) {
      await Bun.write(parsed.values.output, output);
      if (parsed.values.verbose) {
        console.error(`Response written to: ${parsed.values.output}`);
      }
    } else {
      console.log(output);
    }

    // Exit with status code
    process.exit(response.ok ? 0 : 1);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();