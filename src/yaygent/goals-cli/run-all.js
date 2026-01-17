#!/usr/bin/env node

/**
 * @fileoverview Run All CLI - Complete workflow execution for CI/CD integration
 * @module goals-cli/run-all
 *
 * Executes the complete goals workflow:
 * 1. Start server (or connect to existing)
 * 2. Create session from goals and context
 * 3. Prepare session (evaluate + generate tasks)
 * 4. Execute action plan
 * 5. Run output evaluation
 *
 * Exit codes:
 *   0 - Success
 *   1 - Execution failed
 *   2 - Invalid arguments
 *   3 - Server connection failed
 *   4 - Session creation failed
 *   5 - Preparation failed
 *   6 - Execution failed
 *   7 - Evaluation failed
 */

import { parseArgs } from 'util';
import { spawn } from 'child_process';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { readFile, readdir, stat, mkdir, unlink, copyFile } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Exit codes
const EXIT = {
  SUCCESS: 0,
  FAILED: 1,
  INVALID_ARGS: 2,
  SERVER_FAILED: 3,
  SESSION_FAILED: 4,
  PREPARE_FAILED: 5,
  EXECUTE_FAILED: 6,
  EVAL_FAILED: 7
};

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

/**
 * Logger with timestamps and levels
 */
class Logger {
  constructor(verbose = false, quiet = false) {
    this.verbose = verbose;
    this.quiet = quiet;
  }

  _timestamp() {
    return new Date().toISOString().slice(11, 19);
  }

  info(msg) {
    if (!this.quiet) {
      console.log(`${colors.dim}[${this._timestamp()}]${colors.reset} ${msg}`);
    }
  }

  success(msg) {
    if (!this.quiet) {
      console.log(`${colors.dim}[${this._timestamp()}]${colors.reset} ${colors.green}✓${colors.reset} ${msg}`);
    }
  }

  warn(msg) {
    console.log(`${colors.dim}[${this._timestamp()}]${colors.reset} ${colors.yellow}⚠${colors.reset} ${msg}`);
  }

  error(msg) {
    console.error(`${colors.dim}[${this._timestamp()}]${colors.reset} ${colors.red}✗${colors.reset} ${msg}`);
  }

  debug(msg) {
    if (this.verbose) {
      console.log(`${colors.dim}[${this._timestamp()}] [DEBUG]${colors.reset} ${msg}`);
    }
  }

  phase(num, total, name) {
    if (!this.quiet) {
      console.log(`\n${colors.cyan}▶ Phase ${num}/${total}: ${name}${colors.reset}`);
    }
  }

  banner(msg) {
    if (!this.quiet) {
      console.log(`\n${colors.bold}${colors.magenta}${'═'.repeat(50)}${colors.reset}`);
      console.log(`${colors.bold}${colors.magenta}  ${msg}${colors.reset}`);
      console.log(`${colors.bold}${colors.magenta}${'═'.repeat(50)}${colors.reset}\n`);
    }
  }
}

/**
 * HTTP client for session server
 */
class SessionClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = options.timeout || 300000; // 5 minute default for LLM operations
  }

  async request(method, path, body = null, requestTimeout = null) {
    const url = `${this.baseUrl}${path}`;
    const timeout = requestTimeout || this.timeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        if (data.error) {
          errorMessage = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        } else if (data.message) {
          errorMessage = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
        }
        const error = new Error(errorMessage);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms: ${method} ${path}`);
      }
      throw err;
    }
  }

  async healthCheck() {
    return this.request('GET', '/health');
  }

  async createSession(goals, context) {
    return this.request('POST', '/api/sessions', { goals, context });
  }

  async evaluate(sessionId, options = {}) {
    return this.request('POST', '/api/evaluate', { sessionId, options });
  }

  async generateTaskList(sessionId, options = {}) {
    return this.request('POST', '/api/tasklist/generate', { sessionId, options });
  }

  async getSandboxInfo(sessionId) {
    return this.request('GET', `/api/sandbox/${sessionId}`);
  }

  async cleanupSandbox(sessionId) {
    return this.request('DELETE', `/api/sandbox/${sessionId}`);
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, operationName, maxRetries, logger) {
  const baseDelay = 5000;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.message?.includes('429') ||
                         err.message?.includes('rate limit') ||
                         err.message?.includes('Rate limit') ||
                         err.status === 429;

      if (!isRateLimit || attempt > maxRetries) {
        throw err;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      const delaySeconds = Math.round(delay / 1000);

      logger.warn(`Rate limit hit for ${operationName}`);
      logger.info(`  → Retry ${attempt}/${maxRetries} in ${delaySeconds}s...`);

      await sleep(delay);

      logger.info(`  → Retrying ${operationName}...`);
    }
  }
}

/**
 * Load goals from file
 */
async function loadGoals(goalsPath, logger) {
  logger.debug(`Loading goals from: ${goalsPath}`);

  if (!existsSync(goalsPath)) {
    throw new Error(`Goals file not found: ${goalsPath}`);
  }

  const content = await readFile(goalsPath, 'utf-8');
  const goals = JSON.parse(content);

  logger.debug(`Loaded ${goals.items?.length || 0} goals`);
  return goals;
}

/**
 * Load context files from directory
 */
async function loadContext(contextPath, logger) {
  logger.debug(`Loading context from: ${contextPath}`);

  if (!existsSync(contextPath)) {
    logger.warn(`Context path not found: ${contextPath}`);
    return { files: [], metadata: { source: 'cli-run-all' } };
  }

  const stats = await stat(contextPath);
  const files = [];

  if (stats.isDirectory()) {
    const entries = await readdir(contextPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const filePath = resolve(contextPath, entry.name);
        const content = await readFile(filePath, 'utf-8');
        files.push({
          path: entry.name,
          content,
          type: 'text',
          size: Buffer.byteLength(content, 'utf-8')
        });
      }
    }
  } else {
    const content = await readFile(contextPath, 'utf-8');
    files.push({
      path: basename(contextPath),
      content,
      type: 'text',
      size: Buffer.byteLength(content, 'utf-8')
    });
  }

  logger.debug(`Loaded ${files.length} context files`);

  return {
    files,
    metadata: {
      source: 'cli-run-all',
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0)
    }
  };
}

/**
 * Load memory files from directory (previous attempt logs)
 * Only loads files with "previous_attempt_" prefix
 */
async function loadMemory(memoryDir, logger) {
  logger.debug(`[memory] Loading from: ${memoryDir}`);

  if (!existsSync(memoryDir)) {
    logger.debug(`[memory] Directory not found, creating: ${memoryDir}`);
    await mkdir(memoryDir, { recursive: true });
    return [];
  }

  const files = [];
  const entries = await readdir(memoryDir, { withFileTypes: true });

  for (const entry of entries) {
    // Only load files with previous_attempt_ prefix
    if (entry.isFile() && entry.name.startsWith('previous_attempt_')) {
      const filePath = resolve(memoryDir, entry.name);
      try {
        const content = await readFile(filePath, 'utf-8');
        files.push({
          path: `memory/${entry.name}`,
          content,
          type: 'memory',
          size: Buffer.byteLength(content, 'utf-8')
        });
        logger.debug(`[memory] Loaded: ${entry.name} (${files[files.length - 1].size} bytes)`);
      } catch (err) {
        logger.warn(`[memory] Failed to read ${entry.name}: ${err.message}`);
      }
    }
  }

  logger.info(`[memory] Loaded ${files.length} previous attempt files`);
  return files;
}

/**
 * Copy session logs to memory directory with previous_attempt_ prefix
 */
async function copyLogsToMemory(sessionId, outputDir, memoryDir, logger) {
  const sessionOutputDir = resolve(outputDir, sessionId);

  if (!existsSync(sessionOutputDir)) {
    logger.debug(`[memory] No session output to copy: ${sessionOutputDir}`);
    return;
  }

  // Ensure memory directory exists
  await mkdir(memoryDir, { recursive: true });

  // Clear existing previous_attempt_ files first
  const existingEntries = await readdir(memoryDir, { withFileTypes: true });
  for (const entry of existingEntries) {
    if (entry.isFile() && entry.name.startsWith('previous_attempt_')) {
      const oldPath = resolve(memoryDir, entry.name);
      await unlink(oldPath);
      logger.debug(`[memory] Removed old: ${entry.name}`);
    }
  }

  // Copy new session logs with prefix
  const sessionEntries = await readdir(sessionOutputDir, { withFileTypes: true });
  let copiedCount = 0;

  for (const entry of sessionEntries) {
    if (entry.isFile() && (entry.name.endsWith('.txt') || entry.name.endsWith('.log') || entry.name.endsWith('.json'))) {
      const srcPath = resolve(sessionOutputDir, entry.name);
      const destName = `previous_attempt_${entry.name}`;
      const destPath = resolve(memoryDir, destName);

      try {
        await copyFile(srcPath, destPath);
        copiedCount++;
        logger.debug(`[memory] Copied: ${entry.name} → ${destName}`);
      } catch (err) {
        logger.warn(`[memory] Failed to copy ${entry.name}: ${err.message}`);
      }
    }
  }

  logger.info(`[memory] Saved ${copiedCount} logs to memory for next attempt`);
}

/**
 * Start the session server
 */
async function startServer(port, logger, env) {
  const serverPath = resolve(__dirname, '../goals-session-server/server.js');
  const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';

  logger.info(`Starting server on port ${port}...`);

  const serverEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '0.0.0.0',
    ...env
  };

  const serverProcess = spawn(runtime, [serverPath], {
    env: serverEnv,
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  // Capture output for debugging
  serverProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => logger.debug(`[server] ${line}`));
  });

  serverProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => logger.debug(`[server:err] ${line}`));
  });

  return serverProcess;
}

/**
 * Wait for server to be ready
 */
async function waitForServer(client, timeoutMs, logger) {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      await client.healthCheck();
      return true;
    } catch (e) {
      await sleep(pollInterval);
    }
  }

  return false;
}

/**
 * Run action-plan CLI
 */
async function runActionPlan(sessionId, options, logger) {
  const actionPlanPath = resolve(__dirname, '../action-plan/action-plan.js');
  const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';

  const args = ['--session', sessionId];

  if (options.dryRun) args.push('--dry-run');
  if (options.verbose) args.push('--verbose');
  if (options.output) args.push('--output', options.output);
  if (options.noBundle) args.push('--no-bundle');
  if (options.noEval) args.push('--no-eval');

  const env = {
    ...process.env,
    ...options.env
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(runtime, [actionPlanPath, ...args], {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      text.split('\n').filter(l => l.trim()).forEach(line => {
        if (line.includes('Error') || line.includes('FATAL')) {
          logger.error(line);
        } else if (line.includes('✓') || line.includes('SUCCESS')) {
          logger.success(line);
        } else if (options.verbose || line.includes('[') || line.includes('Task')) {
          logger.info(line);
        }
      });
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      text.split('\n').filter(l => l.trim()).forEach(line => {
        logger.error(line);
      });
    });

    proc.on('close', (code) => {
      resolve({ success: code === 0, exitCode: code, output });
    });

    proc.on('error', reject);
  });
}

/**
 * Run output-eval CLI
 */
async function runOutputEval(bundlePath, options, logger) {
  const evalPath = resolve(__dirname, '../output-eval/output-eval.js');
  const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';

  const args = ['--bundle', bundlePath];

  if (options.format) args.push('--format', options.format);
  if (options.verbose) args.push('--verbose');
  if (options.output) args.push('--output', options.output);

  const env = {
    ...process.env,
    ...options.env
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(runtime, [evalPath, ...args], {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let scores = null;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;

      // Extract scores
      const overallMatch = text.match(/Overall:\s*(\d+)\/100\s*\(([A-F])\s*-/);
      if (overallMatch) {
        scores = { overall: parseInt(overallMatch[1], 10), grade: overallMatch[2] };
      }

      text.split('\n').filter(l => l.trim()).forEach(line => {
        if (options.verbose) {
          logger.info(line);
        }
      });
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ success: code === 0, exitCode: code, output, scores });
    });

    proc.on('error', reject);
  });
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
${colors.bold}run-all${colors.reset} - Complete workflow execution for CI/CD

${colors.bold}USAGE:${colors.reset}
  run-all --goals <file> [options]

${colors.bold}REQUIRED:${colors.reset}
  --goals, -g <file>      Path to goals JSON file

${colors.bold}OPTIONS:${colors.reset}
  --context, -c <path>    Path to context directory or file
  --output, -o <dir>      Output directory (default: ./output)
  --server-url, -s <url>  Session server URL (default: start local server)
  --port, -p <port>       Server port if starting locally (default: 3000)
  --max-retries <n>       Max retries on rate limit (default: 3)
  --memory, -m            Enable memory mode - use previous attempt logs as context
  --memory-dir <dir>      Memory directory (default: ./memory)
  --dry-run, -d           Dry run mode - no actual execution
  --no-eval               Skip output evaluation
  --no-server             Don't start server (requires --server-url)
  --clean-sandbox         Clean sandbox before execution
  --verbose, -v           Verbose output
  --quiet, -q             Quiet mode - only errors and final result
  --json                  Output final result as JSON
  --help, -h              Show this help message
  --version, -V           Show version

${colors.bold}ENVIRONMENT VARIABLES:${colors.reset}
  PRIMARY_LLM_API_KEY     API key for primary LLM (default tier)
  PRIMARY_LLM_PROVIDER    Provider: anthropic, openai, custom
  PRIMARY_LLM_MODEL       Model to use
  PRIMARY_LLM_ENDPOINT    Custom API endpoint

  SECONDARY_LLM_*         Secondary tier (same pattern as PRIMARY)
  TERTIARY_LLM_*          Tertiary tier
  QUATERNARY_LLM_*        Quaternary tier
  QUINARY_LLM_*           Quinary tier

  MAX_RETRIES             Override max retries

  Legacy (fallback):
  LLM_API_KEY             Falls back to PRIMARY_LLM_API_KEY
  ANTHROPIC_API_KEY       Used if PRIMARY not set
  OPENAI_API_KEY          Used if PRIMARY not set

${colors.bold}EXIT CODES:${colors.reset}
  0  Success
  1  General failure
  2  Invalid arguments
  3  Server connection failed
  4  Session creation failed
  5  Preparation failed
  6  Execution failed
  7  Evaluation failed

${colors.bold}EXAMPLES:${colors.reset}
  # Basic usage
  run-all --goals goals.json --context ./context

  # CI/CD with JSON output
  run-all -g goals.json -c ./context --json --quiet

  # Use existing server
  run-all -g goals.json -s http://server:3000 --no-server

  # Dry run with verbose output
  run-all -g goals.json --dry-run --verbose
`);
}

/**
 * Parse command line arguments
 */
function parseCliArgs() {
  const options = {
    goals: { type: 'string', short: 'g' },
    context: { type: 'string', short: 'c' },
    output: { type: 'string', short: 'o', default: './output' },
    'server-url': { type: 'string', short: 's' },
    port: { type: 'string', short: 'p', default: '3000' },
    'max-retries': { type: 'string', default: '3' },
    memory: { type: 'boolean', short: 'm', default: false },
    'memory-dir': { type: 'string', default: './memory' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    'no-eval': { type: 'boolean', default: false },
    'no-server': { type: 'boolean', default: false },
    'clean-sandbox': { type: 'boolean', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    quiet: { type: 'boolean', short: 'q', default: false },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'V', default: false }
  };

  try {
    const { values } = parseArgs({ options, allowPositionals: false });
    return values;
  } catch (err) {
    console.error(`${colors.red}Error:${colors.reset} ${err.message}`);
    console.error('Use --help for usage information');
    process.exit(EXIT.INVALID_ARGS);
  }
}

/**
 * Main execution
 */
async function main() {
  const args = parseCliArgs();

  if (args.help) {
    printHelp();
    process.exit(EXIT.SUCCESS);
  }

  if (args.version) {
    console.log('run-all v1.0.0');
    process.exit(EXIT.SUCCESS);
  }

  // Validate required args
  if (!args.goals) {
    console.error(`${colors.red}Error:${colors.reset} --goals is required`);
    console.error('Use --help for usage information');
    process.exit(EXIT.INVALID_ARGS);
  }

  // Check for API key (PRIMARY tier or legacy)
  const primaryApiKey = process.env.PRIMARY_LLM_API_KEY ||
                        process.env.LLM_API_KEY ||
                        process.env.ANTHROPIC_API_KEY ||
                        process.env.OPENAI_API_KEY;

  if (!primaryApiKey) {
    console.error(`${colors.red}Error:${colors.reset} No API key found`);
    console.error('Set PRIMARY_LLM_API_KEY, LLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY');
    process.exit(EXIT.INVALID_ARGS);
  }

  const logger = new Logger(args.verbose, args.quiet);
  const maxRetries = parseInt(args['max-retries'], 10) || 3;
  const port = parseInt(args.port, 10) || 3000;
  const serverUrl = args['server-url'] || `http://localhost:${port}`;

  // LLM tiers
  const llmTiers = ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY', 'QUINARY'];

  let serverProcess = null;
  let sessionId = null;

  const result = {
    success: false,
    sessionId: null,
    phases: {},
    scores: null,
    duration: 0,
    error: null,
    llmTiers: []
  };

  const startTime = Date.now();

  try {
    logger.banner('☆ RUN ALL - Starting Workflow ☆');

    const client = new SessionClient(serverUrl);

    // Build environment with all LLM tier configurations
    const env = {
      SESSION_SERVER_URL: serverUrl,
      MAX_RETRIES: String(maxRetries),
      LLM_TIMEOUT: process.env.LLM_TIMEOUT || '300000', // 5 minute timeout for LLM operations
      LLM_MAX_RETRIES: process.env.LLM_MAX_RETRIES || '5',
      LLM_BACKOFF_MS: process.env.LLM_BACKOFF_MS || '10000',
      LLM_REQUEST_DELAY_MS: process.env.LLM_REQUEST_DELAY_MS || '3000', // 3s between requests for rate limiting
      ANTHROPIC_VERSION: process.env.ANTHROPIC_VERSION || '2023-06-01',
      // Continue executing even if task evaluation fails (lenient mode)
      CONTINUE_ON_EVAL_FAILURE: process.env.CONTINUE_ON_EVAL_FAILURE || 'false',
      // Primary LLM (with legacy fallbacks)
      PRIMARY_LLM_PROVIDER: process.env.PRIMARY_LLM_PROVIDER || process.env.LLM_PROVIDER || 'anthropic',
      PRIMARY_LLM_API_KEY: primaryApiKey,
      PRIMARY_LLM_ENDPOINT: process.env.PRIMARY_LLM_ENDPOINT || process.env.LLM_ENDPOINT || '',
      PRIMARY_LLM_MODEL: process.env.PRIMARY_LLM_MODEL || process.env.LLM_MODEL || '',
      // Legacy vars for backwards compatibility
      LLM_PROVIDER: process.env.PRIMARY_LLM_PROVIDER || process.env.LLM_PROVIDER || 'anthropic',
      LLM_API_KEY: primaryApiKey,
      LLM_ENDPOINT: process.env.PRIMARY_LLM_ENDPOINT || process.env.LLM_ENDPOINT || '',
      LLM_MODEL: process.env.PRIMARY_LLM_MODEL || process.env.LLM_MODEL || '',
      // Secondary LLM
      SECONDARY_LLM_PROVIDER: process.env.SECONDARY_LLM_PROVIDER || '',
      SECONDARY_LLM_API_KEY: process.env.SECONDARY_LLM_API_KEY || '',
      SECONDARY_LLM_ENDPOINT: process.env.SECONDARY_LLM_ENDPOINT || '',
      SECONDARY_LLM_MODEL: process.env.SECONDARY_LLM_MODEL || '',
      // Tertiary LLM
      TERTIARY_LLM_PROVIDER: process.env.TERTIARY_LLM_PROVIDER || '',
      TERTIARY_LLM_API_KEY: process.env.TERTIARY_LLM_API_KEY || '',
      TERTIARY_LLM_ENDPOINT: process.env.TERTIARY_LLM_ENDPOINT || '',
      TERTIARY_LLM_MODEL: process.env.TERTIARY_LLM_MODEL || '',
      // Quaternary LLM
      QUATERNARY_LLM_PROVIDER: process.env.QUATERNARY_LLM_PROVIDER || '',
      QUATERNARY_LLM_API_KEY: process.env.QUATERNARY_LLM_API_KEY || '',
      QUATERNARY_LLM_ENDPOINT: process.env.QUATERNARY_LLM_ENDPOINT || '',
      QUATERNARY_LLM_MODEL: process.env.QUATERNARY_LLM_MODEL || '',
      // Quinary LLM
      QUINARY_LLM_PROVIDER: process.env.QUINARY_LLM_PROVIDER || '',
      QUINARY_LLM_API_KEY: process.env.QUINARY_LLM_API_KEY || '',
      QUINARY_LLM_ENDPOINT: process.env.QUINARY_LLM_ENDPOINT || '',
      QUINARY_LLM_MODEL: process.env.QUINARY_LLM_MODEL || ''
    };

    // Log configured tiers
    const configuredTiers = llmTiers.filter(tier => !!env[`${tier}_LLM_API_KEY`]);
    result.llmTiers = configuredTiers;
    logger.info(`LLM Tiers configured: ${configuredTiers.length}`);
    for (const tier of configuredTiers) {
      const provider = env[`${tier}_LLM_PROVIDER`];
      logger.debug(`  ${tier}: ${provider}`);
    }

    // Phase 1: Server
    logger.phase(1, 5, 'Server');
    result.phases.server = { started: false };

    if (!args['no-server']) {
      // Check if server is already running
      try {
        await client.healthCheck();
        logger.success('Server already running');
        result.phases.server.started = false;
        result.phases.server.existing = true;
      } catch (e) {
        // Start server
        serverProcess = await startServer(port, logger, env);

        const serverReady = await waitForServer(client, 30000, logger);
        if (!serverReady) {
          throw new Error('Server failed to start within 30 seconds');
        }

        logger.success('Server started');
        result.phases.server.started = true;
      }
    } else {
      // Verify external server
      try {
        await client.healthCheck();
        logger.success(`Connected to ${serverUrl}`);
        result.phases.server.external = true;
      } catch (e) {
        throw new Error(`Cannot connect to server at ${serverUrl}`);
      }
    }
    result.phases.server.success = true;

    // Phase 2: Create Session
    logger.phase(2, 5, 'Create Session');
    result.phases.session = { success: false };

    const goalsPath = resolve(process.cwd(), args.goals);
    const goals = await loadGoals(goalsPath, logger);
    logger.debug(`Goals: ${goals.items?.length || 0} items`);

    let context = { files: [], metadata: { source: 'cli-run-all' } };
    if (args.context) {
      const contextPath = resolve(process.cwd(), args.context);
      context = await loadContext(contextPath, logger);
      logger.info(`Context: ${context.files.length} files`);
    }

    // Memory mode: load previous attempt logs and merge with context
    const memoryDir = resolve(process.cwd(), args['memory-dir'] || './memory');
    if (args.memory) {
      logger.info('[memory] Memory mode enabled');
      const memoryFiles = await loadMemory(memoryDir, logger);
      if (memoryFiles.length > 0) {
        context.files = [...context.files, ...memoryFiles];
        context.metadata.memoryEnabled = true;
        context.metadata.memoryFiles = memoryFiles.length;
        logger.debug(`[memory] Merged ${memoryFiles.length} memory files with context`);
      } else {
        logger.info('[memory] No previous attempt files found (first run)');
      }
    }

    const createResponse = await withRetry(
      () => client.createSession(goals, context),
      'create session',
      maxRetries,
      logger
    );

    sessionId = createResponse.data?.sessionId || createResponse.sessionId;
    if (!sessionId) {
      throw new Error('No session ID returned');
    }

    result.sessionId = sessionId;
    result.phases.session.sessionId = sessionId;
    result.phases.session.success = true;
    logger.success(`Session created: ${sessionId.slice(0, 8)}...`);

    // Phase 3: Prepare Session
    logger.phase(3, 5, 'Prepare Session');
    result.phases.prepare = { success: false };

    logger.info('Evaluating dependencies...');
    logger.debug(`[eval] Requesting evaluation for session ${sessionId.slice(0, 8)}...`);
    const evalStartTime = Date.now();
    const evalResponse = await withRetry(
      () => client.evaluate(sessionId),
      'evaluate session',
      maxRetries,
      logger
    );
    const evalDuration = ((Date.now() - evalStartTime) / 1000).toFixed(1);
    const evalData = evalResponse.data || evalResponse;
    logger.debug(`[eval] State: ${evalData.state} (${evalDuration}s)`);
    if (evalData.executionOrder) {
      logger.debug(`[eval] Execution order: ${evalData.executionOrder.join(' → ')}`);
    }
    if (evalData.inferredDependencies?.length > 0) {
      logger.debug(`[eval] Inferred ${evalData.inferredDependencies.length} dependencies`);
      evalData.inferredDependencies.forEach(dep => {
        logger.debug(`[eval]   ${dep.goalId} → ${dep.dependsOn} (${dep.type})`);
      });
    }
    if (evalData.warnings?.length > 0) {
      evalData.warnings.forEach(w => logger.warn(`[eval] ${w.code}: ${w.message}`));
    }

    logger.info('Generating task list...');
    logger.debug(`[taskgen] Starting task generation for ${evalData.executionOrder?.length || '?'} goals`);
    const taskStartTime = Date.now();
    const taskResponse = await withRetry(
      () => client.generateTaskList(sessionId),
      'generate tasks',
      maxRetries,
      logger
    );
    const taskDuration = ((Date.now() - taskStartTime) / 1000).toFixed(1);
    const taskData = taskResponse.data || taskResponse;
    const taskList = taskData.taskList || {};
    const tasks = taskList.tasks || [];

    const taskCount = tasks.length;
    result.phases.prepare.taskCount = taskCount;
    result.phases.prepare.success = true;
    logger.debug(`[taskgen] Generated ${taskCount} tasks in ${taskDuration}s`);

    // Log task summary by goal
    const tasksByGoal = {};
    tasks.forEach(t => {
      const goalId = t.goalId || 'unknown';
      if (!tasksByGoal[goalId]) tasksByGoal[goalId] = [];
      tasksByGoal[goalId].push(t);
    });
    Object.entries(tasksByGoal).forEach(([goalId, goalTasks]) => {
      logger.debug(`[taskgen] Goal "${goalId}": ${goalTasks.length} tasks`);
      goalTasks.forEach(t => {
        const tool = t.tool?.toolName || t.toolName || 'unknown';
        logger.debug(`[taskgen]   ${t.id}: ${t.title} [${tool}]`);
      });
    });

    logger.success(`Prepared ${taskCount} tasks`);

    // Phase 4: Execute
    logger.phase(4, 5, 'Execute Action Plan');
    result.phases.execute = { success: false };

    if (args['clean-sandbox']) {
      try {
        const info = await client.getSandboxInfo(sessionId);
        if (info.data?.exists || info.exists) {
          await client.cleanupSandbox(sessionId);
          logger.info('Sandbox cleaned');
        }
      } catch (e) {
        logger.debug(`Sandbox cleanup: ${e.message}`);
      }
    }

    const execResult = await withRetry(
      () => runActionPlan(sessionId, {
        dryRun: args['dry-run'],
        verbose: args.verbose,
        output: args.output,
        noBundle: args['no-eval'],
        noEval: true, // We run eval separately
        env
      }, logger),
      'execute action plan',
      maxRetries,
      logger
    );

    result.phases.execute.exitCode = execResult.exitCode;
    result.phases.execute.success = execResult.success;

    if (execResult.success) {
      logger.success('All tasks completed');
    } else {
      logger.warn(`Execution completed with exit code: ${execResult.exitCode}`);
    }

    // Phase 5: Evaluation
    if (!args['no-eval']) {
      logger.phase(5, 5, 'Output Evaluation');
      result.phases.eval = { success: false };

      const bundlePath = resolve(process.cwd(), args.output, sessionId);

      if (existsSync(bundlePath)) {
        const evalResult = await withRetry(
          () => runOutputEval(bundlePath, {
            format: 'all',
            verbose: args.verbose,
            output: resolve(process.cwd(), 'evaluation-output'),
            env
          }, logger),
          'run evaluation',
          maxRetries,
          logger
        );

        result.phases.eval.exitCode = evalResult.exitCode;
        result.phases.eval.success = evalResult.success;

        if (evalResult.scores) {
          result.scores = evalResult.scores;
          logger.success(`Evaluation: ${evalResult.scores.overall}/100 (${evalResult.scores.grade})`);
        } else {
          logger.success('Evaluation complete');
        }
      } else {
        logger.warn(`Bundle not found at ${bundlePath}, skipping evaluation`);
        result.phases.eval.skipped = true;
      }
    } else {
      logger.phase(5, 5, 'Evaluation (skipped)');
      result.phases.eval = { skipped: true };
    }

    // Success!
    result.success = true;
    result.duration = Date.now() - startTime;

    logger.banner('☆ RUN ALL COMPLETE ☆');
    logger.info(`Duration: ${(result.duration / 1000).toFixed(1)}s`);

    if (result.scores) {
      logger.info(`Score: ${result.scores.overall}/100 (${result.scores.grade})`);
    }

  } catch (err) {
    result.success = false;
    result.error = err.message;
    result.duration = Date.now() - startTime;

    logger.error(`Failed: ${err.message}`);

    // Determine exit code based on phase
    let exitCode = EXIT.FAILED;
    if (!result.phases.server?.success) exitCode = EXIT.SERVER_FAILED;
    else if (!result.phases.session?.success) exitCode = EXIT.SESSION_FAILED;
    else if (!result.phases.prepare?.success) exitCode = EXIT.PREPARE_FAILED;
    else if (!result.phases.execute?.success) exitCode = EXIT.EXECUTE_FAILED;
    else if (!result.phases.eval?.success && !result.phases.eval?.skipped) exitCode = EXIT.EVAL_FAILED;

    result.exitCode = exitCode;

  } finally {
    // Copy logs to memory if memory mode is enabled
    if (args.memory && sessionId) {
      try {
        const outputDir = resolve(process.cwd(), args.output);
        await copyLogsToMemory(sessionId, outputDir, memoryDir, logger);
      } catch (err) {
        logger.warn(`[memory] Failed to save logs: ${err.message}`);
      }
    }

    // Cleanup
    if (serverProcess) {
      logger.debug('Stopping server...');
      serverProcess.kill('SIGTERM');
    }
  }

  // Output JSON result if requested
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  }

  process.exit(result.success ? EXIT.SUCCESS : (result.exitCode || EXIT.FAILED));
}

// Run
main().catch(err => {
  console.error(`${colors.red}Fatal error:${colors.reset} ${err.message}`);
  process.exit(EXIT.FAILED);
});
