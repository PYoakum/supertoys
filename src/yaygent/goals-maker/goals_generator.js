#!/usr/bin/env bun
/**
 * Goals Generator TUI - Generate goals.json files using LLM providers.
 * Bun runtime - JavaScript only
 */

import * as readline from "readline";
import { resolve, dirname, join } from "path";
import { mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "goals-output");
const GOALS_CLI_PATH = resolve(__dirname, "../goals-cli/goals-cli.js");
const RUN_ALL_PATH = resolve(__dirname, "../goals-cli/run-all.js");
const COMPLETED_WORK_DIR = resolve(__dirname, "completed-work");

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bgCyan: "\x1b[46m",
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

// Goals schema for LLM prompt
const GOALS_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "goals.schema.json",
  title: "Goals Definition",
  type: "object",
  required: ["version", "goals"],
  properties: {
    version: { type: "string", pattern: "^\\d+\\.\\d+$" },
    metadata: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        author: { type: "string" },
        created: { type: "string", format: "date-time" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    goals: { type: "array", minItems: 1 },
    globalContext: { type: "object" },
  },
};

const LLMProvider = {
  ANTHROPIC: "anthropic",
  OPENAI: "openai",
  CUSTOM: "custom",
};

const DEFAULT_ENDPOINTS = {
  [LLMProvider.ANTHROPIC]: "https://api.anthropic.com/v1/messages",
  [LLMProvider.OPENAI]: "https://api.openai.com/v1/chat/completions",
  [LLMProvider.CUSTOM]: "",
};

const DEFAULT_MODELS = {
  [LLMProvider.ANTHROPIC]: "claude-sonnet-4-20250514",
  [LLMProvider.OPENAI]: "gpt-4o",
  [LLMProvider.CUSTOM]: "",
};

// Terminal utilities
function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function hideCursor() {
  process.stdout.write("\x1b[?25l");
}

function showCursor() {
  process.stdout.write("\x1b[?25h");
}

function printHeader() {
  const border = "─".repeat(44);
  console.log(c("cyan", `┌${border}┐`));
  console.log(c("cyan", "│") + c("bold", "         Goals Generator TUI              ") + c("cyan", "│"));
  console.log(c("cyan", "│") + c("dim", "  Generate goals.json using LLM providers ") + c("cyan", "│"));
  console.log(c("cyan", `└${border}┘`));
  console.log();
}

function printBox(title, content, color = "green") {
  const lines = content.split("\n");
  const maxLen = Math.max(title.length, ...lines.map((l) => l.length)) + 2;
  const border = "─".repeat(maxLen + 2);

  console.log(c(color, `┌─ ${title} ${border.slice(title.length + 3)}┐`));
  for (const line of lines) {
    console.log(c(color, "│ ") + line.padEnd(maxLen) + c(color, " │"));
  }
  console.log(c(color, `└${border}┘`));
}

// Interactive prompt utilities
function createRL() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(question, defaultValue = "") {
  const rl = createRL();
  const defaultHint = defaultValue ? c("dim", ` (${defaultValue})`) : "";

  return new Promise((resolve) => {
    rl.question(`${c("cyan", "?")} ${c("bold", question)}${defaultHint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function promptPassword(question) {
  const rl = createRL();

  return new Promise((resolve) => {
    process.stdout.write(`${c("cyan", "?")} ${c("bold", question)}: `);

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";

    const onData = (char) => {
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(password);
      } else if (char === "\u0003") {
        // Ctrl+C
        stdin.setRawMode(false);
        process.exit(0);
      } else if (char === "\u007F" || char === "\b") {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        password += char;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

async function promptSelect(question, choices) {
  let selectedIndex = 0;

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const render = () => {
      // Move cursor up and clear previous render
      if (selectedIndex >= 0) {
        process.stdout.write(`\x1b[${choices.length + 1}A`);
      }

      console.log(`${c("cyan", "?")} ${c("bold", question)}`);
      choices.forEach((choice, i) => {
        const prefix = i === selectedIndex ? c("cyan", "> ") : "  ";
        const text = i === selectedIndex ? c("cyan", choice.label) : choice.label;
        console.log(`${prefix}${text}`);
      });
    };

    // Initial render
    console.log(`${c("cyan", "?")} ${c("bold", question)}`);
    choices.forEach((choice, i) => {
      const prefix = i === selectedIndex ? c("cyan", "> ") : "  ";
      const text = i === selectedIndex ? c("cyan", choice.label) : choice.label;
      console.log(`${prefix}${text}`);
    });

    const onKey = (key) => {
      if (key === "\u0003") {
        // Ctrl+C
        stdin.setRawMode(false);
        showCursor();
        process.exit(0);
      } else if (key === "\r" || key === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onKey);
        showCursor();
        resolve(choices[selectedIndex].value);
      } else if (key === "\x1b[A" || key === "k") {
        // Up arrow or k
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        render();
      } else if (key === "\x1b[B" || key === "j") {
        // Down arrow or j
        selectedIndex = (selectedIndex + 1) % choices.length;
        render();
      }
    };

    hideCursor();
    stdin.on("data", onKey);
  });
}

async function promptConfirm(question, defaultValue = true) {
  const hint = defaultValue ? c("dim", " (Y/n)") : c("dim", " (y/N)");
  const answer = await prompt(`${question}${hint}`);

  if (!answer) return defaultValue;
  return answer.toLowerCase().startsWith("y");
}

async function promptMultiline(question, instruction) {
  console.log(`${c("cyan", "?")} ${c("bold", question)}`);
  console.log(c("dim", `   ${instruction}`));
  console.log();

  const lines = [];
  const rl = createRL();

  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (line === ".done") {
        rl.close();
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });

    rl.on("close", () => {
      resolve(lines.join("\n"));
    });
  });
}

// Spinner utility
function createSpinner(text) {
  const frames = ["-", "\\", "|", "/"];
  let i = 0;
  let interval;

  return {
    start() {
      hideCursor();
      interval = setInterval(() => {
        process.stdout.write(`\r${c("cyan", "[" + frames[i] + "]")} ${text}`);
        i = (i + 1) % frames.length;
      }, 100);
    },
    stop(finalText) {
      clearInterval(interval);
      process.stdout.write(`\r${c("green", "[+]")} ${finalText}\n`);
      showCursor();
    },
    fail(finalText) {
      clearInterval(interval);
      process.stdout.write(`\r${c("red", "[x]")} ${finalText}\n`);
      showCursor();
    },
  };
}

// LLM API calls
async function callAnthropic(config, systemPrompt, userPrompt) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAI(config, systemPrompt, userPrompt) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callCustom(config, systemPrompt, userPrompt) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model || "default",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }

  const data = await response.json();

  // Handle both OpenAI and Anthropic response formats
  if (data.choices) {
    return data.choices[0].message.content;
  } else if (data.content) {
    return data.content[0].text;
  }
  return JSON.stringify(data);
}

function buildSystemPrompt() {
  return `You are a goals definition generator. Your task is to convert user descriptions into a valid goals.json file that conforms to the following JSON schema:

\`\`\`json
${JSON.stringify(GOALS_SCHEMA, null, 2)}
\`\`\`

Rules for generating goals:
1. Always include "version": "1.0" 
2. Include meaningful metadata (name, description, author as "AI Generated", created timestamp in ISO format, relevant tags)
3. Each goal must have:
   - id: kebab-case identifier (e.g., "build-api", "write-tests")
   - objective: Clear statement of what should be accomplished (min 10 chars)
   - priority: 1-10 where 1 is highest priority
   - criteria: Object with success array, acceptance array, and validation type
   - constraints: Array of limitations (optional)
   - dependencies: Array of goal IDs that must complete first (optional)
   - context: Key-value pairs for goal-specific context (optional)
4. Ensure dependencies reference valid goal IDs
5. Order goals logically based on dependencies

Respond ONLY with valid JSON. No markdown, no explanations, just the JSON object.`;
}

function buildUserPrompt(description) {
  return `Convert the following goals description into a valid goals.json file:

${description}

Generate a complete, valid JSON response conforming to the schema.`;
}

async function generateGoals(config, description) {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(description);

  let response;
  if (config.provider === LLMProvider.ANTHROPIC) {
    response = await callAnthropic(config, systemPrompt, userPrompt);
  } else if (config.provider === LLMProvider.OPENAI) {
    response = await callOpenAI(config, systemPrompt, userPrompt);
  } else {
    response = await callCustom(config, systemPrompt, userPrompt);
  }

  // Extract JSON from response (handle markdown code blocks)
  response = response.trim();
  if (response.startsWith("```json")) {
    response = response.slice(7);
  }
  if (response.startsWith("```")) {
    response = response.slice(3);
  }
  if (response.endsWith("```")) {
    response = response.slice(0, -3);
  }
  response = response.trim();

  return JSON.parse(response);
}

function validateGoals(goals) {
  const errors = [];

  if (!goals.version) {
    errors.push("Missing 'version' field");
  }

  if (!goals.goals) {
    errors.push("Missing 'goals' array");
  } else if (!Array.isArray(goals.goals)) {
    errors.push("'goals' must be an array");
  } else if (goals.goals.length === 0) {
    errors.push("'goals' array must have at least one item");
  } else {
    const goalIds = new Set();
    goals.goals.forEach((goal, i) => {
      if (!goal.id) {
        errors.push(`Goal ${i}: Missing 'id'`);
      } else {
        goalIds.add(goal.id);
      }
      if (!goal.objective) {
        errors.push(`Goal ${i}: Missing 'objective'`);
      }
    });

    // Check dependencies reference valid IDs
    for (const goal of goals.goals) {
      const deps = goal.dependencies || [];
      for (const dep of deps) {
        if (!goalIds.has(dep)) {
          errors.push(`Goal '${goal.id || "?"}': Invalid dependency '${dep}'`);
        }
      }
    }
  }

  return errors;
}

async function saveGoals(goals, filename) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const filepath = resolve(OUTPUT_DIR, filename);
  await Bun.write(filepath, JSON.stringify(goals, null, 2));
  return filepath;
}

// Progress bar utility
function createProgressBar(total, width = 30) {
  let current = 0;

  const render = (status = "") => {
    const percent = Math.floor((current / total) * 100);
    const filled = Math.floor((current / total) * width);
    const empty = width - filled;
    const bar = "[" + "=".repeat(filled) + (filled < width ? ">" : "") + " ".repeat(Math.max(0, empty - 1)) + "]";
    const line = `\r${c("cyan", bar)} ${percent.toString().padStart(3)}% ${status}`;
    process.stdout.write(line + " ".repeat(20)); // pad to clear previous text
  };

  return {
    update(value, status = "") {
      current = Math.min(value, total);
      render(status);
    },
    increment(status = "") {
      current = Math.min(current + 1, total);
      render(status);
    },
    complete(status = "") {
      current = total;
      render(status);
      console.log();
    }
  };
}

// Run the agent pipeline with default settings
async function runAgent(goalsFilePath, config, options = {}) {
  const debug = options.debug || false;
  const throttled = options.throttled || false;

  console.log();
  const modeLabel = throttled ? "--- Agent Pipeline Execution (Throttled) ---" :
                    debug ? "--- Agent Pipeline Execution (Debug Mode) ---" :
                    "--- Agent Pipeline Execution ---";
  console.log(c("bold", modeLabel));
  console.log();

  const confirm = await promptConfirm("Start the agent pipeline?", true);
  if (!confirm) {
    console.log(c("yellow", "Pipeline cancelled."));
    return false;
  }

  // Create completed-work directory
  await mkdir(COMPLETED_WORK_DIR, { recursive: true });

  console.log();
  console.log(c("dim", "Starting pipeline execution..."));
  console.log(c("dim", `Output directory: ${COMPLETED_WORK_DIR}`));
  if (debug) {
    console.log(c("yellow", "Debug mode enabled - showing all output"));
  }
  if (throttled) {
    console.log(c("yellow", "Throttled mode enabled - 5 second delay between LLM requests"));
  }
  console.log();

  // Track phases for progress display (patterns must be specific to avoid false matches)
  const phases = [
    { name: "Server", pattern: /Phase 1\/5/ },
    { name: "Create Session", pattern: /Phase 2\/5/ },
    { name: "Prepare Session", pattern: /Phase 3\/5/ },
    { name: "Execute Action Plan", pattern: /Phase 4\/5/ },
    { name: "Output Evaluation", pattern: /Phase 5\/5|RUN ALL COMPLETE/ },
  ];

  let currentPhase = 0;
  const progress = createProgressBar(phases.length);

  return new Promise((resolvePromise) => {
    const runtime = typeof Bun !== "undefined" ? "bun" : "node";

    // Build environment with LLM config
    // Throttled mode uses 5s delay between requests to avoid rate limits
    const requestDelay = throttled ? "5000" : "3000";

    const env = {
      ...process.env,
      PRIMARY_LLM_PROVIDER: config.provider,
      PRIMARY_LLM_API_KEY: config.apiKey,
      PRIMARY_LLM_ENDPOINT: config.endpoint,
      PRIMARY_LLM_MODEL: config.model || "",
      // Legacy fallbacks
      LLM_PROVIDER: config.provider,
      LLM_API_KEY: config.apiKey,
      LLM_ENDPOINT: config.endpoint,
      LLM_MODEL: config.model || "",
      // Increase timeout for LLM operations (5 minutes)
      LLM_TIMEOUT: "300000",
      // Rate limit handling: 5 retries, 10s initial backoff
      LLM_MAX_RETRIES: "5",
      LLM_BACKOFF_MS: "10000",
      // Delay between LLM requests (throttled mode uses longer delay)
      LLM_REQUEST_DELAY_MS: requestDelay,
      // Continue executing tasks even if evaluation fails (don't stop on strict eval)
      CONTINUE_ON_EVAL_FAILURE: "true",
    };

    const args = [
      RUN_ALL_PATH,
      "--goals", goalsFilePath,
      "--output", COMPLETED_WORK_DIR,
      "--verbose",
    ];

    const proc = spawn(runtime, args, {
      env,
      cwd: dirname(RUN_ALL_PATH),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let lastOutput = "";

    const processOutput = (data) => {
      const text = data.toString();
      lastOutput = text;

      // Check for phase transitions
      for (let i = currentPhase; i < phases.length; i++) {
        if (phases[i].pattern.test(text)) {
          currentPhase = i + 1;
          progress.update(currentPhase, phases[i].name);
          break;
        }
      }

      // Print status lines
      const lines = text.split("\n").filter(l => l.trim());
      for (const line of lines) {
        // Normalize emoji to pictograms
        const normalized = line
          .replace(/✓/g, "[+]")
          .replace(/✗/g, "[x]")
          .replace(/✅/g, "[+]")
          .replace(/❌/g, "[x]")
          .replace(/⚠️?/g, "[!]")
          .replace(/▶/g, ">")
          .replace(/⏳/g, "...")
          .replace(/📁/g, "")
          .replace(/📊/g, "")
          .replace(/⏱️?/g, "");

        // Show output based on debug mode
        if (line.includes("✓") || line.includes("✅") || line.includes("[+]") || line.includes("SUCCESS") || line.includes("Completed")) {
          console.log(`  ${c("green", "[+]")} ${normalized.replace(/\[.*?\]\s*/, "")}`);
        } else if (line.includes("✗") || line.includes("❌") || line.includes("[x]") || line.includes("Error") || line.includes("FATAL") || line.includes("Failed")) {
          console.log(`  ${c("red", "[x]")} ${normalized.replace(/\[.*?\]\s*/, "")}`);
        } else if (line.includes("Executing:") || line.includes("In Progress")) {
          console.log(`  ${c("cyan", "[.]")} ${normalized.replace(/\[.*?\]\s*/, "")}`);
        } else if (line.includes("Phase") || line.includes("══")) {
          console.log(`  ${c("cyan", "[>]")} ${normalized.replace(/\[.*?\]\s*/, "")}`);
        } else if (debug && normalized.trim()) {
          // In debug mode, show all other lines
          console.log(`  ${c("dim", "...")} ${normalized}`);
        }
      }
    };

    proc.stdout.on("data", processOutput);
    proc.stderr.on("data", processOutput);

    proc.on("close", (code) => {
      progress.complete(code === 0 ? "Pipeline complete" : "Pipeline finished with errors");
      console.log();

      if (code === 0) {
        console.log(`${c("green", "[+]")} Agent pipeline finished successfully.`);
        console.log(`${c("green", "[+]")} Output saved to: ${c("cyan", COMPLETED_WORK_DIR)}`);
      } else {
        console.log(`${c("yellow", "[!]")} Pipeline exited with code ${code}`);
        console.log(`${c("dim", "Check the output above for details.")}`);
      }

      resolvePromise(code === 0);
    });

    proc.on("error", (err) => {
      progress.complete("Pipeline failed to start");
      console.log();
      console.log(`${c("red", "[x]")} Failed to start pipeline: ${err.message}`);
      resolvePromise(false);
    });
  });
}

// Run vigilant mode via goals-cli vigilant command
async function runVigilantMode(goalsFilePath, config) {
  console.log();
  console.log(c("bold", "--- Vigilant Mode (Auto-Retry with Error Learning) ---"));
  console.log();
  console.log(c("dim", "This mode will:"));
  console.log(c("dim", "  1. Run the pipeline in debug mode"));
  console.log(c("dim", "  2. On failure, collect error logs"));
  console.log(c("dim", "  3. Inject an error-assessment goal"));
  console.log(c("dim", "  4. Retry with learned context (up to 3 attempts)"));
  console.log();

  const confirm = await promptConfirm("Start vigilant mode?", true);
  if (!confirm) {
    console.log(c("yellow", "Vigilant mode cancelled."));
    return false;
  }

  // Create context directory if not exists
  const contextDir = join(dirname(goalsFilePath), "context");
  await mkdir(contextDir, { recursive: true });

  // Create completed-work directory
  await mkdir(COMPLETED_WORK_DIR, { recursive: true });

  console.log();
  console.log(c("dim", "Starting vigilant mode execution..."));
  console.log(c("dim", `Output directory: ${COMPLETED_WORK_DIR}`));
  console.log(c("dim", `Context directory: ${contextDir}`));
  console.log();

  return new Promise((resolvePromise) => {
    const runtime = typeof Bun !== "undefined" ? "bun" : "node";

    const env = {
      ...process.env,
      PRIMARY_LLM_PROVIDER: config.provider,
      PRIMARY_LLM_API_KEY: config.apiKey,
      PRIMARY_LLM_ENDPOINT: config.endpoint,
      PRIMARY_LLM_MODEL: config.model || "",
      LLM_PROVIDER: config.provider,
      LLM_API_KEY: config.apiKey,
      LLM_ENDPOINT: config.endpoint,
      LLM_MODEL: config.model || "",
      LLM_TIMEOUT: "300000",
      LLM_MAX_RETRIES: "5",
      LLM_BACKOFF_MS: "10000",
      LLM_REQUEST_DELAY_MS: "3000",
      CONTINUE_ON_EVAL_FAILURE: "true",
    };

    const args = [
      GOALS_CLI_PATH,
      "vigilant",
      "--goals", goalsFilePath,
      "--context", contextDir,
      "--output", COMPLETED_WORK_DIR,
      "--vigilant-attempts", "3",
    ];

    const proc = spawn(runtime, args, {
      env,
      cwd: dirname(GOALS_CLI_PATH),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const processOutput = (data) => {
      const text = data.toString();
      const lines = text.split("\n").filter(l => l.trim());

      for (const line of lines) {
        // Show attempt headers
        if (line.includes("VIGILANT MODE") || line.includes("Attempt")) {
          console.log(`  ${c("cyan", "[>]")} ${line.trim()}`);
        }
        // Show success messages
        else if (line.includes("SUCCESS") || line.includes("succeeded") || line.includes("[+]")) {
          console.log(`  ${c("green", "[+]")} ${line.replace(/\[.*?\]\s*/, "").trim()}`);
        }
        // Show error/failure messages
        else if (line.includes("Error") || line.includes("failed") || line.includes("[x]") || line.includes("FATAL")) {
          console.log(`  ${c("red", "[x]")} ${line.replace(/\[.*?\]\s*/, "").trim()}`);
        }
        // Show info messages
        else if (line.includes("[INFO]") || line.includes("Preparing") || line.includes("Collecting") || line.includes("Created") || line.includes("Injected")) {
          console.log(`  ${c("dim", "...")} ${line.replace(/\[.*?\]\s*/, "").trim()}`);
        }
        // Show phase separators
        else if (line.includes("===") || line.includes("---")) {
          console.log(`  ${c("cyan", "[>]")} ${line.trim()}`);
        }
      }
    };

    proc.stdout.on("data", processOutput);
    proc.stderr.on("data", processOutput);

    proc.on("close", (code) => {
      console.log();
      if (code === 0) {
        console.log(`${c("green", "[+]")} Vigilant mode completed successfully.`);
        console.log(`${c("green", "[+]")} Output saved to: ${c("cyan", COMPLETED_WORK_DIR)}`);
      } else {
        console.log(`${c("yellow", "[!]")} Vigilant mode exited with code ${code}`);
        console.log(`${c("dim", "All retry attempts exhausted or an error occurred.")}`);
      }
      resolvePromise(code === 0);
    });

    proc.on("error", (err) => {
      console.log(`${c("red", "[x]")} Failed to start vigilant mode: ${err.message}`);
      resolvePromise(false);
    });
  });
}

// Run goals-cli in advanced TUI mode
async function runAdvancedMode(goalsFilePath) {
  console.log();
  console.log(c("dim", "Launching goals-cli in TUI mode..."));
  console.log();

  return new Promise((resolve) => {
    const proc = spawn("bun", [GOALS_CLI_PATH, goalsFilePath], {
      stdio: "inherit",
      cwd: dirname(GOALS_CLI_PATH),
    });

    proc.on("close", (code) => {
      console.log();
      console.log(c("dim", `TUI exited with code ${code}`));
      resolve(code === 0);
    });

    proc.on("error", (err) => {
      console.log(c("red", `[x] Failed to launch goals-cli: ${err.message}`));
      resolve(false);
    });
  });
}

// Post-generation menu
async function postGenerationMenu(config, goals, filepath) {
  let continueLoop = true;

  while (continueLoop) {
    console.log();
    console.log(c("bold", "--- What would you like to do? ---"));
    console.log();

    const action = await promptSelect("Select an action:", [
      { label: "Run Agent            - Execute pipeline with default settings", value: "run" },
      { label: "Run Agent (Debug)    - Execute with verbose debug output", value: "run-debug" },
      { label: "Putter (Throttled)   - Slow execution to avoid rate limits", value: "putter" },
      { label: "Vigilant Mode        - Auto-retry with error learning (3 attempts)", value: "vigilant" },
      { label: "Add New Goals        - Generate additional goals", value: "add" },
      { label: "Run Agent (Advanced) - Launch TUI for granular configuration", value: "advanced" },
      { label: "Do Nothing.", value: "exit" },
    ]);

    switch (action) {
      case "run":
        await runAgent(filepath, config, { debug: false });
        continueLoop = false;
        break;

      case "run-debug":
        await runAgent(filepath, config, { debug: true });
        continueLoop = false;
        break;

      case "putter":
        await runAgent(filepath, config, { debug: false, throttled: true });
        continueLoop = false;
        break;

      case "vigilant":
        await runVigilantMode(filepath, config);
        continueLoop = false;
        break;

      case "add":
        // Return to signal we want to add more goals
        return { action: "add_goals", config };

      case "advanced":
        await runAdvancedMode(filepath);
        continueLoop = false;
        break;

      case "exit":
      default:
        console.log();
        console.log(`${c("green", "[+]")} Goals exported to: ${c("cyan", filepath)}`);
        console.log(c("dim", "Exiting."));
        continueLoop = false;
        break;
    }
  }

  return { action: "done" };
}

// Goals description step (extracted for reuse)
async function getGoalsDescription() {
  clearScreen();
  printHeader();
  console.log(c("bold", "Step 2: Describe Your Goals\n"));

  printBox(
    "Instructions",
    "Enter a description of what you want to accomplish.\nBe as detailed as possible - include objectives,\npriorities, success criteria, and any constraints.\n\nType .done on a new line when finished.",
    "cyan"
  );
  console.log();

  const description = await promptMultiline("Goals description:", "Type .done on a new line when finished");

  if (!description.trim()) {
    return null;
  }

  return description;
}

// Generate and validate goals step
async function generateAndValidateGoals(config, description) {
  clearScreen();
  printHeader();
  console.log(c("bold", "Step 3: Generating Goals\n"));

  const spinner = createSpinner("Generating goals via LLM...");
  spinner.start();

  let goals;
  try {
    goals = await generateGoals(config, description);
    spinner.stop("Goals generated successfully");
  } catch (error) {
    spinner.fail("Failed to generate goals");
    console.log(c("red", `Error: ${error.message}`));
    return null;
  }

  // Validate and display
  console.log();
  const errors = validateGoals(goals);

  if (errors.length > 0) {
    console.log(c("yellow", "Validation warnings:"));
    for (const err of errors) {
      console.log(`  ${c("yellow", "[!]")} ${err}`);
    }
    console.log();
  }

  printBox("Generated Goals", JSON.stringify(goals, null, 2), "green");

  return goals;
}

// Main application
async function main() {
  clearScreen();
  printHeader();

  // Step 1: Configure LLM (done once)
  console.log(c("bold", "Step 1: Configure LLM Provider\n"));

  const provider = await promptSelect("Select your LLM provider:", [
    { label: "Anthropic (Claude)", value: LLMProvider.ANTHROPIC },
    { label: "OpenAI (ChatGPT)", value: LLMProvider.OPENAI },
    { label: "Custom Provider", value: LLMProvider.CUSTOM },
  ]);

  console.log();

  const defaultEndpoint = DEFAULT_ENDPOINTS[provider];
  const defaultModel = DEFAULT_MODELS[provider];

  const endpoint = await prompt("API Endpoint", defaultEndpoint);
  if (!endpoint) {
    console.log(c("red", "Endpoint is required. Exiting."));
    process.exit(1);
  }

  const model = await prompt("Model name (optional)", defaultModel);

  const apiKey = await promptPassword("API Key");
  if (!apiKey) {
    console.log(c("red", "API key is required. Exiting."));
    process.exit(1);
  }

  const config = {
    provider,
    endpoint,
    model: model || null,
    apiKey,
  };

  console.log();
  console.log(`${c("green", "[+]")} Provider: ${c("cyan", config.provider)}`);
  console.log(`${c("green", "[+]")} Endpoint: ${c("cyan", config.endpoint)}`);
  console.log(`${c("green", "[+]")} Model: ${c("cyan", config.model || "default")}`);
  console.log(`${c("green", "[+]")} API Key: ${c("cyan", "*".repeat(8) + "..." + config.apiKey.slice(-4))}`);
  console.log();

  const proceed = await promptConfirm("Continue with these settings?", true);
  if (!proceed) {
    console.log(c("yellow", "Cancelled."));
    process.exit(0);
  }

  // Goals generation loop - allows adding more goals
  let continueGenerating = true;
  let allGoals = null;
  let savedFilepath = null;

  while (continueGenerating) {
    // Step 2: Get goals description
    const description = await getGoalsDescription();

    if (!description) {
      if (allGoals) {
        // Already have some goals, just skip this round
        console.log(c("yellow", "No description provided. Returning to menu."));
        continueGenerating = false;
        continue;
      } else {
        console.log(c("red", "No description provided. Exiting."));
        process.exit(1);
      }
    }

    // Step 3: Generate and validate goals
    const goals = await generateAndValidateGoals(config, description);

    if (!goals) {
      if (allGoals) {
        console.log(c("yellow", "Generation failed. Returning to menu."));
        continueGenerating = false;
        continue;
      } else {
        process.exit(1);
      }
    }

    // Merge with existing goals if any
    if (allGoals) {
      // Append new goals to existing ones, ensuring unique IDs
      const existingIds = new Set(allGoals.goals.map(g => g.id));
      for (const goal of goals.goals) {
        let newId = goal.id;
        let counter = 1;
        while (existingIds.has(newId)) {
          newId = `${goal.id}-${counter++}`;
        }
        goal.id = newId;
        existingIds.add(newId);
        allGoals.goals.push(goal);
      }
      console.log();
      console.log(`${c("green", "[+]")} Added ${goals.goals.length} new goal(s). Total: ${allGoals.goals.length} goals.`);
    } else {
      allGoals = goals;
    }

    // Step 5: Save
    console.log();
    const shouldSave = await promptConfirm("Save goals to file?", true);

    if (shouldSave) {
      const defaultFilename = savedFilepath ? savedFilepath.split("/").pop() : "goals.json";
      const filename = await prompt("Filename", defaultFilename);

      if (filename) {
        savedFilepath = await saveGoals(allGoals, filename);
        console.log(`\n${c("green", "[+]")} Saved to: ${c("cyan", savedFilepath)}`);

        // Step 6: Post-generation menu
        const result = await postGenerationMenu(config, allGoals, savedFilepath);

        if (result.action === "add_goals") {
          // Loop back to add more goals
          continueGenerating = true;
        } else {
          continueGenerating = false;
        }
      } else {
        continueGenerating = false;
      }
    } else {
      console.log(`\n${c("dim", "Exiting without saving.")}`);
      continueGenerating = false;
    }
  }
}

// Run
main().catch((err) => {
  console.error(c("red", `Fatal error: ${err.message}`));
  process.exit(1);
});
