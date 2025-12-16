#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { parseArgs } from 'util';
import { exit } from 'process';

/**
 * Parse command line arguments
 */
function parseArguments() {
  try {
    const { values } = parseArgs({
      options: {
        input: {
          type: 'string',
          short: 'i',
        },
        output: {
          type: 'string',
          short: 'o',
        },
        config: {
          type: 'string',
          short: 'c',
        },
        help: {
          type: 'boolean',
          short: 'h',
        },
        version: {
          type: 'boolean',
          short: 'v',
        },
      },
    });

    return values;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    showHelp();
    exit(1);
  }
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
String Replacer CLI - v1.0.0

A CLI tool to replace configured character sequences in files

USAGE:
  string-replacer [OPTIONS]

OPTIONS:
  -i, --input <FILE>     Input file to process (required)
  -c, --config <FILE>    Configuration file with replacement rules (required)
  -o, --output <FILE>    Output file (optional, prints to stdout if not specified)
  -h, --help            Show this help message
  -v, --version         Show version information

EXAMPLES:
  # Output to stdout
  string-replacer -i input.txt -c config.json

  # Save to output file
  string-replacer -i input.txt -c config.json -o output.txt

CONFIGURATION FORMAT:
  The config file should be a JSON file with a "replacements" array:
  
  {
    "replacements": [
      {
        "from": "pattern_to_find",
        "to": "replacement_text"
      }
    ]
  }
`);
}

/**
 * Display version information
 */
function showVersion() {
  console.log('String Replacer CLI v1.0.0');
}

/**
 * Load and parse configuration file
 */
async function loadConfig(configPath) {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    if (!config.replacements || !Array.isArray(config.replacements)) {
      throw new Error('Config file must contain a "replacements" array');
    }

    for (const rule of config.replacements) {
      if (typeof rule.from !== 'string' || typeof rule.to !== 'string') {
        throw new Error('Each replacement must have "from" and "to" string properties');
      }
    }

    return config;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`);
    }
    throw new Error(`Failed to load config: ${error.message}`);
  }
}

/**
 * Apply all replacement rules to the input text
 */
function applyReplacements(text, config) {
  let result = text;

  for (const rule of config.replacements) {
    // Use replaceAll for global replacement
    result = result.replaceAll(rule.from, rule.to);
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  const args = parseArguments();

  // Handle help flag
  if (args.help) {
    showHelp();
    exit(0);
  }

  // Handle version flag
  if (args.version) {
    showVersion();
    exit(0);
  }

  // Validate required arguments
  if (!args.input) {
    console.error('Error: --input/-i is required');
    showHelp();
    exit(1);
  }

  if (!args.config) {
    console.error('Error: --config/-c is required');
    showHelp();
    exit(1);
  }

  try {
    // Load configuration
    const config = await loadConfig(args.config);

    // Read input file
    let inputText;
    try {
      inputText = await readFile(args.input, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Input file not found: ${args.input}`);
      }
      throw new Error(`Failed to read input file: ${error.message}`);
    }

    // Apply replacements
    const outputText = applyReplacements(inputText, config);

    // Write output
    if (args.output) {
      await writeFile(args.output, outputText, 'utf-8');
      console.log(`✓ Output written to: ${args.output}`);
    } else {
      // Print to stdout
      process.stdout.write(outputText);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    exit(1);
  }
}

// Run the main function
main();