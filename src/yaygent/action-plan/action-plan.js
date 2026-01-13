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

/**
 * Parse command line arguments
 * @returns {Object}
 */
function parseArguments() {
  const options = {
    session: { type: 'string', short: 's' },
    config: { type: 'string', short: 'c' },
    output: { type: 'string', short: 'o' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    verbose: { type: 'boolean', short: 'v', default: false },
    'no-bundle': { type: 'boolean', default: false },
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

Options:
  -s, --session <id>   Session ID to process (required)
  -c, --config <path>  Configuration file path
  -o, --output <path>  Output directory (default: ./output)
  -d, --dry-run        Validate without executing
  -v, --verbose        Enable verbose logging
  --no-bundle          Skip bundle generation
  -r, --resume         Resume from last checkpoint
  -h, --help           Show this help
  -V, --version        Show version

Environment Variables:
  SESSION_SERVER_URL   Goals Session Server URL (default: http://localhost:3000)
  LLM_API_KEY          LLM API key for execution and evaluation
  LLM_MODEL            LLM model name
  OUTPUT_DIR           Default output directory

Examples:
  action-plan -s 550e8400-e29b-41d4-a716-446655440000
  action-plan -s 550e8400... -o ./my-output -v
  action-plan -s 550e8400... --dry-run
`);
}

/**
 * Show version
 */
function showVersion() {
  console.log('Action Plan Service v1.0.0');
}

/**
 * Simulate tool execution (since we don't have direct access to Tool Router)
 * In a real implementation, this would call the session server's tool endpoint
 * @param {string} toolName
 * @param {Object} parameters
 * @returns {Promise<Object>}
 */
async function simulateToolExecution(toolName, parameters) {
  // Simulate notepad tool operations
  const startTime = Date.now();
  
  // In a real scenario, this would make an API call to execute the tool
  // For now, we simulate the response
  let result;
  
  switch (toolName) {
    case 'notepad_create':
      result = `Successfully created note: ${parameters.filename}`;
      break;
    case 'notepad_write':
      result = `Successfully wrote to note: ${parameters.filename}`;
      break;
    case 'notepad_read':
      result = `Content of ${parameters.filename}: (simulated content)`;
      break;
    case 'notepad_list':
      result = 'Available notes: (simulated list)';
      break;
    case 'notepad_delete':
      result = `Successfully deleted note: ${parameters.filename}`;
      break;
    default:
      result = `Executed tool ${toolName} with parameters: ${JSON.stringify(parameters)}`;
  }
  
  return {
    toolName,
    parameters,
    result,
    success: true,
    durationMs: Date.now() - startTime
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
 * @returns {Promise<Object>}
 */
async function executeTask(task, goal, context, actionLlm, toolManifest, previousOutputs) {
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
  const toolUse = parseToolUse(response.content);
  
  const toolInvocations = [];
  
  if (toolUse) {
    // Execute the tool (simulated)
    const toolResult = await simulateToolExecution(toolUse.toolName, toolUse.parameters);
    toolInvocations.push(toolResult);
  } else {
    // No tool use detected, use the task's predefined parameters
    const toolResult = await simulateToolExecution(
      task.tool.toolName,
      task.tool.command.parameters
    );
    toolInvocations.push(toolResult);
  }

  return {
    taskId: task.id,
    success: true,
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

  // Validate required arguments
  if (!args.session) {
    console.error('Error: --session is required');
    showHelp();
    process.exit(2);
  }

  // Initialize display
  const display = new ProgressDisplay({ verbose: args.verbose });
  display.printHeader(args.session);

  // Validate configuration
  if (!config.actionLlm.apiKey) {
    throw new ConfigurationError('LLM API key is required. Set LLM_API_KEY environment variable.', 'actionLlm.apiKey');
  }

  // Initialize clients
  const sessionClient = new SessionClient(config.sessionServer);
  const actionLlm = new LLMClient(config.actionLlm);
  const evalLlm = new LLMClient(config.evaluationLlm);
  
  const outputDir = args.output || config.output.baseDir;
  const outputWriter = new OutputWriter(outputDir, args.session);
  const bundleGenerator = new BundleGenerator(outputDir);

  // Check session server connectivity
  display.info('Connecting to session server...');
  const serverHealthy = await sessionClient.healthCheck();
  if (!serverHealthy) {
    display.error('Cannot connect to session server');
    process.exit(4);
  }

  // Get session
  display.info('Loading session...');
  const session = await sessionClient.getSession(args.session, { includeContext: true });

  // Validate session state
  if (session.state !== 'GENERATED') {
    throw new SessionInvalidStateError(args.session, session.state, 'GENERATED');
  }

  if (!session.taskList || !session.taskList.tasks || session.taskList.tasks.length === 0) {
    display.error('Session has no tasks to execute');
    process.exit(4);
  }

  // Get tool manifest
  const toolManifest = await sessionClient.getToolManifest();

  // Initialize queue manager
  const queueManager = new QueueManager(args.session, session.taskList.tasks);
  
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
        queueManager.setStatus('failed');
        break;
      }
      // No task ready, wait
      await new Promise(r => setTimeout(r, config.queue.pollIntervalMs));
      continue;
    }

    const taskNumber = queueManager.getMetrics().completedCount + queueManager.getMetrics().failedCount + 1;
    const totalTasks = queueManager.getMetrics().totalTasks;

    display.printTaskStart(task, taskNumber, totalTasks);
    
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
        previousOutputs
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
      display.printEvaluationResult(evaluation.success);

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
    sessionId: args.session,
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
    sessionId: args.session,
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
  
  if (queueManager.isSuccessful() && !args['no-bundle']) {
    display.info('Generating bundle...');
    
    const bundleResult = await bundleGenerator.generateBundle({
      sessionId: args.session,
      session,
      queueState: queueManager.getState(),
      executionOutputDir: outputWriter.getOutputDir()
    });
    
    bundlePath = bundleResult.path;
  }

  // Print completion
  if (aborted) {
    display.printAbort();
    process.exit(10);
  } else if (queueManager.isSuccessful()) {
    display.printCompletion(metrics, bundlePath);
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
