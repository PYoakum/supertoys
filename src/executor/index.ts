#!/usr/bin/env bun

import { parseArgs } from "util";
import { executeCommand } from "./executor";
import { handleOutput } from "./output.ts";
import { loadConfig } from "./config.ts";
import { version } from "./package.json";

const HELP_TEXT = `
CLI Executor - Run bash scripts and executables with flexible output handling

Usage: cli-executor [options] <command> [args...]

Options:
  -o, --output <file>       Write output to file
  -e, --endpoint <url>      Send output to remote endpoint
  -m, --method <method>     HTTP method for endpoint (default: POST)
  -h, --header <header>     Add HTTP header (format: "Key: Value")
  -c, --config <file>       Load configuration from file
  -t, --timeout <ms>        Execution timeout in milliseconds
  -f, --format <format>     Output format: text, json (default: text)
  --stderr                  Include stderr in output
  --no-trim                 Don't trim whitespace from output
  -v, --version             Show version
  --help                    Show this help message

Examples:
  # Run command and save to file
  cli-executor -o output.txt ls -la

  # Run script and send to endpoint
  cli-executor -e https://api.example.com/logs ./my-script.sh

  # Use config file
  cli-executor -c config.json ./script.sh

  # Complex example with headers
  cli-executor -e https://api.example.com/data -m PUT -h "Authorization: Bearer token" echo "Hello"
`;

async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        output: { type: "string", short: "o" },
        endpoint: { type: "string", short: "e" },
        method: { type: "string", short: "m", default: "POST" },
        header: { type: "string", short: "h", multiple: true },
        config: { type: "string", short: "c" },
        timeout: { type: "string", short: "t" },
        format: { type: "string", short: "f", default: "text" },
        stderr: { type: "boolean", default: false },
        "no-trim": { type: "boolean", default: false },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
    });

    if (values.help) {
      console.log(HELP_TEXT);
      process.exit(0);
    }

    if (values.version) {
      console.log(`v${version}`);
      process.exit(0);
    }

    if (positionals.length === 0) {
      console.error("Error: No command specified\n");
      console.log(HELP_TEXT);
      process.exit(1);
    }

    // Load config file if specified
    let config = values.config ? await loadConfig(values.config) : {};

    // CLI args override config file
    const options = {
      output: values.output || config.output,
      endpoint: values.endpoint || config.endpoint,
      method: (values.method || config.method || "POST").toUpperCase(),
      headers: parseHeaders(values.header || config.headers || []),
      timeout: values.timeout ? parseInt(values.timeout) : config.timeout,
      format: values.format || config.format || "text",
      includeStderr: values.stderr ?? config.includeStderr ?? false,
      trim: !values["no-trim"] && (config.trim ?? true),
    };

    const command = positionals[0];
    const args = positionals.slice(1);

    console.log(`Executing: ${command} ${args.join(" ")}`);

    // Execute the command
    const result = await executeCommand(command, args, {
      timeout: options.timeout,
      includeStderr: options.includeStderr,
    });

    // Handle the output
    await handleOutput(result, options);

    console.log("\n✓ Execution completed successfully");
    process.exit(result.exitCode);
  } catch (error) {
    console.error("\n✗ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseHeaders(headers: string | string[]): Record<string, string> {
  const headerArray = Array.isArray(headers) ? headers : [headers];
  const parsed: Record<string, string> = {};

  for (const header of headerArray) {
    const colonIndex = header.indexOf(":");
    if (colonIndex === -1) {
      console.warn(`Warning: Invalid header format "${header}", skipping`);
      continue;
    }
    const key = header.slice(0, colonIndex).trim();
    const value = header.slice(colonIndex + 1).trim();
    parsed[key] = value;
  }

  return parsed;
}

main();