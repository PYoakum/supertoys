#!/usr/bin/env bun

import { parseArgs } from "util";
import * as commands from "./commands.ts";

/**
 * CLI Tool Scaffold
 * 
 * Automatically routes CLI arguments to imported functions from ./commands
 * Usage: bun cli.ts <command> [options]
 */

interface ParsedArgs {
  positionals: string[];
  values: Record<string, string | boolean | Array<string | boolean>>;
}

function printHelp() {
  console.log(`
Usage: bun cli.ts <command> [options]

Available commands:
${Object.keys(commands)
  .map((cmd) => `  - ${cmd}`)
  .join("\n")}

Options:
  --help, -h     Show this help message
  
Examples:
  bun cli.ts myCommand --arg1=value --arg2=value
  bun cli.ts myCommand value1 value2 --flag
`);
}

function parseCliArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Separate positional arguments from flags/options
  const positionals: string[] = [];
  const options: Record<string, boolean | string | Array<string | boolean>> = {};

  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, ...valueParts] = arg.slice(2).split("=");
      const value = valueParts.join("=");
      
      if (value) {
        options[key] = value;
      } else {
        options[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length > 1 && arg !== "-") {
      // Handle short flags like -f
      options[arg.slice(1)] = true;
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, values: options };
}

async function main() {
  try {
    const { positionals, values } = parseCliArgs();

    // First positional is the command name
    const commandName = positionals[0];

    if (!commandName) {
      console.error("Error: No command specified\n");
      printHelp();
      process.exit(1);
    }

    // Check if command exists
    if (!(commandName in commands)) {
      console.error(`Error: Unknown command '${commandName}'\n`);
      printHelp();
      process.exit(1);
    }

    // Get the command function
    const commandFn = commands[commandName as keyof typeof commands];

    if (typeof commandFn !== "function") {
      console.error(`Error: '${commandName}' is not a callable function\n`);
      process.exit(1);
    }

    // Call the command with remaining positionals and options
    const commandArgs = positionals.slice(1);
    const result = await commandFn(commandArgs, values);

    // If the command returns a value, print it
    if (result !== undefined) {
      console.log(result);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();