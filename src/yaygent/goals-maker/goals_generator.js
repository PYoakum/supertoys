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
  violet: "\x1b[38;5;135m",
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
const BORDER_HEIGHT = 3; // Height of animated header and footer

// Animation state (declared early for use in clearScreen)
const animFrames = [" ■ ", " ≣ ", " ≡ ", " = ", " - ", " ▪ "];
let animationInterval = null;
let animFrameIndex = 0;

// Track current content row for absolute positioning
let currentContentRow = 5; // Start after header (3) + separator line (1) + 1
let currentContentCol = 1; // Current column position (1-indexed)
let inMultilineInput = false; // Flag to prevent cursor repositioning during multiline input
let multilineInputStartRow = 14; // Where multiline input begins
let multilineInputCurrentRow = 14; // Current row during multiline input

function getTerminalSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24
  };
}

function clearScreen() {
  // Clear entire screen
  process.stdout.write("\x1b[2J\x1b[H");

  // Reset content row tracker (after header + top separator)
  currentContentRow = BORDER_HEIGHT + 2;

  // Redraw borders immediately if animation is running
  if (animationInterval) {
    renderAnimatedBorders();
  }

  // Move cursor to content area (after header rows)
  moveTo(currentContentRow, 1);
}

// Get the maximum row for content (5th from bottom, above separator line)
function getMaxContentRow() {
  const { rows } = getTerminalSize();
  return rows - BORDER_HEIGHT - 2; // Leave room for bottom separator line above footer
}

// Get the minimum row for content (after header + top separator)
function getMinContentRow() {
  return BORDER_HEIGHT + 2; // Row 5 (after 3-row header + 1 separator)
}

// Console buffer for scrollable output
const consoleBuffer = {
  lines: [],           // All output lines
  scrollOffset: 0,     // Lines scrolled up from bottom (0 = at bottom)
  followMode: true,    // Auto-scroll to bottom on new output
  scrollEnabled: false // Whether scroll mode is active
};

// Get visible line count in content area
function getVisibleLineCount() {
  const { rows } = getTerminalSize();
  return rows - (BORDER_HEIGHT * 2) - 3; // Content area minus both separator lines
}

// Render the console buffer to screen
function renderConsoleBuffer() {
  const { rows } = getTerminalSize();
  const startRow = BORDER_HEIGHT + 2; // After header + top separator
  const visibleLines = getVisibleLineCount();
  const totalLines = consoleBuffer.lines.length;

  // Calculate which lines to show
  const endIndex = totalLines - consoleBuffer.scrollOffset;
  const startIndex = Math.max(0, endIndex - visibleLines);

  // Clear and render content area
  for (let i = 0; i < visibleLines; i++) {
    const lineIndex = startIndex + i;
    const row = startRow + i;
    moveTo(row, 1);
    process.stdout.write("\x1b[2K"); // Clear line
    if (lineIndex >= 0 && lineIndex < endIndex && lineIndex < totalLines) {
      process.stdout.write(consoleBuffer.lines[lineIndex]);
    }
  }

  // Show scroll indicator on status line (just above bottom separator)
  const statusRow = rows - BORDER_HEIGHT - 2;
  moveTo(statusRow, 1);
  process.stdout.write("\x1b[2K");
  if (consoleBuffer.scrollEnabled) {
    const position = totalLines > 0 ? Math.round(((totalLines - consoleBuffer.scrollOffset) / totalLines) * 100) : 100;
    const scrollStatus = consoleBuffer.scrollOffset > 0
      ? `${c("dim", "[")}${c("cyan", "^v")}${c("dim", "] Scroll")}  ${c("dim", "[")}${c("cyan", "f")}${c("dim", "] Follow")}  ${c("dim", `${position}%`)}`
      : `${c("dim", "[")}${c("cyan", "^v")}${c("dim", "] Scroll")}  ${c("green", "[*] Following")}`;
    process.stdout.write(scrollStatus);
  }
}

// Scroll the console buffer
function scrollConsole(direction) {
  const visibleLines = getVisibleLineCount();
  const maxScroll = Math.max(0, consoleBuffer.lines.length - visibleLines);

  if (direction === 'up') {
    consoleBuffer.scrollOffset = Math.min(consoleBuffer.scrollOffset + 1, maxScroll);
    consoleBuffer.followMode = false;
  } else if (direction === 'down') {
    consoleBuffer.scrollOffset = Math.max(consoleBuffer.scrollOffset - 1, 0);
    if (consoleBuffer.scrollOffset === 0) {
      consoleBuffer.followMode = true;
    }
  } else if (direction === 'pageup') {
    consoleBuffer.scrollOffset = Math.min(consoleBuffer.scrollOffset + visibleLines, maxScroll);
    consoleBuffer.followMode = false;
  } else if (direction === 'pagedown') {
    consoleBuffer.scrollOffset = Math.max(consoleBuffer.scrollOffset - visibleLines, 0);
    if (consoleBuffer.scrollOffset === 0) {
      consoleBuffer.followMode = true;
    }
  } else if (direction === 'top') {
    consoleBuffer.scrollOffset = maxScroll;
    consoleBuffer.followMode = false;
  } else if (direction === 'bottom') {
    consoleBuffer.scrollOffset = 0;
    consoleBuffer.followMode = true;
  }

  renderConsoleBuffer();
}

// Print a line to the console buffer
function printLine(text = "") {
  // Add to buffer
  consoleBuffer.lines.push(text);

  // If in follow mode, keep scroll at bottom
  if (consoleBuffer.followMode) {
    consoleBuffer.scrollOffset = 0;
  }

  // Render if scroll mode is enabled, otherwise use direct output
  if (consoleBuffer.scrollEnabled) {
    renderConsoleBuffer();
  } else {
    // Direct output mode (for menus, prompts, etc.)
    const minRow = getMinContentRow();
    const maxRow = getMaxContentRow();
    // Clamp currentContentRow to valid bounds
    if (currentContentRow < minRow) currentContentRow = minRow;
    if (currentContentRow <= maxRow) {
      moveTo(currentContentRow, 1);
      process.stdout.write("\x1b[2K");
      if (text) process.stdout.write(text);
      currentContentRow++;

      // Clean up rows near separator to fix border artifacts
      const { rows } = getTerminalSize();
      for (let i = 5; i <= 7; i++) {
        moveTo(rows - i, 1);
        process.stdout.write("\x1b[2K");
      }

      // Restore cursor position
      moveTo(currentContentRow, 1);
    }
  }
}

// Enable scroll mode for console output
function enableScrollMode() {
  consoleBuffer.scrollEnabled = true;
  consoleBuffer.followMode = true;
  consoleBuffer.scrollOffset = 0;
}

// Disable scroll mode
function disableScrollMode() {
  consoleBuffer.scrollEnabled = false;
}

// Clear the console buffer
function clearConsoleBuffer() {
  consoleBuffer.lines = [];
  consoleBuffer.scrollOffset = 0;
  consoleBuffer.followMode = true;
}

// Get current row for menu positioning
function getCurrentRow() {
  return currentContentRow;
}

// Clear the content area between separator lines (row 5 to row N-4)
function clearContentArea() {
  const { rows } = getTerminalSize();
  const startRow = BORDER_HEIGHT + 2; // After header + top separator
  const endRow = rows - BORDER_HEIGHT - 1; // Before bottom separator

  for (let row = startRow; row <= endRow; row++) {
    moveTo(row, 1);
    process.stdout.write("\x1b[2K"); // Clear line
  }

  // Reset content row to start
  currentContentRow = BORDER_HEIGHT + 2;
  moveTo(currentContentRow, 1);

  // Clear buffer too
  clearConsoleBuffer();
}

function resetScrollRegion() {
  process.stdout.write("\x1b[r"); // Reset scroll region to full screen
}

function hideCursor() {
  process.stdout.write("\x1b[?25l");
}

function showCursor() {
  process.stdout.write("\x1b[?25h");
}

function moveTo(row, col) {
  process.stdout.write(`\x1b[${row};${col}H`);
}

// Query current cursor row position
async function getCursorRow() {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    // Check if we can use raw mode
    if (!stdin.setRawMode) {
      resolve(BORDER_HEIGHT + 1); // Default to content start
      return;
    }

    const wasRaw = stdin.isRaw;

    try {
      if (!wasRaw) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.setEncoding("utf8");

      let response = "";
      let resolved = false;

      const onData = (data) => {
        if (resolved) return;
        response += data;
        // Response format: \x1b[row;colR
        const match = response.match(/\x1b\[(\d+);(\d+)R/);
        if (match) {
          resolved = true;
          stdin.removeListener("data", onData);
          if (!wasRaw && stdin.setRawMode) {
            stdin.setRawMode(false);
          }
          resolve(parseInt(match[1], 10));
        }
      };

      stdin.on("data", onData);

      // Request cursor position (DSR - Device Status Report)
      process.stdout.write("\x1b[6n");

      // Timeout fallback
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        stdin.removeListener("data", onData);
        if (!wasRaw && stdin.setRawMode) {
          stdin.setRawMode(false);
        }
        resolve(BORDER_HEIGHT + 1); // Default to content start
      }, 100);
    } catch (e) {
      resolve(BORDER_HEIGHT + 1); // Default to content start
    }
  });
}

function centerText(text, width) {
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, ''); // Strip ANSI codes for length calc
  const padding = Math.max(0, Math.floor((width - stripped.length) / 2));
  return ' '.repeat(padding) + text;
}

function printCentered(text) {
  const { cols } = getTerminalSize();
  printLine(centerText(text, cols));
}

// Header title configuration
const HEADER_TITLE = "Goals Generator TUI";
const TITLE_BUFFER = 1; // 1-column buffer on each side of title

// Subtitle (row 3) - can be changed dynamically
let headerSubtitle = "";

// Set the header subtitle (appears on row 3)
function setHeaderSubtitle(text) {
  headerSubtitle = text || "";
  // Trigger immediate re-render if animation is running
  if (animationInterval) {
    renderAnimatedBorders();
  }
}

// Animated header/footer rendering
function renderAnimatedBorders() {
  const { cols, rows } = getTerminalSize();

  // Calculate positions for title (row 1) and subtitle (row 3)
  const titleRow = 1;
  const subtitleRow = 3;
  const titleStartCol = Math.floor((cols - HEADER_TITLE.length) / 2);
  const subtitleStartCol = headerSubtitle ? Math.floor((cols - headerSubtitle.length) / 2) : cols;

  // Calculate a single rectangular buffer zone spanning all header rows
  // Based on the wider of title or subtitle, plus 1 column buffer on each side
  const maxTextWidth = Math.max(HEADER_TITLE.length, headerSubtitle ? headerSubtitle.length : 0);
  const bufferCenterCol = Math.floor(cols / 2);
  const bufferStart = bufferCenterCol - Math.floor(maxTextWidth / 2) - TITLE_BUFFER;
  const bufferEnd = bufferCenterCol + Math.ceil(maxTextWidth / 2) + TITLE_BUFFER;

  // Build all output as a single string for atomic write
  let output = "";

  // Save cursor position during multiline input (readline manages cursor, we must restore it)
  if (inMultilineInput) {
    output += "\x1b[s"; // Save cursor
  }

  // Render header (top 3 rows) - all rows have the same buffer zone
  for (let row = 0; row < BORDER_HEIGHT; row++) {
    output += `\x1b[${row + 1};1H`; // moveTo
    const currentRow = row + 1;

    // Render animation with rectangular gap for all header rows
    let line = "";
    for (let col = 0; col < cols; col += 3) {
      const frameOffset = (animFrameIndex + row + Math.floor(col / 3)) % animFrames.length;
      const segment = animFrames[frameOffset];

      // Add each character, but skip if in buffer zone
      for (let i = 0; i < segment.length && col + i < cols; i++) {
        const actualCol = col + i;
        if (actualCol >= bufferStart && actualCol < bufferEnd) {
          line += " "; // Space in buffer zone
        } else {
          line += segment[i];
        }
      }
    }
    output += colors.dim + line.slice(0, cols) + colors.reset;

    // Draw title on row 1
    if (currentRow === titleRow) {
      output += `\x1b[${currentRow};${titleStartCol + 1}H`;
      output += colors.bold + HEADER_TITLE + colors.reset;
    }
    // Draw subtitle on row 3
    else if (currentRow === subtitleRow && headerSubtitle) {
      output += `\x1b[${currentRow};${subtitleStartCol + 1}H`;
      output += colors.bold + headerSubtitle + colors.reset;
    }
  }

  // Render top separator line (row 4 - right after header)
  const topSeparatorRow = BORDER_HEIGHT + 1;
  output += `\x1b[${topSeparatorRow};1H`;
  output += colors.violet + "—".repeat(cols) + colors.reset;

  // Bottom separator row (4th from bottom)
  const separatorRow = rows - BORDER_HEIGHT;

  // NOTE: We intentionally don't clear rows during multiline input.
  // The multilineInputCurrentRow only updates on Enter, so clearing rows
  // beyond it would wipe out text the user is actively typing or pasting
  // that has wrapped to subsequent lines.

  // Render bottom separator line (4th row from bottom - solid violet line)
  output += `\x1b[${separatorRow};1H`;
  output += colors.violet + "—".repeat(cols) + colors.reset;

  // Render footer (bottom 3 rows)
  for (let row = 0; row < BORDER_HEIGHT; row++) {
    output += `\x1b[${rows - BORDER_HEIGHT + row + 1};1H`;

    let line = "";
    for (let col = 0; col < cols; col += 3) {
      // Reverse direction for footer to create mirror effect
      const frameOffset = (animFrameIndex + (BORDER_HEIGHT - 1 - row) + Math.floor(col / 3)) % animFrames.length;
      line += animFrames[frameOffset];
    }

    output += colors.dim + line.slice(0, cols) + colors.reset;
  }

  // Move cursor back to content position
  if (inMultilineInput) {
    output += "\x1b[u"; // Restore cursor to where readline had it
  } else {
    output += `\x1b[${currentContentRow};${currentContentCol}H`;
  }

  // Write all at once for atomic rendering
  process.stdout.write(output);

  animFrameIndex = (animFrameIndex + 1) % animFrames.length;
}

function startBorderAnimation() {
  if (animationInterval) return;

  // Reset and position cursor at start of content area (after header + top separator)
  currentContentRow = BORDER_HEIGHT + 2;
  moveTo(currentContentRow, 1);

  animationInterval = setInterval(renderAnimatedBorders, 300);
  renderAnimatedBorders(); // Initial render
}

function stopBorderAnimation() {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
}

function pauseBorderAnimation() {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
    return true; // Was running
  }
  return false;
}

function resumeBorderAnimation() {
  if (!animationInterval) {
    renderAnimatedBorders(); // Immediately render
    animationInterval = setInterval(renderAnimatedBorders, 300);
  }
}

function printHeader() {
  // Title is now in the animated header, just add spacing
  printLine();
}

function printBox(title, content, color = "green") {
  const lines = content.split("\n");
  const maxLen = Math.max(title.length, ...lines.map((l) => l.length)) + 2;
  const border = "─".repeat(maxLen + 2);

  printLine(c(color, `┌─ ${title} ${border.slice(title.length + 3)}┐`));
  for (const line of lines) {
    printLine(c(color, "│ ") + line.padEnd(maxLen) + c(color, " │"));
  }
  printLine(c(color, `└${border}┘`));
}

/**
 * Print content as a form field with label (no border)
 * @param {string} label - Field label
 * @param {string} content - Content to display
 * @param {string} [labelColor='cyan'] - Color for label
 */
function printFormField(label, content, labelColor = "cyan") {
  printLine(c(labelColor, `${label}:`));
  printLine();
  const lines = content.split("\n");
  for (const line of lines) {
    printLine(`  ${line}`);
  }
  printLine();
}

/**
 * Format goals as a readable summary
 * @param {Object} goals - Goals object
 * @returns {string} Formatted summary
 */
function formatGoalsSummary(goals) {
  const lines = [];

  // Metadata
  if (goals.metadata) {
    if (goals.metadata.name) {
      lines.push(`${c("bold", "Name:")} ${goals.metadata.name}`);
    }
    if (goals.metadata.description) {
      lines.push(`${c("bold", "Description:")} ${goals.metadata.description}`);
    }
    if (goals.metadata.tags && goals.metadata.tags.length > 0) {
      lines.push(`${c("bold", "Tags:")} ${goals.metadata.tags.join(", ")}`);
    }
    lines.push("");
  }

  // Goals list
  lines.push(`${c("bold", "Goals:")} (${goals.goals.length} total)`);
  lines.push("");

  for (let i = 0; i < goals.goals.length; i++) {
    const goal = goals.goals[i];
    const num = `${i + 1}.`;

    lines.push(`  ${c("cyan", num)} ${c("bold", goal.id)}`);
    lines.push(`     ${goal.objective}`);

    if (goal.priority) {
      lines.push(`     ${c("dim", `Priority: ${goal.priority}`)}`);
    }

    if (goal.dependencies && goal.dependencies.length > 0) {
      lines.push(`     ${c("dim", `Depends on: ${goal.dependencies.join(", ")}`)}`);
    }

    if (goal.criteria && goal.criteria.success) {
      lines.push(`     ${c("dim", `Success criteria: ${goal.criteria.success.length} items`)}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a single goal in detail for paged review
 * @param {Object} goal - Goal object
 * @param {number} index - Goal index (0-based)
 * @param {number} total - Total number of goals
 * @returns {string[]} Array of lines to display
 */
function formatGoalDetail(goal, index, total) {
  const lines = [];

  // Goal ID and objective
  lines.push(`${c("bold", "ID:")} ${c("cyan", goal.id)}`);
  lines.push("");
  lines.push(`${c("bold", "Objective:")}`);
  // Word wrap objective at ~60 chars
  const words = goal.objective.split(" ");
  let line = "  ";
  for (const word of words) {
    if (line.length + word.length > 62) {
      lines.push(line);
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) lines.push(line);
  lines.push("");

  // Priority
  if (goal.priority) {
    const priorityColor = goal.priority <= 3 ? "red" : goal.priority <= 6 ? "yellow" : "green";
    lines.push(`${c("bold", "Priority:")} ${c(priorityColor, goal.priority + "/10")}`);
  }

  // Dependencies
  if (goal.dependencies && goal.dependencies.length > 0) {
    lines.push(`${c("bold", "Dependencies:")}`);
    for (const dep of goal.dependencies) {
      lines.push(`  ${c("dim", "->")} ${dep}`);
    }
  } else {
    lines.push(`${c("bold", "Dependencies:")} ${c("dim", "None")}`);
  }
  lines.push("");

  // Success criteria
  if (goal.criteria && goal.criteria.success && goal.criteria.success.length > 0) {
    lines.push(`${c("bold", "Success Criteria:")}`);
    for (const criterion of goal.criteria.success) {
      lines.push(`  ${c("green", "[+]")} ${criterion}`);
    }
    lines.push("");
  }

  // Acceptance criteria
  if (goal.criteria && goal.criteria.acceptance && goal.criteria.acceptance.length > 0) {
    lines.push(`${c("bold", "Acceptance Criteria:")}`);
    for (const criterion of goal.criteria.acceptance) {
      lines.push(`  ${c("cyan", "*")} ${criterion}`);
    }
    lines.push("");
  }

  // Constraints
  if (goal.constraints && goal.constraints.length > 0) {
    lines.push(`${c("bold", "Constraints:")}`);
    for (const constraint of goal.constraints) {
      lines.push(`  ${c("yellow", "!")} ${constraint}`);
    }
    lines.push("");
  }

  // Context
  if (goal.context && Object.keys(goal.context).length > 0) {
    lines.push(`${c("bold", "Context:")}`);
    for (const [key, value] of Object.entries(goal.context)) {
      lines.push(`  ${c("dim", key + ":")} ${value}`);
    }
    lines.push("");
  }

  return lines;
}

/**
 * Paged goal review with tab-like navigation
 * @param {Object} goals - Goals object with goals array
 * @returns {Promise<boolean>} True if user confirms to proceed
 */
async function reviewGoals(goals) {
  if (!goals.goals || goals.goals.length === 0) {
    return true;
  }

  let currentIndex = 0;
  const total = goals.goals.length;
  const contentStartRow = currentContentRow;

  // Render function for the current goal page
  const renderPage = () => {
    // Reset to content start
    currentContentRow = contentStartRow;

    const { rows } = getTerminalSize();
    const availableRows = rows - BORDER_HEIGHT - contentStartRow - 3; // Leave room for nav help

    // Clear the content area
    for (let i = 0; i < availableRows + 3; i++) {
      moveTo(contentStartRow + i, 1);
      process.stdout.write("\x1b[2K");
    }

    // Render tab bar
    moveTo(contentStartRow, 1);
    let tabBar = "";
    for (let i = 0; i < total; i++) {
      const goalId = goals.goals[i].id;
      const shortId = goalId.length > 12 ? goalId.slice(0, 11) + "…" : goalId;
      if (i === currentIndex) {
        tabBar += c("bgCyan", c("bold", ` ${shortId} `)) + " ";
      } else {
        tabBar += c("dim", ` ${shortId} `) + " ";
      }
    }
    process.stdout.write(tabBar);
    currentContentRow++;

    // Separator line
    printLine(c("dim", "─".repeat(60)));
    printLine();

    // Render goal detail
    const goal = goals.goals[currentIndex];
    const detailLines = formatGoalDetail(goal, currentIndex, total);

    for (const line of detailLines) {
      if (currentContentRow < rows - BORDER_HEIGHT - 2) {
        printLine(line);
      }
    }

    // Navigation help at bottom of content area
    const navRow = rows - BORDER_HEIGHT - 1;
    moveTo(navRow, 1);
    process.stdout.write("\x1b[2K");
    const navHelp = `${c("dim", "[")}${c("cyan", "<-")}${c("dim", "/")}${c("cyan", "->")}${c("dim", "] Navigate")}  ` +
                    `${c("dim", "[")}${c("cyan", "Enter")}${c("dim", "] Continue")}  ` +
                    `${c("dim", "[")}${c("cyan", "q")}${c("dim", "] Cancel")}  ` +
                    `${c("dim", "Goal")} ${c("bold", (currentIndex + 1) + "/" + total)}`;
    process.stdout.write(navHelp);
  };

  // Initial render
  renderPage();

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onKey = (key) => {
      if (key === "\u0003" || key === "q" || key === "Q") {
        // Ctrl+C or q - cancel
        stdin.setRawMode(false);
        stdin.removeListener("data", onKey);
        showCursor();
        printLine();
        resolve(false);
      } else if (key === "\r" || key === "\n") {
        // Enter - proceed
        stdin.setRawMode(false);
        stdin.removeListener("data", onKey);
        showCursor();
        // Move past the navigation area
        const { rows } = getTerminalSize();
        currentContentRow = rows - BORDER_HEIGHT;
        moveTo(currentContentRow, 1);
        resolve(true);
      } else if (key === "\x1b[C" || key === "l" || key === "\t") {
        // Right arrow, l, or Tab - next
        if (currentIndex < total - 1) {
          currentIndex++;
          renderPage();
        }
      } else if (key === "\x1b[D" || key === "h" || key === "\x1b[Z") {
        // Left arrow, h, or Shift+Tab - previous
        if (currentIndex > 0) {
          currentIndex--;
          renderPage();
        }
      } else if (key === "\x1b[H" || key === "g") {
        // Home or g - first goal
        currentIndex = 0;
        renderPage();
      } else if (key === "\x1b[F" || key === "G") {
        // End or G - last goal
        currentIndex = total - 1;
        renderPage();
      }
    };

    hideCursor();
    stdin.on("data", onKey);
  });
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

  // Ensure currentContentRow is within valid bounds
  const minRow = getMinContentRow();
  const maxRow = getMaxContentRow();
  if (currentContentRow < minRow) currentContentRow = minRow;
  if (currentContentRow > maxRow) currentContentRow = maxRow;

  // Position at current tracked row
  moveTo(currentContentRow, 1);
  process.stdout.write("\x1b[2K"); // Clear line

  // Calculate prompt length for cursor tracking
  // "? " + question + " (default)" + ": "
  const defaultHintLen = defaultValue ? defaultValue.length + 3 : 0; // " (default)"
  const promptLen = 2 + question.length + defaultHintLen + 2; // "? " + question + hint + ": "

  return new Promise((resolve) => {
    // Set column position for animation (will be at end of prompt when waiting for input)
    currentContentCol = promptLen + 1;

    rl.question(`${c("cyan", "?")} ${c("bold", question)}${defaultHint}: `, (answer) => {
      rl.close();
      currentContentRow++; // Track the row after input
      currentContentCol = 1; // Reset column
      // Clamp to max content row
      if (currentContentRow > maxRow) currentContentRow = maxRow;

      // Clean up rows near separator to fix border artifacts
      const { rows } = getTerminalSize();
      for (let i = 5; i <= 7; i++) {
        moveTo(rows - i, 1);
        process.stdout.write("\x1b[2K");
      }

      resolve(answer.trim() || defaultValue);
    });
  });
}

async function promptPassword(question) {
  const rl = createRL();

  // Ensure currentContentRow is within valid bounds
  const minRow = getMinContentRow();
  const maxRow = getMaxContentRow();
  if (currentContentRow < minRow) currentContentRow = minRow;
  if (currentContentRow > maxRow) currentContentRow = maxRow;

  // Capture the row we're using for this prompt
  const promptRow = currentContentRow;

  // Position at current tracked row
  moveTo(promptRow, 1);
  process.stdout.write("\x1b[2K"); // Clear line

  // Build the prompt prefix
  const promptPrefix = `${c("cyan", "?")} ${c("bold", question)}: `;
  const promptPrefixLen = question.length + 4; // "? " + question + ": "

  return new Promise((resolve) => {
    process.stdout.write(promptPrefix);

    // Set column position for animation to restore to (after the prompt)
    currentContentCol = promptPrefixLen + 1;

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";

    // Function to redraw the masked input field
    const redrawInput = () => {
      // Move to exact row and column (animation may have moved cursor)
      moveTo(promptRow, promptPrefixLen + 1);
      process.stdout.write("\x1b[K"); // Clear from cursor to end of line
      // Show asterisks for the password length
      if (password.length > 0) {
        process.stdout.write("*".repeat(password.length));
      }
      // Update column position for animation to restore to
      currentContentCol = promptPrefixLen + 1 + password.length;
    };

    const onData = (data) => {
      // Handle each character in the data (paste sends multiple chars)
      for (const char of data) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.removeListener("data", onData);

          // Clean up rows near separator to fix border artifacts
          const { rows } = getTerminalSize();
          for (let i = 5; i <= 7; i++) {
            moveTo(rows - i, 1);
            process.stdout.write("\x1b[2K");
          }

          // Move to end of prompt row before newline
          moveTo(promptRow, promptPrefixLen + 1 + password.length);
          process.stdout.write("\n");
          currentContentRow = promptRow + 1; // Track the row after input
          currentContentCol = 1; // Reset column to start

          rl.close();
          resolve(password);
          return;
        } else if (char === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          process.exit(0);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            redrawInput();
          }
        } else if (char >= " " || char === "\t") {
          // Printable character or tab
          password += char;
          redrawInput();
        }
        // Ignore other control characters
      }
    };

    stdin.on("data", onData);
  });
}

async function promptSelect(question, choices) {
  let selectedIndex = 0;

  // Capture the starting row from our tracker
  const menuStartRow = getCurrentRow();

  // Render choice at specific index
  const renderChoice = (index) => {
    const row = menuStartRow + 1 + index;
    const prefix = index === selectedIndex ? c("cyan", "> ") : "  ";
    const text = index === selectedIndex ? c("cyan", choices[index].label) : choices[index].label;
    moveTo(row, 1);
    process.stdout.write("\x1b[2K" + prefix + text);
    // Update cursor tracking for the selected item
    if (index === selectedIndex) {
      currentContentRow = row;
      currentContentCol = 3 + choices[index].label.length;
    }
  };

  // Render entire menu
  const renderMenu = () => {
    // Question line
    moveTo(menuStartRow, 1);
    process.stdout.write("\x1b[2K" + `${c("cyan", "?")} ${c("bold", question)}`);

    // Choice lines
    for (let i = 0; i < choices.length; i++) {
      renderChoice(i);
    }
  };

  // Initial render
  renderMenu();

  // Row tracker is set by renderChoice for the selected item

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onKey = (key) => {
      if (key === "\u0003") {
        // Ctrl+C
        stdin.setRawMode(false);
        showCursor();
        process.exit(0);
      } else if (key === "\r" || key === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onKey);

        // Clean up rows near separator to fix border artifacts
        const { rows } = getTerminalSize();
        for (let i = 5; i <= 7; i++) {
          moveTo(rows - i, 1);
          process.stdout.write("\x1b[2K");
        }

        // Move cursor below menu and reset column tracking
        currentContentRow = menuStartRow + 1 + choices.length;
        currentContentCol = 1;
        moveTo(currentContentRow, 1);
        showCursor();
        resolve(choices[selectedIndex].value);
      } else if (key === "\x1b[A" || key === "k") {
        // Up arrow or k
        const prevIndex = selectedIndex;
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        renderChoice(prevIndex);
        renderChoice(selectedIndex);
      } else if (key === "\x1b[B" || key === "j") {
        // Down arrow or j
        const prevIndex = selectedIndex;
        selectedIndex = (selectedIndex + 1) % choices.length;
        renderChoice(prevIndex);
        renderChoice(selectedIndex);
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

async function promptMultiline(question, instruction, centered = false, startRow = 14) {
  // Only print question/instruction if provided
  if (question) {
    if (centered) {
      printCentered(`${c("cyan", "?")} ${c("bold", question)}`);
      if (instruction) printCentered(c("dim", instruction));
    } else {
      printLine(`${c("cyan", "?")} ${c("bold", question)}`);
      if (instruction) printLine(c("dim", `   ${instruction}`));
    }
    printLine();
  }

  const { cols, rows } = getTerminalSize();

  // Input starts at fixed row (default 14)
  let inputIndent = 1;
  if (centered) {
    inputIndent = Math.floor(cols / 4); // Indent input from left
  }

  // Set fixed starting position for input
  multilineInputStartRow = startRow;
  multilineInputCurrentRow = startRow;
  currentContentRow = startRow;
  currentContentCol = inputIndent;
  moveTo(currentContentRow, inputIndent);

  // Enable multiline input mode
  inMultilineInput = true;

  const lines = [];
  const rl = createRL();

  // Calculate visual rows a line takes (accounting for word wrap)
  const calcVisualRows = (lineText) => {
    const availableWidth = cols - inputIndent;
    if (lineText.length === 0) return 1;
    return Math.ceil(lineText.length / availableWidth);
  };

  // Maximum row before footer (leave 5 rows: separator + 3 footer + 1 buffer)
  const maxContentRow = rows - BORDER_HEIGHT - 2;

  return new Promise((resolve) => {
    rl.on("line", (line) => {
      if (line === ".done") {
        rl.close();
        inMultilineInput = false;
        multilineInputCurrentRow = multilineInputStartRow;
        currentContentCol = 1;
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
        // Track visual rows used (including word wrap)
        const visualRows = calcVisualRows(line);
        multilineInputCurrentRow += visualRows;
        currentContentRow = multilineInputCurrentRow;

        // Clamp to max content area
        if (multilineInputCurrentRow > maxContentRow) {
          multilineInputCurrentRow = maxContentRow;
          currentContentRow = maxContentRow;
        }
      }
    });

    rl.on("close", () => {
      inMultilineInput = false;
      multilineInputCurrentRow = multilineInputStartRow;
      currentContentCol = 1;
      resolve(lines.join("\n"));
    });
  });
}

// Spinner utility
function createSpinner(text) {
  const frames = ["-", "\\", "|", "/"];
  let i = 0;
  let interval;
  const spinnerRow = currentContentRow; // Capture the row when spinner is created

  return {
    start() {
      hideCursor();
      moveTo(spinnerRow, 1);
      interval = setInterval(() => {
        moveTo(spinnerRow, 1);
        process.stdout.write("\x1b[2K"); // Clear line
        process.stdout.write(`${c("cyan", "[" + frames[i] + "]")} ${text}`);
        i = (i + 1) % frames.length;
      }, 100);
    },
    stop(finalText) {
      clearInterval(interval);
      moveTo(spinnerRow, 1);
      process.stdout.write("\x1b[2K"); // Clear line
      process.stdout.write(`${c("green", "[+]")} ${finalText}`);
      currentContentRow = spinnerRow + 1; // Move to next row
      showCursor();
    },
    fail(finalText) {
      clearInterval(interval);
      moveTo(spinnerRow, 1);
      process.stdout.write("\x1b[2K"); // Clear line
      process.stdout.write(`${c("red", "[x]")} ${finalText}`);
      currentContentRow = spinnerRow + 1; // Move to next row
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
  const progressRow = currentContentRow; // Capture the row when created
  currentContentRow++; // Reserve this row for the progress bar

  const render = (status = "") => {
    const percent = Math.floor((current / total) * 100);
    const filled = Math.floor((current / total) * width);
    const empty = width - filled;
    const bar = "[" + "=".repeat(filled) + (filled < width ? ">" : "") + " ".repeat(Math.max(0, empty - 1)) + "]";
    const line = `${c("cyan", bar)} ${percent.toString().padStart(3)}% ${status}`;
    moveTo(progressRow, 1);
    process.stdout.write("\x1b[2K" + line); // Clear line and write
    moveTo(currentContentRow, 1); // Return cursor to current content row
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
      // Progress bar row is already reserved, just ensure cursor is at current row
      moveTo(currentContentRow, 1);
    }
  };
}

// Run the agent pipeline with default settings
async function runAgent(goalsFilePath, config, options = {}) {
  const debug = options.debug || false;
  const throttled = options.throttled || false;

  // Reset content area for fresh output
  clearContentArea();

  printLine();
  const modeLabel = throttled ? "--- Agent Pipeline Execution (Throttled) ---" :
                    debug ? "--- Agent Pipeline Execution (Debug Mode) ---" :
                    "--- Agent Pipeline Execution ---";
  printLine(c("bold", modeLabel));
  printLine();

  const confirm = await promptConfirm("Start the agent pipeline?", true);
  if (!confirm) {
    printLine(c("yellow", "Pipeline cancelled."));
    return false;
  }

  // Create completed-work directory
  await mkdir(COMPLETED_WORK_DIR, { recursive: true });

  printLine();
  printLine(c("dim", "Starting pipeline execution..."));
  printLine(c("dim", `Output directory: ${COMPLETED_WORK_DIR}`));
  if (debug) {
    printLine(c("yellow", "Debug mode enabled - showing all output"));
  }
  if (throttled) {
    printLine(c("yellow", "Throttled mode enabled - 5 second delay between LLM requests"));
  }
  printLine();

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

    // Enable scrollable console output
    enableScrollMode();

    // Setup scroll key listener
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onScrollKey = (key) => {
      if (key === "\x1b[A" || key === "k") { // Up arrow or k
        scrollConsole('up');
      } else if (key === "\x1b[B" || key === "j") { // Down arrow or j
        scrollConsole('down');
      } else if (key === "\x1b[5~") { // Page Up
        scrollConsole('pageup');
      } else if (key === "\x1b[6~") { // Page Down
        scrollConsole('pagedown');
      } else if (key === "g") { // Go to top
        scrollConsole('top');
      } else if (key === "G" || key === "f") { // Go to bottom / Follow
        scrollConsole('bottom');
      } else if (key === "\u0003") { // Ctrl+C
        proc.kill();
      }
    };

    stdin.on("data", onScrollKey);

    let lastOutput = "";
    let recentLines = [];  // Keep last N lines for error context
    const MAX_CONTEXT_LINES = 10;

    const processOutput = (data, isStderr = false) => {
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
        // Normalize: strip ANSI codes first, then replace emoji with pictograms
        const normalized = line
          .replace(/\x1b\[[0-9;]*m/g, '')  // Strip ANSI escape codes
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

        // Track recent lines for error context
        recentLines.push(normalized);
        if (recentLines.length > MAX_CONTEXT_LINES) recentLines.shift();

        const stripped = normalized.replace(/\[.*?\]\s*/, "");

        // === ERRORS (always show) ===
        if (line.includes("✗") || line.includes("❌") || line.includes("[x]") ||
            line.includes("FATAL") || line.includes("Failed") ||
            /\bError\b/i.test(line) || /\bException\b/i.test(line)) {
          printLine(`  ${c("red", "[x]")} ${stripped}`);
        }
        // === RATE LIMITS & RETRIES (always show) ===
        else if (/rate.?limit/i.test(line) || /\b429\b/.test(line) ||
                 /retry/i.test(line) || /backoff/i.test(line) ||
                 /too many requests/i.test(line)) {
          printLine(`  ${c("yellow", "[!]")} ${stripped}`);
        }
        // === TIMEOUTS (always show) ===
        else if (/timeout/i.test(line) || /timed.?out/i.test(line) ||
                 /ETIMEDOUT/i.test(line) || /ECONNRESET/i.test(line)) {
          printLine(`  ${c("yellow", "[!]")} ${stripped}`);
        }
        // === WARNINGS (always show) ===
        else if (line.includes("[WARN]") || line.includes("[!]") ||
                 /\bwarning\b/i.test(line) || line.includes("⚠")) {
          printLine(`  ${c("yellow", "[!]")} ${stripped}`);
        }
        // === SUCCESS (always show) ===
        else if (line.includes("✓") || line.includes("✅") || line.includes("[+]") ||
                 line.includes("SUCCESS") || line.includes("Completed") ||
                 line.includes("passed") || line.includes("complete")) {
          printLine(`  ${c("green", "[+]")} ${stripped}`);
        }
        // === PHASES (always show) ===
        else if (line.includes("Phase") || line.includes("══") || line.includes("☆")) {
          printLine(`  ${c("cyan", "[>]")} ${stripped}`);
        }
        // === TASK EXECUTION (always show) ===
        else if (/\[\d+\/\d+\]/.test(line) || line.includes("Executing:") ||
                 line.includes("In Progress") || line.includes("Tool:")) {
          printLine(`  ${c("cyan", "[.]")} ${stripped}`);
        }
        // === PROGRESS & METRICS (always show) ===
        else if (line.includes("Progress:") || line.includes("█") ||
                 line.includes("[#]") || /Tokens?:/i.test(line) ||
                 /\d+\.\d+s/.test(line) && (line.includes("LLM") || line.includes("responded"))) {
          printLine(`  ${c("dim", "[#]")} ${stripped}`);
        }
        // === ARTIFACTS (always show) ===
        else if (line.includes("Artifacts:") || line.includes("file(s) created") ||
                 line.includes("Bundle") || /^\s+-\s+\S/.test(normalized)) {
          printLine(`  ${c("dim", "[~]")} ${stripped}`);
        }
        // === API/NETWORK ERRORS (always show) ===
        else if (/API\s*(Error|error)/i.test(line) || /status.?\d{3}/i.test(line) ||
                 /ENOTFOUND/i.test(line) || /ECONNREFUSED/i.test(line) ||
                 line.includes("fetch failed") || line.includes("network")) {
          printLine(`  ${c("red", "[x]")} ${stripped}`);
        }
        // === STDERR lines (show with warning) ===
        else if (isStderr && normalized.trim()) {
          printLine(`  ${c("yellow", "[stderr]")} ${stripped}`);
        }
        // === DEBUG MODE: show everything else ===
        else if (debug && normalized.trim()) {
          printLine(`  ${c("dim", "...")} ${normalized}`);
        }
      }
    };

    // Helper to show recent context on fatal error
    const showErrorContext = () => {
      if (recentLines.length > 0) {
        printLine();
        printLine(`  ${c("dim", "--- Recent output (last " + recentLines.length + " lines) ---")}`);
        recentLines.forEach(line => {
          printLine(`  ${c("dim", "  |")} ${line}`);
        });
      }
    };

    proc.stdout.on("data", (data) => processOutput(data, false));
    proc.stderr.on("data", (data) => processOutput(data, true));

    proc.on("close", (code) => {
      // Clean up scroll key listener
      stdin.removeListener("data", onScrollKey);
      stdin.setRawMode(false);
      disableScrollMode();

      progress.complete(code === 0 ? "Pipeline complete" : "Pipeline finished with errors");
      printLine();

      if (code === 0) {
        printLine(`${c("green", "[+]")} Agent pipeline finished successfully.`);
        printLine(`${c("green", "[+]")} Output saved to: ${c("cyan", COMPLETED_WORK_DIR)}`);
      } else {
        printLine(`${c("red", "[x]")} Pipeline exited with code ${code}`);
        showErrorContext();
        printLine();
        printLine(`${c("dim", "Common issues:")}`);
        printLine(`${c("dim", "  - Rate limiting: Wait a few minutes and try Putter mode")}`);
        printLine(`${c("dim", "  - API errors: Check your API key and endpoint")}`);
        printLine(`${c("dim", "  - Timeouts: Try reducing the number of goals")}`);
      }

      printLine();
      printLine(c("dim", "Press any key to continue..."));

      // Wait for keypress before returning
      stdin.setRawMode(true);
      stdin.once("data", () => {
        stdin.setRawMode(false);
        resolvePromise(code === 0);
      });
    });

    proc.on("error", (err) => {
      // Clean up scroll key listener
      stdin.removeListener("data", onScrollKey);
      stdin.setRawMode(false);
      disableScrollMode();

      progress.complete("Pipeline failed to start");
      printLine();
      printLine(`${c("red", "[x]")} Failed to start pipeline: ${err.message}`);
      resolvePromise(false);
    });
  });
}

// Run vigilant mode via goals-cli vigilant command
async function runVigilantMode(goalsFilePath, config) {
  // Reset content area for fresh output
  clearContentArea();

  printLine();
  printLine(c("bold", "--- Vigilant Mode (Auto-Retry with Error Learning) ---"));
  printLine();
  printLine(c("dim", "This mode will:"));
  printLine(c("dim", "  1. Run the pipeline in debug mode"));
  printLine(c("dim", "  2. On failure, collect error logs"));
  printLine(c("dim", "  3. Inject an error-assessment goal"));
  printLine(c("dim", "  4. Retry with learned context (up to 3 attempts)"));
  printLine();

  const confirm = await promptConfirm("Start vigilant mode?", true);
  if (!confirm) {
    printLine(c("yellow", "Vigilant mode cancelled."));
    return false;
  }

  // Create context directory if not exists
  const contextDir = join(dirname(goalsFilePath), "context");
  await mkdir(contextDir, { recursive: true });

  // Create completed-work directory
  await mkdir(COMPLETED_WORK_DIR, { recursive: true });

  printLine();
  printLine(c("dim", "Starting vigilant mode execution..."));
  printLine(c("dim", `Output directory: ${COMPLETED_WORK_DIR}`));
  printLine(c("dim", `Context directory: ${contextDir}`));
  printLine();

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

    // Enable scrollable console output
    enableScrollMode();

    // Setup scroll key listener
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onScrollKey = (key) => {
      if (key === "\x1b[A" || key === "k") { // Up arrow or k
        scrollConsole('up');
      } else if (key === "\x1b[B" || key === "j") { // Down arrow or j
        scrollConsole('down');
      } else if (key === "\x1b[5~") { // Page Up
        scrollConsole('pageup');
      } else if (key === "\x1b[6~") { // Page Down
        scrollConsole('pagedown');
      } else if (key === "g") { // Go to top
        scrollConsole('top');
      } else if (key === "G" || key === "f") { // Go to bottom / Follow
        scrollConsole('bottom');
      } else if (key === "\u0003") { // Ctrl+C
        proc.kill();
      }
    };

    stdin.on("data", onScrollKey);

    let recentLines = [];
    const MAX_CONTEXT_LINES = 10;

    const processOutput = (data, isStderr = false) => {
      const text = data.toString();
      const lines = text.split("\n").filter(l => l.trim());

      for (const line of lines) {
        // Strip ANSI codes before processing brackets
        const normalized = line.replace(/\x1b\[[0-9;]*m/g, '');
        const stripped = normalized.replace(/\[.*?\]\s*/, "").trim();

        // Track recent lines for error context
        recentLines.push(normalized);
        if (recentLines.length > MAX_CONTEXT_LINES) recentLines.shift();

        // === ERRORS (always show) ===
        if (line.includes("[x]") || line.includes("FATAL") ||
            /\bError\b/i.test(line) || /\bException\b/i.test(line) ||
            line.includes("failed") && !line.includes("Collecting")) {
          printLine(`  ${c("red", "[x]")} ${stripped}`);
        }
        // === RATE LIMITS & RETRIES (always show) ===
        else if (/rate.?limit/i.test(line) || /\b429\b/.test(line) ||
                 /retry/i.test(line) || /backoff/i.test(line)) {
          printLine(`  ${c("yellow", "[!]")} ${stripped}`);
        }
        // === TIMEOUTS (always show) ===
        else if (/timeout/i.test(line) || /timed.?out/i.test(line)) {
          printLine(`  ${c("yellow", "[!]")} ${stripped}`);
        }
        // === WARNINGS (always show) ===
        else if (line.includes("[WARN]") || line.includes("[!]") ||
                 /\bwarning\b/i.test(line)) {
          printLine(`  ${c("yellow", "[!]")} ${stripped}`);
        }
        // === SUCCESS (always show) ===
        else if (line.includes("SUCCESS") || line.includes("succeeded") ||
                 line.includes("[+]") || line.includes("passed")) {
          printLine(`  ${c("green", "[+]")} ${stripped}`);
        }
        // === ATTEMPT HEADERS (always show) ===
        else if (line.includes("VIGILANT MODE") || line.includes("Attempt") ||
                 line.includes("===" ) || line.includes("---") ||
                 line.includes("Phase") || line.includes("☆")) {
          printLine(`  ${c("cyan", "[>]")} ${normalized.trim()}`);
        }
        // === TASK EXECUTION (always show) ===
        else if (/\[\d+\/\d+\]/.test(line) || line.includes("Executing:") ||
                 line.includes("Tool:")) {
          printLine(`  ${c("cyan", "[.]")} ${stripped}`);
        }
        // === INFO MESSAGES (always show) ===
        else if (line.includes("[INFO]") || line.includes("Preparing") ||
                 line.includes("Collecting") || line.includes("Created") ||
                 line.includes("Injected") || line.includes("Learning")) {
          printLine(`  ${c("dim", "...")} ${stripped}`);
        }
        // === PROGRESS & METRICS (always show) ===
        else if (line.includes("[#]") || /Tokens?:/i.test(line) ||
                 /\d+\.\d+s/.test(line)) {
          printLine(`  ${c("dim", "[#]")} ${stripped}`);
        }
        // === STDERR (show with marker) ===
        else if (isStderr && normalized.trim()) {
          printLine(`  ${c("yellow", "[stderr]")} ${stripped}`);
        }
      }
    };

    // Helper to show recent context on fatal error
    const showErrorContext = () => {
      if (recentLines.length > 0) {
        printLine();
        printLine(`  ${c("dim", "--- Recent output (last " + recentLines.length + " lines) ---")}`);
        recentLines.forEach(line => {
          printLine(`  ${c("dim", "  |")} ${line}`);
        });
      }
    };

    proc.stdout.on("data", (data) => processOutput(data, false));
    proc.stderr.on("data", (data) => processOutput(data, true));

    proc.on("close", (code) => {
      // Clean up scroll key listener
      stdin.removeListener("data", onScrollKey);
      stdin.setRawMode(false);
      disableScrollMode();

      printLine();
      if (code === 0) {
        printLine(`${c("green", "[+]")} Vigilant mode completed successfully.`);
        printLine(`${c("green", "[+]")} Output saved to: ${c("cyan", COMPLETED_WORK_DIR)}`);
      } else {
        printLine(`${c("red", "[x]")} Vigilant mode exited with code ${code}`);
        showErrorContext();
        printLine();
        printLine(`${c("dim", "All retry attempts exhausted. Check the error context above.")}`);
      }

      printLine();
      printLine(c("dim", "Press any key to continue..."));

      // Wait for keypress before returning
      stdin.setRawMode(true);
      stdin.once("data", () => {
        stdin.setRawMode(false);
        resolvePromise(code === 0);
      });
    });

    proc.on("error", (err) => {
      // Clean up scroll key listener
      stdin.removeListener("data", onScrollKey);
      stdin.setRawMode(false);
      disableScrollMode();

      printLine(`${c("red", "[x]")} Failed to start vigilant mode: ${err.message}`);
      resolvePromise(false);
    });
  });
}

// Run goals-cli in advanced TUI mode
async function runAdvancedMode(goalsFilePath) {
  // Reset content area for fresh output
  clearContentArea();

  printLine();
  printLine(c("dim", "Launching goals-cli in TUI mode..."));
  printLine();

  return new Promise((resolve) => {
    const proc = spawn("bun", [GOALS_CLI_PATH, goalsFilePath], {
      stdio: "inherit",
      cwd: dirname(GOALS_CLI_PATH),
    });

    proc.on("close", (code) => {
      printLine();
      printLine(c("dim", `TUI exited with code ${code}`));
      resolve(code === 0);
    });

    proc.on("error", (err) => {
      printLine(c("red", `[x] Failed to launch goals-cli: ${err.message}`));
      resolve(false);
    });
  });
}

// Post-generation menu
async function postGenerationMenu(config, goals, filepath) {
  let continueLoop = true;

  while (continueLoop) {
    printLine();
    printLine(c("bold", "--- What would you like to do? ---"));
    printLine();

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
        printLine();
        printLine(`${c("green", "[+]")} Goals exported to: ${c("cyan", filepath)}`);
        printLine(c("dim", "Exiting."));
        continueLoop = false;
        break;
    }
  }

  return { action: "done" };
}

// Goals description step (extracted for reuse)
async function getGoalsDescription() {
  clearScreen();
  setHeaderSubtitle("Step 2: Describe Your Goals");

  // Calculate vertical center (raised by 6 rows for better visibility)
  const { rows } = getTerminalSize();
  const contentAreaHeight = rows - (BORDER_HEIGHT * 2); // Subtract header and footer
  const instructionLines = 8; // Number of instruction lines we'll print
  const centerStartRow = BORDER_HEIGHT + 1 + Math.floor((contentAreaHeight - instructionLines) / 2) - 6;

  // Position at vertical center
  currentContentRow = Math.max(BORDER_HEIGHT + 1, centerStartRow);
  moveTo(currentContentRow, 1);

  printCentered(c("cyan", "Instructions"));
  printCentered(c("dim", "─".repeat(40)));
  printLine();
  printCentered("Enter a description of what you want to accomplish.");
  printCentered("Be as detailed as possible - include objectives,");
  printCentered("priorities, success criteria, and any constraints.");
  printLine();
  printCentered(c("dim", "Type .done on a new line when finished."));
  printLine();

  const description = await promptMultiline(null, null, true);

  if (!description.trim()) {
    return null;
  }

  return description;
}

// Generate and validate goals step
async function generateAndValidateGoals(config, description) {
  clearScreen();
  setHeaderSubtitle("Step 3: Generating Goals");

  const spinner = createSpinner("Generating goals via LLM...");
  spinner.start();

  let goals;
  try {
    goals = await generateGoals(config, description);
    spinner.stop("Goals generated successfully");
  } catch (error) {
    spinner.fail("Failed to generate goals");
    printLine(c("red", `Error: ${error.message}`));
    return null;
  }

  // Validate
  printLine();
  const errors = validateGoals(goals);

  if (errors.length > 0) {
    printLine(c("yellow", "Validation warnings:"));
    for (const err of errors) {
      printLine(`  ${c("yellow", "[!]")} ${err}`);
    }
    printLine();
  }

  // Brief summary before review
  printLine(`${c("green", "[+]")} Generated ${c("bold", goals.goals.length)} goals`);
  if (goals.metadata?.name) {
    printLine(`${c("dim", "    Project:")} ${goals.metadata.name}`);
  }
  printLine();
  printLine(c("dim", "Press any key to review goals..."));

  // Wait for keypress
  await waitForKey();

  // Paged review
  clearScreen();
  setHeaderSubtitle("Step 4: Review Goals");

  const confirmed = await reviewGoals(goals);

  // Clear content area after review
  clearContentArea();
  setHeaderSubtitle("Step 5: Save & Execute");

  if (!confirmed) {
    printLine(c("yellow", "Review cancelled."));
    return null;
  }

  printLine(`${c("green", "[+]")} Goals reviewed and confirmed`);
  printLine();

  return goals;
}

/**
 * Wait for any keypress
 */
async function waitForKey() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onKey = (key) => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onKey);
      if (key === "\u0003") {
        process.exit(0);
      }
      resolve();
    };

    stdin.once("data", onKey);
  });
}

// Cleanup handler
function cleanup() {
  stopBorderAnimation();
  resetScrollRegion();
  showCursor();
}

// Main application
async function main() {
  // Setup cleanup on exit
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Clear and setup display with scroll region
  process.stdout.write("\x1b[2J\x1b[H");
  startBorderAnimation(); // Sets up scroll region and positions cursor

  // Step 1: Configure LLM (done once)
  setHeaderSubtitle("Step 1: Configure LLM Provider");

  const provider = await promptSelect("Select your LLM provider:", [
    { label: "Anthropic (Claude)", value: LLMProvider.ANTHROPIC },
    { label: "OpenAI (ChatGPT)", value: LLMProvider.OPENAI },
    { label: "Custom Provider", value: LLMProvider.CUSTOM },
  ]);

  printLine(); // blank line

  const defaultEndpoint = DEFAULT_ENDPOINTS[provider];
  const defaultModel = DEFAULT_MODELS[provider];

  const endpoint = await prompt("API Endpoint", defaultEndpoint);
  if (!endpoint) {
    printLine(c("red", "Endpoint is required. Exiting."));
    process.exit(1);
  }

  const model = await prompt("Model name (optional)", defaultModel);

  // Clean up rows near separator before API key prompt
  {
    const { rows } = getTerminalSize();
    for (let i = 5; i <= 7; i++) {
      moveTo(rows - i, 1);
      process.stdout.write("\x1b[2K");
    }
  }

  const apiKey = await promptPassword("API Key");
  if (!apiKey) {
    printLine(c("red", "API key is required. Exiting."));
    process.exit(1);
  }

  const config = {
    provider,
    endpoint,
    model: model || null,
    apiKey,
  };

  printLine();
  printLine(`${c("green", "[+]")} Provider: ${c("cyan", config.provider)}`);
  printLine(`${c("green", "[+]")} Endpoint: ${c("cyan", config.endpoint)}`);
  printLine(`${c("green", "[+]")} Model: ${c("cyan", config.model || "default")}`);
  printLine(`${c("green", "[+]")} API Key: ${c("cyan", "*".repeat(8) + "..." + config.apiKey.slice(-4))}`);
  printLine();

  const proceed = await promptConfirm("Continue with these settings?", true);
  if (!proceed) {
    printLine(c("yellow", "Cancelled."));
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
        printLine(c("yellow", "No description provided. Returning to menu."));
        continueGenerating = false;
        continue;
      } else {
        printLine(c("red", "No description provided. Exiting."));
        process.exit(1);
      }
    }

    // Step 3: Generate and validate goals
    const goals = await generateAndValidateGoals(config, description);

    if (!goals) {
      if (allGoals) {
        printLine(c("yellow", "Generation failed. Returning to menu."));
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
      printLine();
      printLine(`${c("green", "[+]")} Added ${goals.goals.length} new goal(s). Total: ${allGoals.goals.length} goals.`);
    } else {
      allGoals = goals;
    }

    // Step 5: Save
    printLine();
    const shouldSave = await promptConfirm("Save goals to file?", true);

    if (shouldSave) {
      const defaultFilename = savedFilepath ? savedFilepath.split("/").pop() : "goals.json";
      const filename = await prompt("Filename", defaultFilename);

      if (filename) {
        savedFilepath = await saveGoals(allGoals, filename);
        printLine();
        printLine(`${c("green", "[+]")} Saved to: ${c("cyan", savedFilepath)}`);

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
      printLine();
      printLine(c("dim", "Exiting without saving."));
      continueGenerating = false;
    }
  }
}

// Run
main().catch((err) => {
  cleanup();
  printLine(c("red", `Fatal error: ${err.message}`));
  process.exit(1);
});
