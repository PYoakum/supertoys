#!/usr/bin/env bun


/**
 * HTML Blocks CLI
 * Converts JSON/JS configurations into HTML content blocks
 * 
 * Compatible with both Bun and Node.js runtimes
 */

import { parseArgs } from "util";
import { resolve, extname } from "path";
import { readFile, writeFile } from "fs/promises";
import { processInput } from "./utils/processor.js";
import { wrapInDocument } from "./utils/template.js";


const VERSION = "1.0.0";

// Runtime detection and compatibility layer
const isBun = typeof globalThis.Bun !== "undefined";

const runtime = {
  argv: isBun ? Bun.argv : process.argv,
  async readFile(path) {
    if (isBun) {
      return Bun.file(path).text();
    }
    return readFile(path, "utf-8");
  },
  async writeFile(path, content) {
    if (isBun) {
      return Bun.write(path, content);
    }
    return writeFile(path, content, "utf-8");
  },
};

const HELP_TEXT = `
Minipress CLI v${VERSION}
Convert JSON/JS configurations into HTML content blocks

USAGE:
  html-blocks <input-file> [options]

ARGUMENTS:
  <input-file>    Path to input file (.json or .js)

OPTIONS:
  -o, --output <file>   Write output to HTML file (default: stdout)
  -t, --title <title>   Set document title (default: "Generated Content")
  -f, --fragment        Output HTML fragment only (no <html> wrapper)
  -p, --pretty          Pretty print the output
  -s, --style <file>    Include custom CSS file
  -h, --help            Show this help message
  -v, --version         Show version number

SUPPORTED BLOCK TYPES:
  markdown    - Markdown content sections
  table       - Data tables with headers
  image       - Images with optional captions
  video       - Embedded video players
  iframe      - Embedded iframes
  canvas      - Canvas elements with client scripts

EXAMPLES:
  html-blocks config.json
  html-blocks config.js -o output.html
  html-blocks config.json -f > fragment.html
  html-blocks config.json -t "My Page" -o page.html
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: runtime.argv.slice(2),
    options: {
      output: { type: "string", short: "o" },
      title: { type: "string", short: "t", default: "Generated Content" },
      fragment: { type: "boolean", short: "f", default: false },
      pretty: { type: "boolean", short: "p", default: false },
      style: { type: "string", short: "s" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (values.version) {
    console.log(`html-blocks v${VERSION}`);
    process.exit(0);
  }

  const inputFile = positionals[0];

  if (!inputFile) {
    console.error("Error: No input file specified");
    console.error("Run 'html-blocks --help' for usage information");
    process.exit(1);
  }

  const inputPath = resolve(inputFile);
  const ext = extname(inputPath).toLowerCase();

  if (![".json", ".js", ".mjs"].includes(ext)) {
    console.error(`Error: Unsupported file type '${ext}'`);
    console.error("Supported types: .json, .js, .mjs");
    process.exit(1);
  }

  try {
    // Load input configuration
    let config;
    
    if (ext === ".json") {
      const content = await runtime.readFile(inputPath);
      config = JSON.parse(content);
    } else {
      // Dynamic import for JS files
      const module = await import(inputPath);
      config = module.default || module;
    }

    // Load custom styles if specified
    let customStyles = "";
    if (values.style) {
      const stylePath = resolve(values.style);
      customStyles = await runtime.readFile(stylePath);
    }

    // Process the configuration into HTML blocks
    const htmlContent = await processInput(config);

    // Wrap in document or output fragment
    let output;
    if (values.fragment) {
      output = htmlContent;
    } else {
      output = wrapInDocument(htmlContent, {
        title: values.title,
        customStyles,
      });
    }

    // Pretty print if requested
    if (values.pretty) {
      output = formatHtml(output);
    }

    // Output to file or stdout
    if (values.output) {
      const outputPath = resolve(values.output);
      await runtime.writeFile(outputPath, output);
      console.log(`✓ Written to ${outputPath}`);
    } else {
      console.log(output);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function formatHtml(html) {
  let indent = 0;
  const lines = html.split(/>\s*</);
  
  return lines
    .map((line, i) => {
      if (i > 0) line = "<" + line;
      if (i < lines.length - 1) line = line + ">";

      const isClosing = line.match(/^<\//);
      const isSelfClosing = line.match(/\/\s*>$/);
      const isOpening = line.match(/^<[^/]/) && !isSelfClosing;

      if (isClosing) indent = Math.max(0, indent - 1);
      const result = "  ".repeat(indent) + line.trim();
      if (isOpening && !line.match(/^<(br|hr|img|input|meta|link)/i)) indent++;

      return result;
    })
    .join("\n");
}

main();
