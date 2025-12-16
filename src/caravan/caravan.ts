#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

interface Config {
  inputFile: string;
  endpoint: string;
  outputFile: string;
  headers?: Record<string, string>;
}

const USAGE = `
File Sender CLI Tool

Usage:
  bun run file-sender.ts --input <file> --endpoint <url> --output <file> [options]

Required Arguments:
  --input, -i      Input file path to read and send
  --endpoint, -e   API endpoint URL to POST the file to
  --output, -o     Output file path to write the response

Optional Arguments:
  --header, -h     HTTP header in format "Key: Value" (can be used multiple times)
  --help           Show this help message

Examples:
  bun run file-sender.ts -i data.json -e https://api.example.com/process -o result.json
  bun run file-sender.ts -i input.txt -e http://localhost:3000/api -o output.txt -h "Authorization: Bearer token123"
`;

async function parseCliArgs(): Promise<Config | null> {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        input: {
          type: "string",
          short: "i",
        },
        endpoint: {
          type: "string",
          short: "e",
        },
        output: {
          type: "string",
          short: "o",
        },
        header: {
          type: "string",
          short: "h",
          multiple: true,
        },
        help: {
          type: "boolean",
        },
      },
      strict: true,
    });

    if (values.help) {
      console.log(USAGE);
      return null;
    }

    if (!values.input || !values.endpoint || !values.output) {
      console.error("Error: Missing required arguments\n");
      console.log(USAGE);
      process.exit(1);
    }

    const headers: Record<string, string> = {};
    if (values.header) {
      for (const header of values.header) {
        const [key, ...valueParts] = header.split(":");
        if (!key || valueParts.length === 0) {
          console.error(`Error: Invalid header format "${header}". Expected "Key: Value"`);
          process.exit(1);
        }
        headers[key.trim()] = valueParts.join(":").trim();
      }
    }

    return {
      inputFile: values.input,
      endpoint: values.endpoint,
      outputFile: values.output,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(USAGE);
    process.exit(1);
  }
}

async function readInputFile(filePath: string): Promise<string> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`📖 Reading file: ${resolvedPath}`);
    const content = await readFile(resolvedPath, "utf-8");
    console.log(`✓ Successfully read ${content.length} characters`);
    return content;
  } catch (error) {
    console.error(`Error reading input file "${filePath}":`, error);
    process.exit(1);
  }
}

async function sendToEndpoint(
  endpoint: string,
  data: string,
  headers?: Record<string, string>
): Promise<string> {
  try {
    console.log(`📤 Sending POST request to: ${endpoint}`);
    
    const requestHeaders: HeadersInit = {
      "Content-Type": "application/json",
      ...headers,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: data,
    });

    console.log(`✓ Response received: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}\n${errorText}`
      );
    }

    const responseText = await response.text();
    console.log(`✓ Response size: ${responseText.length} characters`);
    return responseText;
  } catch (error) {
    console.error(`Error sending request to "${endpoint}":`, error);
    process.exit(1);
  }
}

async function writeOutputFile(filePath: string, content: string): Promise<void> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`💾 Writing output to: ${resolvedPath}`);
    await writeFile(resolvedPath, content, "utf-8");
    console.log(`✓ Successfully wrote output file`);
  } catch (error) {
    console.error(`Error writing output file "${filePath}":`, error);
    process.exit(1);
  }
}

async function main() {
  console.log("🚀 File Sender CLI Tool\n");

  const config = await parseCliArgs();
  if (!config) {
    return;
  }

  try {
    // Read input file
    const inputData = await readInputFile(config.inputFile);

    // Send to endpoint
    const responseData = await sendToEndpoint(
      config.endpoint,
      inputData,
      config.headers
    );

    // Write output file
    await writeOutputFile(config.outputFile, responseData);

    console.log("\n✅ Process completed successfully!");
  } catch (error) {
    console.error("\n❌ Process failed:", error);
    process.exit(1);
  }
}

main();