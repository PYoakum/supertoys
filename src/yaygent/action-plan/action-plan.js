#!/usr/bin/env node

/**
 * @fileoverview Action Plan Service - Main CLI entry point
 * @module action-plan
 */

import { parseArgs } from 'util';
import config from './action-plan-config.js';
import { SessionClient } from './lib/session-client.js';
import { QueueManager } from './lib/queue-manager.js';
import { LLMClient } from './lib/llm-client.js';
import { OutputWriter } from './lib/output-writer.js';
import { BundleGenerator } from './lib/bundle-generator.js';
import { ProgressDisplay } from './lib/progress-display.js';
import { 
  buildActionPrompt, 
  buildEvaluationPrompt, 
  parseToolUse, 
  parseJsonResponse,
  validateEvaluationResponse 
} from './prompts/templates.js';
import {
  TaskExecutionError,
  TaskEvaluationError,
  SessionInvalidStateError,
  ConfigurationError
} from './lib/errors.js';
import { OutputEvalRunner } from './lib/output-eval-runner.js';

/**
 * Check if a string looks like a task ID (task-N, UUID, or alphanumeric ID)
 * @param {string} str
 * @returns {boolean}
 */
function looksLikeTaskId(str) {
  if (typeof str !== 'string') return false;
  // Matches: task-1, task-123, UUIDs, or alphanumeric IDs
  return /^task-\d+$/i.test(str) ||
         /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str) ||
         /^[a-z0-9_-]{4,}$/i.test(str);
}

/**
 * Parse delay value into milliseconds
 * Supports:
 * - Seconds: "5s", "30s"
 * - Milliseconds: "500ms", "1000ms"
 * - Minutes: "2m"
 * @param {string} value - Delay value
 * @returns {number|null} - Delay in milliseconds or null if invalid
 */
function parseDelay(value) {
  if (!value || typeof value !== 'string') return null;

  // Milliseconds format: "500ms", "1000ms"
  const msMatch = value.match(/^(\d+)ms$/i);
  if (msMatch) {
    return parseInt(msMatch[1], 10);
  }

  // Seconds format: "5s", "30s"
  const secMatch = value.match(/^(\d+)s$/i);
  if (secMatch) {
    return parseInt(secMatch[1], 10) * 1000;
  }

  // Minutes format: "2m"
  const minMatch = value.match(/^(\d+)m$/i);
  if (minMatch) {
    return parseInt(minMatch[1], 10) * 60000;
  }

  return null;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse scheduledAt value into target execution time
 * Supports:
 * - Relative delays: "30s", "5m", "2h", "1d"
 * - Absolute ISO datetime: "2025-01-15T14:30:00"
 * @param {string} value - Schedule value
 * @param {number} [readyTime] - When task became ready (for relative delays)
 * @returns {{type: string, targetTime: number}|null}
 */
function parseScheduledAt(value, readyTime = Date.now()) {
  if (!value || typeof value !== 'string') return null;

  // Relative format: "30s", "5m", "2h", "1d"
  const relativeMatch = value.match(/^(\d+)(s|m|h|d)$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return {
      type: 'delay',
      targetTime: readyTime + (amount * multipliers[unit]),
      original: value
    };
  }

  // ISO datetime format
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return {
      type: 'datetime',
      targetTime: date.getTime(),
      original: value
    };
  }

  return null;
}

/**
 * Extract dependency ID from various formats
 * Dependencies can be: string, number, or object with various property names
 * @param {*} dep - Dependency in any format
 * @param {number} [depth=0] - Recursion depth for safety
 * @returns {string} - The dependency ID as a string
 */
function extractDepId(dep, depth = 0) {
  // Safety: prevent infinite recursion
  if (depth > 10) {
    console.error('[DEBUG] extractDepId max depth reached:', JSON.stringify(dep));
    return 'unknown';
  }

  // Handle primitives
  if (typeof dep === 'string') {
    // Don't return metadata values like "completion", "satisfied", etc.
    if (looksLikeTaskId(dep)) {
      return dep;
    }
    // If it doesn't look like an ID but we're at depth 0, it might still be the ID
    if (depth === 0) {
      return dep;
    }
    // At deeper levels, reject non-ID strings
    return 'unknown';
  }
  if (typeof dep === 'number') return String(dep);

  if (dep && typeof dep === 'object') {
    // Handle arrays - take first element
    if (Array.isArray(dep)) {
      if (dep.length > 0) {
        return extractDepId(dep[0], depth + 1);
      }
      return 'unknown';
    }

    // ID-specific properties (these should contain the actual ID)
    const idProps = ['taskId', 'id', 'dependsOn', 'target', 'dependency', 'task', 'ref'];
    for (const prop of idProps) {
      const val = dep[prop];
      if (val !== undefined && val !== null) {
        // If it's a string that looks like an ID, use it directly
        if (typeof val === 'string' && looksLikeTaskId(val)) {
          return val;
        }
        // If it's a number, convert to string
        if (typeof val === 'number') {
          return String(val);
        }
        // If it's an object, recurse but only if it's not just metadata
        if (typeof val === 'object' && !Array.isArray(val)) {
          // Skip if this object only has metadata keys (type, satisfied, etc.)
          const valKeys = Object.keys(val);
          const metadataKeys = ['type', 'satisfied', 'status', 'state', 'optional'];
          const hasIdLikeKey = valKeys.some(k => /id|task|ref|depends/i.test(k));
          if (hasIdLikeKey || !valKeys.every(k => metadataKeys.includes(k))) {
            const result = extractDepId(val, depth + 1);
            if (result !== 'unknown') {
              return result;
            }
          }
        }
      }
    }

    // If object has keys, try to find one that looks like it contains an ID
    const keys = Object.keys(dep);
    if (keys.length > 0) {
      // Skip metadata-only keys
      const metadataKeys = ['type', 'satisfied', 'status', 'state', 'optional'];
      const meaningfulKeys = keys.filter(k => !metadataKeys.includes(k));

      // Look for a key that contains 'id' or 'task'
      const idKey = meaningfulKeys.find(k => /id|task|ref/i.test(k));
      if (idKey && dep[idKey]) {
        const result = extractDepId(dep[idKey], depth + 1);
        if (result !== 'unknown') {
          return result;
        }
      }

      // Take first meaningful value if it looks like an ID
      for (const key of meaningfulKeys) {
        const val = dep[key];
        if (typeof val === 'string' && looksLikeTaskId(val)) {
          return val;
        }
      }
    }

    // Debug: log unhandled object structure
    console.error('[DEBUG] extractDepId unhandled object:', JSON.stringify(dep).slice(0, 300));
  }

  return 'unknown';
}

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArguments() {
  const options = {
    session: { type: 'string', short: 's' },
    next: { type: 'boolean', short: 'n', default: false },
    list: { type: 'boolean', short: 'l', default: false },
    config: { type: 'string', short: 'c' },
    output: { type: 'string', short: 'o' },
    clean: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    'no-bundle': { type: 'boolean', default: false },
    'no-eval': { type: 'boolean', default: false },
    'eval-background': { type: 'boolean', default: false },
    resume: { type: 'boolean', short: 'r', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'V', default: false }
  };

  try {
    const { values } = parseArgs({ options, allowPositionals: false });
    return values;
  } catch (err) {
    console.error(`Error parsing arguments: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
Action Plan Service v1.0.0

Usage: action-plan --session <sessionId> [options]
       action-plan --next [options]
       action-plan --list

Options:
  -s, --session <id>   Session ID to process
  -n, --next           Process the next ready session automatically
  -l, --list           List sessions ready for execution
  -c, --config <path>  Configuration file path
  -o, --output <path>  Output directory (default: ./output)
  --clean              Clean sandbox before execution (removes files from previous runs)
  -d, --dry-run        Validate without executing
  -v, --verbose        Enable verbose logging
  --no-bundle          Skip bundle generation
  --no-eval            Skip automatic output-eval invocation
  --eval-background    Run output-eval in background
  -r, --resume         Resume from last checkpoint
  -h, --help           Show this help
  -V, --version        Show version

Environment Variables:
  SESSION_SERVER_URL   Goals Session Server URL (default: http://localhost:3000)
  LLM_PROVIDER         LLM provider: anthropic, openai, or custom (default: anthropic)
  LLM_API_KEY          LLM API key (also accepts ANTHROPIC_API_KEY, OPENAI_API_KEY)
  LLM_ENDPOINT         LLM API endpoint URL
  LLM_MODEL            LLM model name
  ANTHROPIC_VERSION    Anthropic API version (default: 2023-06-01)
  OUTPUT_DIR           Default output directory

Examples:
  action-plan -s 550e8400-e29b-41d4-a716-446655440000
  action-plan -s 550e8400... -o ./my-output -v
  action-plan -s 550e8400... --dry-run
  action-plan --next              # Process next ready session
  action-plan --list              # List ready sessions
`);
}

/**
 * Show version
 */
function showVersion() {
  console.log('Action Plan Service v1.0.0');
}

/**
 * Execute a tool via the session server's tool registry
 * @param {SessionClient} sessionClient - Session client instance
 * @param {string} sessionId - Session ID for sandbox isolation
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} parameters - Tool parameters
 * @returns {Promise<Object>}
 */
async function executeToolViaServer(sessionClient, sessionId, toolName, parameters) {
  const result = await sessionClient.executeTool(toolName, parameters, sessionId);

  return {
    toolName,
    parameters,
    result: result.result,
    success: result.error ? false : true,
    error: result.error,
    durationMs: result.durationMs
  };
}

/**
 * Execute a single task
 * @param {Object} task
 * @param {Object} goal
 * @param {Object} context
 * @param {LLMClient} actionLlm
 * @param {Object} toolManifest
 * @param {Object[]} previousOutputs
 * @param {SessionClient} sessionClient - Session client for tool execution
 * @param {string} sessionId - Session ID for sandbox isolation
 * @returns {Promise<Object>}
 */
async function executeTask(task, goal, context, actionLlm, toolManifest, previousOutputs, sessionClient, sessionId) {
  // Build action prompt
  const { systemPrompt, userPrompt } = buildActionPrompt({
    task,
    goal,
    toolManifest,
    context: context?.formattedContent || '',
    previousOutputs
  });

  // Send to Action LLM
  const response = await actionLlm.send({ systemPrompt, userPrompt });

  // Parse tool use from response
  // Log raw response for debugging (first 500 chars)
  console.log(`      LLM Response: ${response.content.slice(0, 300).replace(/\n/g, '\\n')}...`);

  const toolUse = parseToolUse(response.content);

  const toolInvocations = [];

  if (toolUse) {
    // Get predefined parameters from task as fallback
    const predefinedParams = typeof task.tool === 'object'
      ? (task.tool?.command?.parameters || {})
      : {};

    // Merge: LLM params override predefined, but use predefined as fallback for missing keys
    // If LLM returned empty params, use predefined entirely
    const hasLlmParams = Object.keys(toolUse.parameters).length > 0;
    const mergedParams = hasLlmParams
      ? { ...predefinedParams, ...toolUse.parameters }
      : predefinedParams;

    // Always ensure sessionId is included for sandbox isolation
    const effectiveParams = { sessionId, ...mergedParams };

    // Log what we're about to execute
    console.log(`      Tool: ${toolUse.toolName}${hasLlmParams ? '' : ' (using predefined params)'}`);
    console.log(`      Params: ${JSON.stringify(effectiveParams).slice(0, 150)}...`);

    // Execute the tool via session server
    const toolResult = await executeToolViaServer(
      sessionClient,
      sessionId,
      toolUse.toolName,
      effectiveParams
    );
    toolInvocations.push(toolResult);

    // Log tool result for visibility
    if (toolResult.result?.content) {
      try {
        const resultContent = toolResult.result.content[0]?.text;
        if (resultContent) {
          const parsed = JSON.parse(resultContent);
          // Check for explicit failure - exitCode must exist and be non-zero
          const hasExitCodeError = typeof parsed.exitCode === 'number' && parsed.exitCode !== 0;
          if (parsed.success === false || hasExitCodeError) {
            console.log(`      ❌ Tool returned error (exit code: ${parsed.exitCode ?? 'N/A'})`);
            if (parsed.stderr) {
              console.log(`      stderr: ${parsed.stderr.slice(0, 300)}${parsed.stderr.length > 300 ? '...' : ''}`);
            }
          } else if (parsed.stdout) {
            console.log(`      stdout: ${parsed.stdout.slice(0, 200)}${parsed.stdout.length > 200 ? '...' : ''}`);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Log errors immediately
    if (!toolResult.success && toolResult.error) {
      const errMsg = typeof toolResult.error === 'object'
        ? toolResult.error.message : toolResult.error;
      const errCode = typeof toolResult.error === 'object' && toolResult.error.code
        ? ` [${toolResult.error.code}]` : '';
      console.log(`      ❌ Tool Error${errCode}: ${errMsg}`);
    }
  } else {
    // No tool use detected, use the task's predefined parameters
    // Handle both object and string formats for task.tool
    const toolName = typeof task.tool === 'object'
      ? (task.tool?.toolName || task.tool?.name || '')
      : (task.tool || '');
    const predefinedParams = typeof task.tool === 'object'
      ? (task.tool?.command?.parameters || {})
      : {};

    if (!toolName) {
      console.log(`      ⚠️  No tool specified for task, skipping execution`);
      return { skipped: true, reason: 'no tool specified' };
    }

    // Always ensure sessionId is included for sandbox isolation
    const params = { sessionId, ...predefinedParams };

    console.log(`      Tool: ${toolName} (predefined)`);
    console.log(`      Params: ${JSON.stringify(params).slice(0, 150)}...`);

    const toolResult = await executeToolViaServer(
      sessionClient,
      sessionId,
      toolName,
      params
    );
    toolInvocations.push(toolResult);

    // Log tool result for visibility (predefined path)
    if (toolResult.result?.content) {
      try {
        const resultContent = toolResult.result.content[0]?.text;
        if (resultContent) {
          const parsed = JSON.parse(resultContent);
          // Check for explicit failure - exitCode must exist and be non-zero
          const hasExitCodeError = typeof parsed.exitCode === 'number' && parsed.exitCode !== 0;
          if (parsed.success === false || hasExitCodeError) {
            console.log(`      ❌ Tool returned error (exit code: ${parsed.exitCode ?? 'N/A'})`);
            if (parsed.stderr) {
              console.log(`      stderr: ${parsed.stderr.slice(0, 300)}${parsed.stderr.length > 300 ? '...' : ''}`);
            }
          } else if (parsed.stdout) {
            console.log(`      stdout: ${parsed.stdout.slice(0, 200)}${parsed.stdout.length > 200 ? '...' : ''}`);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Log errors immediately
    if (!toolResult.success && toolResult.error) {
      const errMsg = typeof toolResult.error === 'object'
        ? toolResult.error.message : toolResult.error;
      const errCode = typeof toolResult.error === 'object' && toolResult.error.code
        ? ` [${toolResult.error.code}]` : '';
      console.log(`      ❌ Tool Error${errCode}: ${errMsg}`);
    }
  }

  return {
    taskId: task.id,
    success: toolInvocations.every(t => t.success),
    output: response.content,
    toolInvocations,
    reasoning: response.content.split('</tool_use>')[1]?.trim() || 'Task executed',
    tokenUsage: response.usage,
    metadata: {
      executedAt: new Date().toISOString(),
      modelUsed: response.model
    }
  };
}

/**
 * Evaluate task execution result
 * @param {Object} task
 * @param {Object} goal
 * @param {Object} executionResult
 * @param {LLMClient} evalLlm
 * @returns {Promise<Object>}
 */
async function evaluateTask(task, goal, executionResult, evalLlm) {
  // Build evaluation prompt
  const { systemPrompt, userPrompt } = buildEvaluationPrompt({
    task,
    goal,
    executionResult
  });

  // Send to Evaluation LLM
  const response = await evalLlm.send({ systemPrompt, userPrompt });

  // Parse JSON response
  const parsed = parseJsonResponse(response.content);

  // Validate response
  const validation = validateEvaluationResponse(parsed);
  if (!validation.valid) {
    throw new TaskEvaluationError(task.id, `Invalid evaluation response: ${validation.errors.join(', ')}`);
  }

  return {
    taskId: task.id,
    success: parsed.success,
    reason: parsed.reason,
    criteriaMatched: parsed.criteriaMatched || [],
    criteriaUnmatched: parsed.criteriaUnmatched || [],
    issues: parsed.issues || [],
    tokenUsage: response.usage,
    metadata: {
      evaluatedAt: new Date().toISOString(),
      modelUsed: response.model
    }
  };
}

/**
 * Main execution function
 * @param {Object} args - Parsed arguments
 */
async function main(args) {
  // Handle help and version
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  // Initialize clients early for --list and --next
  const sessionClient = new SessionClient(config.sessionServer);

  // Handle --list mode
  if (args.list) {
    console.log('Fetching sessions ready for execution...\n');

    const healthy = await sessionClient.healthCheck();
    if (!healthy) {
      console.error('Cannot connect to session server');
      process.exit(4);
    }

    const result = await sessionClient.listReadySessions({ limit: 20 });

    if (result.sessions.length === 0) {
      console.log('No sessions ready for execution.');
    } else {
      console.log('Sessions ready for execution:');
      console.log('─'.repeat(80));
      for (const session of result.sessions) {
        console.log(`  ${session.id}`);
        console.log(`    State: ${session.state}`);
        console.log(`    Goals: ${session.goalsCount}`);
        console.log(`    Tasks: ${session.tasksCount || 'N/A'}`);
        console.log(`    Created: ${session.createdAt}`);
        console.log('');
      }
      console.log(`Total: ${result.pagination.total} session(s) ready`);
    }
    process.exit(0);
  }

  // Handle --next mode: automatically pick the next ready session
  let sessionId = args.session;

  if (args.next) {
    console.log('Looking for next ready session...');

    const healthy = await sessionClient.healthCheck();
    if (!healthy) {
      console.error('Cannot connect to session server');
      process.exit(4);
    }

    const nextSession = await sessionClient.getNextReadySession();

    if (!nextSession) {
      console.log('No sessions ready for execution.');
      process.exit(0);
    }

    sessionId = nextSession.id;
    console.log(`Found ready session: ${sessionId}`);
  }

  // Validate required arguments
  if (!sessionId) {
    console.error('Error: --session or --next is required');
    showHelp();
    process.exit(2);
  }

  // Initialize display
  const display = new ProgressDisplay({ verbose: args.verbose });
  display.printHeader(sessionId);

  // Validate configuration
  if (!config.actionLlm.apiKey) {
    throw new ConfigurationError('LLM API key is required. Set LLM_API_KEY environment variable.', 'actionLlm.apiKey');
  }

  // Debug: show LLM config info
  if (args.verbose) {
    display.info(`Provider: ${config.actionLlm.provider}`);
    const key = config.actionLlm.apiKey;
    if (key) {
      const masked = key.length > 10 ? `${key.slice(0, 7)}...${key.slice(-4)}` : '***';
      display.info(`API Key: ${masked} (${key.length} chars)`);
    } else {
      display.info(`API Key: NOT SET`);
    }
    // Show which env var was used
    const sources = [];
    if (process.env.ACTION_LLM_API_KEY) sources.push('ACTION_LLM_API_KEY');
    if (process.env.LLM_API_KEY) sources.push('LLM_API_KEY');
    if (process.env.ANTHROPIC_API_KEY) sources.push('ANTHROPIC_API_KEY');
    if (process.env.OPENAI_API_KEY) sources.push('OPENAI_API_KEY');
    display.info(`Key sources available: ${sources.join(', ') || 'none'}`);
    display.info(`Model: ${config.actionLlm.model}`);
    display.info(`Endpoint: ${config.actionLlm.endpoint}`);
    if (config.actionLlm.provider === 'anthropic') {
      display.info(`Anthropic Version: ${config.actionLlm.anthropicVersion}`);
    }
  }

  // Initialize remaining clients (sessionClient already initialized above)
  const actionLlm = new LLMClient(config.actionLlm);
  const evalLlm = new LLMClient(config.evaluationLlm);

  const outputDir = args.output || config.output.baseDir;
  const outputWriter = new OutputWriter(outputDir, sessionId);
  const bundleGenerator = new BundleGenerator(outputDir);

  // Initialize OutputEvalRunner
  const outputEvalEnabled = !args['no-eval'] && config.outputEval?.enabled !== false;
  const outputEvalRunner = new OutputEvalRunner({
    ...config.outputEval,
    enabled: outputEvalEnabled,
    runInBackground: args['eval-background'] || config.outputEval?.runInBackground
  }, {
    info: (msg) => display.info(msg),
    error: (msg) => display.error(msg),
    debug: (msg, data) => args.verbose && console.log(`[DEBUG] ${msg}`, data || '')
  });

  // Check session server connectivity
  display.info('Connecting to session server...');
  const serverHealthy = await sessionClient.healthCheck();
  if (!serverHealthy) {
    display.error('Cannot connect to session server');
    process.exit(4);
  }

  // Get session
  display.info('Loading session...');
  const session = await sessionClient.getSession(sessionId, { includeContext: true });

  // Clean sandbox if requested
  if (args.clean) {
    display.info('Cleaning sandbox from previous runs...');
    try {
      const sandboxInfo = await sessionClient.getSandboxInfo(sessionId);
      if (sandboxInfo.exists) {
        await sessionClient.cleanupSandbox(sessionId);
        display.info(`Sandbox cleaned (was ${sandboxInfo.size} bytes)`);
      } else {
        display.info('Sandbox is already clean');
      }
    } catch (err) {
      display.error(`Failed to clean sandbox: ${err.message}`);
      // Continue anyway - this shouldn't be a fatal error
    }
  }

  // Validate session state
  if (session.state !== 'GENERATED') {
    throw new SessionInvalidStateError(sessionId, session.state, 'GENERATED');
  }

  if (!session.taskList || !session.taskList.tasks || session.taskList.tasks.length === 0) {
    display.error('Session has no tasks to execute');
    process.exit(4);
  }

  // Get tool manifest
  const toolManifest = await sessionClient.getToolManifest();

  // Initialize queue manager
  const queueManager = new QueueManager(sessionId, session.taskList.tasks);
  
  display.printQueueStatus(queueManager.getMetrics());

  // Dry run check
  if (args['dry-run']) {
    display.info('Dry run mode - validation complete');
    display.info(`Tasks to execute: ${queueManager.getState().pendingTasks.length}`);
    process.exit(0);
  }

  // Initialize output directory
  await outputWriter.initialize();

  // Build goal map for quick lookup
  const goalMap = new Map();
  for (const item of session.goals.items) {
    goalMap.set(item.id, item);
  }

  // Execution log entries
  const logEntries = [];
  const previousOutputs = [];

  // Track when tasks become ready (dependencies met) for relative scheduling
  const taskReadyTimes = new Map();

  // Setup graceful shutdown
  let aborted = false;
  process.on('SIGINT', () => {
    display.info('Received SIGINT, aborting...');
    aborted = true;
    queueManager.setStatus('aborted');
  });

  // Main processing loop
  queueManager.setStatus('running');
  
  while (!queueManager.isComplete() && !aborted) {
    const task = queueManager.getNextTask();

    if (!task) {
      // Check if blocked
      if (queueManager.isBlocked()) {
        display.error('Queue is blocked - circular dependency detected');
        // Show which tasks are blocked and raw dependency structure
        const state = queueManager.getState();
        for (const pendingTask of state.pendingTasks) {
          const deps = pendingTask.dependencies || [];
          if (deps.length > 0 && args.verbose) {
            // Log raw dependency structure for debugging
            display.info(`  [DEBUG] Task ${pendingTask.id} raw deps: ${JSON.stringify(deps).slice(0, 200)}`);
          }
          const unsatisfied = deps
            .filter(dep => {
              const depId = extractDepId(dep);
              const depTask = state.allTasks.find(t => t.id === depId);
              if (args.verbose) {
                display.info(`    [DEBUG] dep=${JSON.stringify(dep).slice(0,100)} -> depId=${depId} -> found=${!!depTask} state=${depTask?.state}`);
              }
              return !depTask || depTask.state !== 'completed';
            })
            .map(dep => extractDepId(dep).slice(0, 8));
          if (unsatisfied.length > 0) {
            display.error(`  Task ${pendingTask.id.slice(0, 8)} blocked by: ${unsatisfied.join(', ')}`);
          }
        }
        queueManager.setStatus('failed');
        break;
      }
      // No task ready, wait
      await new Promise(r => setTimeout(r, config.queue.pollIntervalMs));
      continue;
    }

    // Track when task became ready (for relative scheduling)
    if (!taskReadyTimes.has(task.id)) {
      taskReadyTimes.set(task.id, Date.now());
    }

    // Check if task has a schedule
    if (task.scheduledAt) {
      const readyTime = taskReadyTimes.get(task.id);
      const schedule = parseScheduledAt(task.scheduledAt, readyTime);

      if (schedule) {
        const now = Date.now();
        if (now < schedule.targetTime) {
          // Task not ready yet - calculate wait time
          const waitMs = schedule.targetTime - now;
          const waitStr = waitMs >= 60000
            ? `${Math.ceil(waitMs / 60000)}m`
            : `${Math.ceil(waitMs / 1000)}s`;

          display.info(`⏰ Task "${task.title || task.id.slice(0, 8)}" scheduled (${task.scheduledAt}), waiting ${waitStr}...`);

          // Check if all remaining tasks are scheduled and waiting
          const state = queueManager.getState();
          const allScheduled = state.pendingTasks.every(t => {
            if (!t.scheduledAt) return false;
            const tReady = taskReadyTimes.get(t.id) || now;
            const tSchedule = parseScheduledAt(t.scheduledAt, tReady);
            return tSchedule && now < tSchedule.targetTime;
          });

          if (allScheduled && state.pendingTasks.length > 0) {
            // Find the shortest wait time and sleep
            let minWait = waitMs;
            for (const t of state.pendingTasks) {
              const tReady = taskReadyTimes.get(t.id) || now;
              const tSchedule = parseScheduledAt(t.scheduledAt, tReady);
              if (tSchedule) {
                const tWait = tSchedule.targetTime - now;
                if (tWait > 0 && tWait < minWait) {
                  minWait = tWait;
                }
              }
            }
            display.info(`  All tasks scheduled, waiting ${Math.ceil(minWait / 1000)}s for next...`);
            await new Promise(r => setTimeout(r, Math.min(minWait, 5000))); // Wait up to 5s at a time
          }

          continue; // Skip this task for now, try again later
        }
      }
    }

    const taskNumber = queueManager.getMetrics().completedCount + queueManager.getMetrics().failedCount + 1;
    const totalTasks = queueManager.getMetrics().totalTasks;

    display.printTaskStart(task, taskNumber, totalTasks);

    // Apply task-level delay if specified (to help avoid rate limits)
    if (task.delay) {
      const delayMs = parseDelay(task.delay);
      if (delayMs && delayMs > 0) {
        console.log(`  ⏳ Waiting ${task.delay} before execution...`);
        await sleep(delayMs);
      }
    }

    // Start task
    queueManager.startTask(task.id);
    const goal = goalMap.get(task.goalId);
    const taskStartTime = Date.now();

    try {
      // Execute task
      const executionResult = await executeTask(
        task,
        goal,
        session.context,
        actionLlm,
        toolManifest,
        previousOutputs,
        sessionClient,
        sessionId
      );

      const executionDuration = (Date.now() - taskStartTime) / 1000;
      display.printExecutionComplete(executionDuration);

      // Write task output
      const outputPath = await outputWriter.writeTaskOutput(task, executionResult, {
        executedAt: executionResult.metadata.executedAt,
        durationMs: Date.now() - taskStartTime
      });

      logEntries.push({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        stage: 'execution',
        status: 'success',
        message: 'Task executed successfully',
        data: { outputPath }
      });

      // Evaluate task
      const evaluation = await evaluateTask(task, goal, executionResult, evalLlm);
      display.printEvaluationResult(evaluation.success, evaluation);

      // In verbose mode, show tool results for debugging
      if (args.verbose && executionResult.toolInvocations) {
        for (const toolResult of executionResult.toolInvocations) {
          display.printToolResult(toolResult);
        }
      }

      // Write evaluation
      await outputWriter.writeEvaluation(task, evaluation);

      logEntries.push({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        stage: 'evaluation',
        status: evaluation.success ? 'success' : 'failed',
        message: evaluation.reason.summary
      });

      if (evaluation.success) {
        // Mark task complete
        queueManager.completeTask(task.id, {
          ...executionResult,
          evaluation
        });

        previousOutputs.push({
          taskId: task.id,
          summary: evaluation.reason.summary
        });

        display.printProgress(queueManager.getProgress());

        // Apply buffer delay for tasks with dependents (single-threaded execution)
        const dependentCount = queueManager.getDependentCount(task.id);
        if (dependentCount > 0) {
          const bufferMs = await queueManager.waitForBuffer(task.id);
          if (args.verbose && bufferMs > 0) {
            display.info(`      Buffer delay: ${bufferMs}ms (${dependentCount} dependent task(s))`);
          }
        }
      } else {
        // Evaluation failed
        if (!config.queue.continueOnEvaluationFailure) {
          queueManager.failTask(task.id, new TaskEvaluationError(task.id, evaluation.reason.summary));
          queueManager.setStatus('failed');
          break;
        }
      }

    } catch (err) {
      display.printTaskError(err);
      
      logEntries.push({
        timestamp: new Date().toISOString(),
        taskId: task.id,
        stage: 'execution',
        status: 'error',
        message: err.message
      });

      queueManager.failTask(task.id, err);
      queueManager.setStatus('failed');
      break;
    }
  }

  // Write execution log
  const metrics = queueManager.getMetrics();
  
  await outputWriter.writeExecutionLog({
    sessionId: sessionId,
    startedAt: metrics.startedAt,
    completedAt: new Date().toISOString(),
    finalStatus: queueManager.getStatus(),
    entries: logEntries,
    metrics,
    config: {
      actionModel: config.actionLlm.model,
      evalModel: config.evaluationLlm.model
    }
  });

  // Write summary
  await outputWriter.writeSummary({
    sessionId: sessionId,
    startedAt: metrics.startedAt,
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - new Date(metrics.startedAt).getTime(),
    finalStatus: queueManager.getStatus(),
    totalTasks: metrics.totalTasks,
    completedCount: metrics.completedCount,
    failedCount: metrics.failedCount,
    totalExecutionTimeMs: metrics.totalExecutionTimeMs,
    totalTokens: metrics.totalTokenUsage.totalTokens,
    tasks: queueManager.getState().allTasks,
    issues: queueManager.getState().failedTasks.map(t => t.error?.message || 'Unknown error'),
    artifacts: []
  });

  // Generate bundle if successful
  let bundlePath = null;
  let evalResult = null;

  if (queueManager.isSuccessful() && !args['no-bundle']) {
    display.info('Generating bundle...');

    // Get sandbox path to include project files in bundle
    let sandboxPath = null;
    try {
      const sandboxInfo = await sessionClient.getSandboxInfo(sessionId);
      if (sandboxInfo.exists) {
        sandboxPath = sandboxInfo.path;
      }
    } catch (err) {
      display.warn(`Could not get sandbox info: ${err.message}`);
    }

    const bundleResult = await bundleGenerator.generateBundle({
      sessionId: sessionId,
      session,
      queueState: queueManager.getState(),
      executionOutputDir: outputWriter.getOutputDir(),
      sandboxDir: sandboxPath
    });

    bundlePath = bundleResult.path;

    // Auto-invoke output-eval if enabled and bundle was generated
    if (bundlePath && outputEvalEnabled) {
      display.info('Invoking output-eval...');

      evalResult = await outputEvalRunner.run(bundlePath, {
        verbose: args.verbose
      });

      if (evalResult.background) {
        display.info(`Output-eval started in background (PID: ${evalResult.pid})`);
      } else if (evalResult.success) {
        display.info(`Output-eval completed (${(evalResult.durationMs / 1000).toFixed(1)}s)`);
      } else {
        display.error(`Output-eval failed: ${evalResult.error || `Exit code ${evalResult.exitCode}`}`);
      }
    }
  }

  // Print completion
  if (aborted) {
    display.printAbort();
    process.exit(10);
  } else if (queueManager.isSuccessful()) {
    display.printCompletion(metrics, bundlePath, evalResult);
    process.exit(0);
  } else {
    const failedTask = queueManager.getState().failedTasks[0];
    display.printFailure(metrics, failedTask?.error?.message || 'Unknown error');
    process.exit(queueManager.getMetrics().failedCount > 0 ? 5 : 6);
  }
}

// Run
const args = parseArguments();
main(args).catch(err => {
  console.error(`Fatal error: ${err.message}`);
  if (err.details) {
    console.error(`Details: ${JSON.stringify(err.details)}`);
  }
  process.exit(1);
});
