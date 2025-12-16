#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { spawn } from "child_process";

interface CommandConfig {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
}

interface SequentialConfig {
  type: "sequential";
  commands: (CommandConfig | ParallelConfig | ConditionalConfig)[];
}

interface ParallelConfig {
  type: "parallel";
  commands: CommandConfig[];
  failFast?: boolean;
}

interface ConditionalConfig {
  type: "conditional";
  condition: CommandConfig;
  onSuccess?: (CommandConfig | SequentialConfig | ParallelConfig)[];
  onFailure?: (CommandConfig | SequentialConfig | ParallelConfig)[];
}

type TaskConfig = CommandConfig | SequentialConfig | ParallelConfig | ConditionalConfig;

interface Config {
  version?: string;
  name?: string;
  tasks: TaskConfig[];
}

const USAGE = `
Bun Task Runner CLI Tool

Usage:
  bun run commander.ts --config <file> [options]

Required Arguments:
  --config, -c     Path to JSON configuration file

Optional Arguments:
  --verbose, -v    Enable verbose output
  --dry-run, -d    Show what would be executed without running
  --help           Show this help message

Configuration File Format:
  {
    "name": "My Tasks",
    "tasks": [
      {
        "name": "Build",
        "command": "bun",
        "args": ["run", "build.ts"]
      },
      {
        "type": "parallel",
        "commands": [...]
      },
      {
        "type": "conditional",
        "condition": {...},
        "onSuccess": [...],
        "onFailure": [...]
      }
    ]
  }

Examples:
  bun run commander.ts -c tasks.json
  bun run commander.ts -c build-config.json --verbose
  bun run commander.ts -c tasks.json --dry-run
`;

interface CliConfig {
  configFile: string;
  verbose: boolean;
  dryRun: boolean;
}

async function parseCliArgs(): Promise<CliConfig | null> {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        config: {
          type: "string",
          short: "c",
        },
        verbose: {
          type: "boolean",
          short: "v",
          default: false,
        },
        "dry-run": {
          type: "boolean",
          short: "d",
          default: false,
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

    if (!values.config) {
      console.error("Error: Missing required --config argument\n");
      console.log(USAGE);
      process.exit(1);
    }

    return {
      configFile: values.config,
      verbose: values.verbose || false,
      dryRun: values["dry-run"] || false,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(USAGE);
    process.exit(1);
  }
}

async function readConfigFile(filePath: string): Promise<Config> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`📖 Reading configuration: ${resolvedPath}`);
    const content = await readFile(resolvedPath, "utf-8");
    const config = JSON.parse(content);
    console.log(`✓ Configuration loaded${config.name ? `: ${config.name}` : ""}\n`);
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in config file "${filePath}"`);
      console.error(error.message);
    } else {
      console.error(`Error reading config file "${filePath}":`, error);
    }
    process.exit(1);
  }
}

function executeCommand(
  config: CommandConfig,
  verbose: boolean,
  dryRun: boolean
): Promise<{ success: boolean; code: number; output: string }> {
  return new Promise((resolve) => {
    const cmdString = config.args
      ? `${config.command} ${config.args.join(" ")}`
      : config.command;

    console.log(`  ▶ ${config.name}: ${cmdString}`);

    if (dryRun) {
      console.log(`    [DRY RUN] Would execute in ${config.cwd || "current directory"}`);
      resolve({ success: true, code: 0, output: "" });
      return;
    }

    const startTime = Date.now();
    let output = "";

    const childProcess = spawn(config.command, config.args || [], {
      cwd: config.cwd || process.cwd(),
      env: { ...process.env, ...config.env },
      shell: true,
    });

    childProcess.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (verbose) {
        process.stdout.write(`    ${text}`);
      }
    });

    childProcess.stderr?.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (verbose) {
        process.stderr.write(`    ${text}`);
      }
    });

    childProcess.on("close", (code) => {
      const duration = Date.now() - startTime;
      const success = code === 0;

      if (success) {
        console.log(`    ✓ Completed in ${duration}ms`);
      } else {
        console.log(`    ✗ Failed with code ${code} after ${duration}ms`);
      }

      resolve({ success, code: code || 0, output });
    });

    childProcess.on("error", (error) => {
      console.error(`    ✗ Error executing command: ${error.message}`);
      resolve({ success: false, code: 1, output: error.message });
    });
  });
}

async function runSequential(
  config: SequentialConfig,
  verbose: boolean,
  dryRun: boolean
): Promise<boolean> {
  console.log("📋 Running commands sequentially...\n");

  for (const task of config.commands) {
    const success = await runTask(task, verbose, dryRun);
    
    if (!success) {
      if (isCommandConfig(task) && task.continueOnError) {
        console.log(`  ⚠ Command failed but continueOnError is set, continuing...\n`);
        continue;
      }
      console.log(`  ✗ Sequential execution stopped due to failure\n`);
      return false;
    }
  }

  console.log("✓ All sequential commands completed successfully\n");
  return true;
}

async function runParallel(
  config: ParallelConfig,
  verbose: boolean,
  dryRun: boolean
): Promise<boolean> {
  console.log(`⚡ Running ${config.commands.length} commands in parallel...\n`);

  const promises = config.commands.map((cmd) => executeCommand(cmd, verbose, dryRun));

  if (config.failFast) {
    // Fail fast: return on first failure
    const results = await Promise.allSettled(promises);
    const allSuccess = results.every(
      (r) => r.status === "fulfilled" && r.value.success
    );

    if (allSuccess) {
      console.log("✓ All parallel commands completed successfully\n");
    } else {
      console.log("✗ One or more parallel commands failed\n");
    }

    return allSuccess;
  } else {
    // Wait for all to complete
    const results = await Promise.all(promises);
    const allSuccess = results.every((r) => r.success);

    if (allSuccess) {
      console.log("✓ All parallel commands completed successfully\n");
    } else {
      console.log("✗ One or more parallel commands failed\n");
    }

    return allSuccess;
  }
}

async function runConditional(
  config: ConditionalConfig,
  verbose: boolean,
  dryRun: boolean
): Promise<boolean> {
  console.log("🔀 Running conditional command...\n");
  console.log("  Condition:");

  const result = await executeCommand(config.condition, verbose, dryRun);

  if (result.success) {
    console.log("\n  ✓ Condition succeeded, running onSuccess tasks...\n");
    
    if (config.onSuccess && config.onSuccess.length > 0) {
      for (const task of config.onSuccess) {
        const success = await runTask(task, verbose, dryRun);
        if (!success) {
          console.log("  ✗ onSuccess task failed\n");
          return false;
        }
      }
      console.log("  ✓ All onSuccess tasks completed\n");
    }
    return true;
  } else {
    console.log("\n  ✗ Condition failed, running onFailure tasks...\n");
    
    if (config.onFailure && config.onFailure.length > 0) {
      for (const task of config.onFailure) {
        const success = await runTask(task, verbose, dryRun);
        if (!success) {
          console.log("  ✗ onFailure task failed\n");
          return false;
        }
      }
      console.log("  ✓ All onFailure tasks completed\n");
    }
    return false;
  }
}

function isCommandConfig(task: any): task is CommandConfig {
  return !task.type && task.command !== undefined;
}

function isSequentialConfig(task: any): task is SequentialConfig {
  return task.type === "sequential";
}

function isParallelConfig(task: any): task is ParallelConfig {
  return task.type === "parallel";
}

function isConditionalConfig(task: any): task is ConditionalConfig {
  return task.type === "conditional";
}

async function runTask(
  task: TaskConfig,
  verbose: boolean,
  dryRun: boolean
): Promise<boolean> {
  if (isCommandConfig(task)) {
    const result = await executeCommand(task, verbose, dryRun);
    return result.success || task.continueOnError || false;
  } else if (isSequentialConfig(task)) {
    return await runSequential(task, verbose, dryRun);
  } else if (isParallelConfig(task)) {
    return await runParallel(task, verbose, dryRun);
  } else if (isConditionalConfig(task)) {
    return await runConditional(task, verbose, dryRun);
  }

  console.error("  ✗ Unknown task type:", task);
  return false;
}

async function main() {
  console.log("🚀 Bun Task Runner\n");

  const cliConfig = await parseCliArgs();
  if (!cliConfig) {
    return;
  }

  try {
    const config = await readConfigFile(cliConfig.configFile);

    if (cliConfig.dryRun) {
      console.log("🔍 DRY RUN MODE - No commands will be executed\n");
    }

    if (cliConfig.verbose) {
      console.log("📢 Verbose mode enabled\n");
    }

    const startTime = Date.now();
    let allSuccess = true;

    for (const task of config.tasks) {
      const success = await runTask(task, cliConfig.verbose, cliConfig.dryRun);
      if (!success) {
        allSuccess = false;
        break;
      }
    }

    const totalTime = Date.now() - startTime;

    console.log("=".repeat(50));
    if (allSuccess) {
      console.log(`✅ All tasks completed successfully in ${totalTime}ms`);
      process.exit(0);
    } else {
      console.log(`❌ Task execution failed after ${totalTime}ms`);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ Task runner failed:", error);
    process.exit(1);
  }
}

main();