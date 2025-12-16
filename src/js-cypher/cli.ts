#!/usr/bin/env bun

import { parseArgs } from "util";
import { createHash, createHmac } from "crypto";
import { readFileSync, writeFileSync } from "fs";

const ALGORITHMS = {
  // Encoding algorithms
  base64: { encode: true, decode: true, requiresKey: false },
  base64url: { encode: true, decode: true, requiresKey: false },
  hex: { encode: true, decode: true, requiresKey: false },
  
  // Hash algorithms (one-way)
  md5: { encode: true, decode: false, requiresKey: false },
  sha1: { encode: true, decode: false, requiresKey: false },
  sha256: { encode: true, decode: false, requiresKey: false },
  sha512: { encode: true, decode: false, requiresKey: false },
  
  // HMAC algorithms (with key)
  "hmac-md5": { encode: true, decode: false, requiresKey: true },
  "hmac-sha1": { encode: true, decode: false, requiresKey: true },
  "hmac-sha256": { encode: true, decode: false, requiresKey: true },
  "hmac-sha512": { encode: true, decode: false, requiresKey: true },
};

interface CliOptions {
  algorithm: string;
  operation: "encode" | "decode";
  input?: string;
  file?: string;
  key?: string;
  output?: string;
  help?: boolean;
}

function showHelp() {
  console.log(`
Encode/Decode CLI Tool for Bun

USAGE:
  bun encode-cli.ts [OPTIONS]

OPTIONS:
  -a, --algorithm <name>    Algorithm to use (required)
  -o, --operation <op>      Operation: encode or decode (required)
  -i, --input <string>      Input string to process
  -f, --file <path>         Input file path
  -k, --key <secret>        Secret/key for HMAC algorithms
  -w, --output <path>       Write output to file instead of stdout
  -h, --help                Show this help message

SUPPORTED ALGORITHMS:
  Encoding/Decoding:
    - base64, base64url, hex

  Hashing (encode only):
    - md5, sha1, sha256, sha512

  HMAC (encode only, requires --key):
    - hmac-md5, hmac-sha1, hmac-sha256, hmac-sha512

EXAMPLES:
  # Encode a string to base64
  bun encode-cli.ts -a base64 -o encode -i "Hello World"

  # Decode base64 from file
  bun encode-cli.ts -a base64 -o decode -f encoded.txt

  # Hash a string with SHA256
  bun encode-cli.ts -a sha256 -o encode -i "password123"

  # HMAC-SHA256 with secret key
  bun encode-cli.ts -a hmac-sha256 -o encode -i "data" -k "secret"

  # Encode and save to file
  bun encode-cli.ts -a base64 -o encode -i "Hello" -w output.txt

  # Hex encode a file
  bun encode-cli.ts -a hex -o encode -f input.bin -w output.hex
`);
}

function getInput(options: CliOptions): Buffer {
  if (options.file) {
    try {
      return readFileSync(options.file);
    } catch (error) {
      console.error(`Error reading file: ${error}`);
      process.exit(1);
    }
  } else if (options.input) {
    return Buffer.from(options.input, "utf-8");
  } else {
    console.error("Error: Must provide either --input or --file");
    process.exit(1);
  }
}

function encodeBase64(input: Buffer): string {
  return input.toString("base64");
}

function decodeBase64(input: Buffer): Buffer {
  try {
    return Buffer.from(input.toString("utf-8"), "base64");
  } catch (error) {
    console.error("Error: Invalid base64 input");
    process.exit(1);
  }
}

function encodeBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function decodeBase64Url(input: Buffer): Buffer {
  try {
    let base64 = input
      .toString("utf-8")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    
    // Add padding
    while (base64.length % 4) {
      base64 += "=";
    }
    
    return Buffer.from(base64, "base64");
  } catch (error) {
    console.error("Error: Invalid base64url input");
    process.exit(1);
  }
}

function encodeHex(input: Buffer): string {
  return input.toString("hex");
}

function decodeHex(input: Buffer): Buffer {
  try {
    return Buffer.from(input.toString("utf-8"), "hex");
  } catch (error) {
    console.error("Error: Invalid hex input");
    process.exit(1);
  }
}

function hashData(algorithm: string, input: Buffer): string {
  const hash = createHash(algorithm);
  hash.update(input);
  return hash.digest("hex");
}

function hmacData(algorithm: string, input: Buffer, key: string): string {
  const hmac = createHmac(algorithm, key);
  hmac.update(input);
  return hmac.digest("hex");
}

function processData(options: CliOptions, input: Buffer): string | Buffer {
  const { algorithm, operation, key } = options;

  // Validate algorithm
  if (!ALGORITHMS[algorithm as keyof typeof ALGORITHMS]) {
    console.error(`Error: Unsupported algorithm '${algorithm}'`);
    console.error(`Supported algorithms: ${Object.keys(ALGORITHMS).join(", ")}`);
    process.exit(1);
  }

  const algoInfo = ALGORITHMS[algorithm as keyof typeof ALGORITHMS];

  // Check if operation is supported
  if (operation === "decode" && !algoInfo.decode) {
    console.error(`Error: Algorithm '${algorithm}' does not support decoding (it's a one-way hash)`);
    process.exit(1);
  }

  // Check for required key
  if (algoInfo.requiresKey && !key) {
    console.error(`Error: Algorithm '${algorithm}' requires a key (use --key)`);
    process.exit(1);
  }

  // Process based on algorithm and operation
  switch (algorithm) {
    case "base64":
      return operation === "encode" ? encodeBase64(input) : decodeBase64(input);
    
    case "base64url":
      return operation === "encode" ? encodeBase64Url(input) : decodeBase64Url(input);
    
    case "hex":
      return operation === "encode" ? encodeHex(input) : decodeHex(input);
    
    case "md5":
    case "sha1":
    case "sha256":
    case "sha512":
      return hashData(algorithm, input);
    
    case "hmac-md5":
      return hmacData("md5", input, key!);
    
    case "hmac-sha1":
      return hmacData("sha1", input, key!);
    
    case "hmac-sha256":
      return hmacData("sha256", input, key!);
    
    case "hmac-sha512":
      return hmacData("sha512", input, key!);
    
    default:
      console.error(`Error: Algorithm '${algorithm}' not implemented`);
      process.exit(1);
  }
}

function main() {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        algorithm: { type: "string", short: "a" },
        operation: { type: "string", short: "o" },
        input: { type: "string", short: "i" },
        file: { type: "string", short: "f" },
        key: { type: "string", short: "k" },
        output: { type: "string", short: "w" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    });

    const options = values as CliOptions;

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    // Validate required options
    if (!options.algorithm) {
      console.error("Error: --algorithm is required");
      showHelp();
      process.exit(1);
    }

    if (!options.operation) {
      console.error("Error: --operation is required");
      showHelp();
      process.exit(1);
    }

    if (options.operation !== "encode" && options.operation !== "decode") {
      console.error("Error: --operation must be either 'encode' or 'decode'");
      process.exit(1);
    }

    if (!options.input && !options.file) {
      console.error("Error: Must provide either --input or --file");
      showHelp();
      process.exit(1);
    }

    // Get input
    const input = getInput(options);

    // Process data
    const result = processData(options, input);

    // Output result
    if (options.output) {
      const outputData = typeof result === "string" ? result : result;
      writeFileSync(options.output, outputData);
      console.log(`Output written to: ${options.output}`);
    } else {
      if (typeof result === "string") {
        console.log(result);
      } else {
        // For binary output, write to stdout
        process.stdout.write(result);
      }
    }
  } catch (error: any) {
    if (error.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      console.error(`Error: ${error.message}`);
      showHelp();
      process.exit(1);
    }
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();