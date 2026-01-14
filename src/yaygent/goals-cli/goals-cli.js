#!/usr/bin/env bun

/**
 * @fileoverview Goals CLI - Main entry point for goal-driven AI workflows
 * @module goals-cli
 */

import { writeFile } from 'fs/promises';
import { resolve, dirname, basename, extname } from 'path';
import { existsSync } from 'fs';

import { parseArguments, validateRequiredArgs, getVersion, getHelpText, formatErrors } from './lib/argument-parser.js';
import { GoalManager } from './lib/goal-manager.js';
import { ContextLoader } from './lib/context-loader.js';
import { PromptClient } from './lib/prompt-client.js';
import { format, formatValidationSummary, formatError } from './lib/output-formatter.js';
import { GoalsError, ConfigurationError, ExitCodes, getExitCode } from './lib/errors.js';
import defaultConfig, { validateConfig } from './configuration.js';

/**
 * Logger utility for verbose mode
 */
class Logger {
  constructor(verbose) {
    this.verbose = verbose;
  }

  info(message) {
    console.error(`[INFO] ${message}`);
  }

  debug(message) {
    if (this.verbose) {
      console.error(`[DEBUG] ${message}`);
    }
  }

  error(message) {
    console.error(`[ERROR] ${message}`);
  }

  success(message) {
    console.error(`[SUCCESS] ${message}`);
  }
}

/**
 * Load configuration from file or use default
 * @param {string} configPath - Path to configuration file
 * @param {Logger} logger - Logger instance
 * @returns {Promise<Object>}
 */
async function loadConfiguration(configPath, logger) {
  logger.debug(`Loading configuration from: ${configPath}`);
  
  // Check if custom config exists
  const resolvedPath = resolve(configPath);
  if (!existsSync(resolvedPath)) {
    logger.debug(`Config file not found at ${resolvedPath}, using defaults`);
    return defaultConfig;
  }
  
  try {
    const customConfig = await import(resolvedPath);
    const merged = deepMerge(defaultConfig, customConfig.default || customConfig);
    logger.debug('Custom configuration loaded and merged with defaults');
    return merged;
  } catch (err) {
    throw new ConfigurationError(
      `Failed to load configuration file: ${err.message}`,
      'config',
      { path: resolvedPath, originalError: err.message }
    );
  }
}

/**
 * Deep merge two objects
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Build the prompt payload from goals and context
 * @param {Object} goals - Loaded goals definition
 * @param {string} formattedContext - Formatted context string
 * @param {Object} config - Configuration
 * @returns {Object}
 */
function buildPromptPayload(goals, formattedContext, config) {
  // Default system prompt for goal processing
  const systemPrompt = `You are an expert AI assistant helping to analyze and process goals. 
Your task is to review the provided goals and context, then provide insights, suggestions, 
or execute the requested operations.

Be thorough, precise, and actionable in your responses.`;

  // Build user prompt with goals and context
  const userPrompt = `<goals>
${JSON.stringify(goals, null, 2)}
</goals>

<context>
${formattedContext}
</context>

<instructions>
Please analyze the provided goals and context. For each goal:
1. Assess feasibility and clarity
2. Identify any missing information or ambiguities
3. Suggest any dependencies or ordering considerations
4. Provide actionable next steps

Format your response as structured JSON with the following fields:
- analysis: Array of goal analyses
- recommendations: Overall recommendations
- suggestedOrder: Recommended execution order
- issues: Any problems or concerns identified
</instructions>`;

  return {
    systemPrompt,
    userPrompt,
    parameters: config.model?.parameters
  };
}

/**
 * Format byte size for display
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Run the CLI in dry-run mode
 * @param {Object} args - Parsed arguments
 * @param {Object} config - Configuration
 * @param {Logger} logger - Logger
 * @returns {Promise<CLIResult>}
 */
async function runDryRun(args, config, logger) {
  logger.info('Running in dry-run mode (validation only)');
  
  // Load and validate goals
  logger.debug(`Loading goals from: ${args.goals}`);
  const goalManager = new GoalManager(args.goals);
  const goals = await goalManager.load();
  logger.success(`Goals loaded: ${goals.goals.length} goals found`);
  
  // Load and validate context
  logger.debug(`Loading context from: ${args.context}`);
  const contextLoader = new ContextLoader(args.context);
  const context = await contextLoader.load();
  logger.success(`Context loaded: ${context.metadata.totalFiles} files (${formatSize(context.metadata.totalSize)})`);
  
  // Validate configuration
  const configValidation = validateConfig(config);
  if (!configValidation.valid) {
    throw new ConfigurationError(
      `Configuration validation failed: ${configValidation.errors.join('; ')}`,
      'config'
    );
  }
  logger.success('Configuration validated');
  
  // Build validation summary
  const summary = {
    goals: {
      path: args.goals,
      count: goals.goals.length,
      version: goals.version
    },
    context: {
      path: args.context,
      fileCount: context.metadata.totalFiles,
      totalSize: formatSize(context.metadata.totalSize)
    },
    config: {
      endpoint: config.endpoint.url,
      model: config.model?.name || 'default',
      authType: config.auth.type
    }
  };
  
  console.log(formatValidationSummary(summary));
  
  return {
    success: true,
    data: {
      mode: 'dry-run',
      validation: summary,
      goals: goals.goals.map(g => ({ id: g.id, objective: g.objective })),
      contextFiles: context.files.map(f => f.path)
    }
  };
}

/**
 * Run the CLI in execution mode
 * @param {Object} args - Parsed arguments
 * @param {Object} config - Configuration
 * @param {Logger} logger - Logger
 * @returns {Promise<CLIResult>}
 */
async function runExecution(args, config, logger) {
  // Load goals
  logger.debug(`Loading goals from: ${args.goals}`);
  const goalManager = new GoalManager(args.goals);
  const goals = await goalManager.load();
  logger.info(`Loaded ${goals.goals.length} goals`);
  
  // Load context
  logger.debug(`Loading context from: ${args.context}`);
  const contextLoader = new ContextLoader(args.context);
  const context = await contextLoader.load();
  logger.info(`Loaded ${context.metadata.totalFiles} context files (${formatSize(context.metadata.totalSize)})`);
  
  // Validate configuration
  const configValidation = validateConfig(config);
  if (!configValidation.valid) {
    throw new ConfigurationError(
      `Configuration validation failed: ${configValidation.errors.join('; ')}`,
      'config'
    );
  }
  
  // Create prompt client
  logger.debug('Initializing prompt client');
  const promptClient = new PromptClient({
    endpoint: config.endpoint,
    auth: config.auth,
    model: config.model,
    retry: config.retry
  });
  
  // Build prompt payload
  const formattedContext = contextLoader.getFormattedContext(config.prompt?.contextFormat || 'xml');
  const payload = buildPromptPayload(goals, formattedContext, config);
  
  // Execute prompt
  logger.info('Sending request to LLM endpoint...');
  const response = await promptClient.execute(payload);
  logger.success('Response received');
  
  if (response.usage) {
    logger.debug(`Token usage: ${response.usage.totalTokens} total (${response.usage.inputTokens} input, ${response.usage.outputTokens} output)`);
  }
  
  // Build result
  const result = {
    success: true,
    session: {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString()
    },
    goals: goals,
    context: {
      files: context.files.map(f => ({ path: f.path, size: f.size })),
      metadata: context.metadata
    },
    response: response
  };
  
  return { success: true, data: result };
}

/**
 * Determine the output file path based on format
 * @param {string} destination - Original output destination
 * @param {string} formatType - Output format type
 * @returns {string}
 */
function getOutputPath(destination, formatType) {
  if (destination === 'stdout') {
    return destination;
  }

  // Map format types to file extensions
  const extensionMap = {
    json: '.json',
    toon: '.md',
    markdown: '.md',
    text: '.txt'
  };

  const targetExt = extensionMap[formatType] || '.json';
  const currentExt = extname(destination);

  // If no extension or different extension, update it
  if (!currentExt) {
    return destination + targetExt;
  }

  // For toon format, ensure .md extension
  if (formatType === 'toon' && currentExt !== '.md') {
    return destination.slice(0, -currentExt.length) + '.md';
  }

  return destination;
}

/**
 * Write output to destination
 * @param {string} output - Output string
 * @param {string} destination - 'stdout' or file path
 * @param {Logger} logger - Logger
 */
async function writeOutput(output, destination, logger) {
  if (destination === 'stdout') {
    console.log(output);
  } else {
    await writeFile(destination, output, 'utf-8');
    logger.success(`Output written to: ${destination}`);
  }
}

/**
 * Main CLI execution function
 * @param {string[]} argv - Command line arguments
 * @returns {Promise<number>} Exit code
 */
async function main(argv) {
  // Parse arguments
  const args = parseArguments(argv.slice(2));
  const logger = new Logger(args.verbose);
  
  // Handle parsing errors
  if (args.errors.length > 0) {
    console.error(formatErrors(args.errors));
    return ExitCodes.INVALID_ARGUMENTS;
  }
  
  // Handle --help
  if (args.help) {
    console.log(getHelpText());
    return ExitCodes.SUCCESS;
  }
  
  // Handle --version
  if (args.version) {
    console.log(`Goals CLI v${getVersion()}`);
    return ExitCodes.SUCCESS;
  }
  
  // Validate required arguments
  const requiredErrors = validateRequiredArgs(args);
  if (requiredErrors.length > 0) {
    console.error(formatErrors(requiredErrors));
    return ExitCodes.INVALID_ARGUMENTS;
  }
  
  try {
    // Load configuration
    const config = await loadConfiguration(args.config, logger);
    
    // Run in appropriate mode
    let result;
    if (args.dryRun) {
      result = await runDryRun(args, config, logger);
    } else {
      result = await runExecution(args, config, logger);
    }
    
    // Format and write output
    const outputFormat = args.format || config.output?.defaultFormat || 'json';
    const formatted = format(result.data, outputFormat, { prettyPrint: config.output?.prettyPrint });
    const outputPath = getOutputPath(args.output, outputFormat);
    await writeOutput(formatted, outputPath, logger);
    
    return ExitCodes.SUCCESS;
    
  } catch (err) {
    // Format and display error
    console.error(formatError(err, args.verbose));
    
    // Return appropriate exit code
    return getExitCode(err);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1]?.endsWith('goals-cli.js');

if (isMainModule) {
  main(process.argv).then(exitCode => {
    process.exit(exitCode);
  });
}

// Export for testing
export { main, buildPromptPayload, loadConfiguration };
