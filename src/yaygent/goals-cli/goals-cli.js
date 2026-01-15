#!/usr/bin/env bun

/**
 * @fileoverview Goals CLI - Main entry point for goal-driven AI workflows
 * @module goals-cli
 */

import { writeFile, readFile } from 'fs/promises';
import { resolve, dirname, basename, extname } from 'path';
import { existsSync } from 'fs';

import { parseArguments, validateRequiredArgs, getVersion, getHelpText, formatErrors } from './lib/argument-parser.js';
import { GoalManager } from './lib/goal-manager.js';
import { ContextLoader } from './lib/context-loader.js';
import { PromptClient } from './lib/prompt-client.js';
import { format, formatValidationSummary, formatError } from './lib/output-formatter.js';
import { GoalsError, ConfigurationError, ExitCodes, getExitCode } from './lib/errors.js';
import defaultConfig, { validateConfig } from './configuration.js';
import {
  loadObjectFromFile,
  loadObjectFromUrl,
  coerceConfigToProjectGoals,
  mergeGoals,
  validateGoalsStructure
} from './lib/config-loader.js';
import {
  getByPath,
  setByPath,
  deleteByPath,
  collectContentStringPaths,
  shouldIncludePath
} from './lib/path-utils.js';
import {
  aiEditStrings,
  applyAiEdits,
  previewAiEdits,
  validateAiEditConfig
} from './lib/ai-editor.js';
import {
  App,
  GoalsBrowserScreen,
  AiEditPreviewScreen,
  ANSI,
  writeStdout,
  runMainTui,
  getDefaultThemePath
} from './tui/index.js';

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
 * Default goals file path
 */
const DEFAULT_GOALS_FILE = './goals.json';

/**
 * Load goals from the default or specified file
 * @param {string} [goalsPath] - Path to goals file
 * @returns {Promise<Object>}
 */
async function loadGoalsFile(goalsPath = DEFAULT_GOALS_FILE) {
  const absPath = resolve(goalsPath);
  if (!existsSync(absPath)) {
    // Return empty structure if file doesn't exist
    return {
      version: '1.0',
      goals: [],
      metadata: { createdAt: new Date().toISOString() }
    };
  }
  const content = await readFile(absPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Save goals to the default or specified file
 * @param {Object} goals - Goals object
 * @param {string} [goalsPath] - Path to goals file
 */
async function saveGoalsFile(goals, goalsPath = DEFAULT_GOALS_FILE) {
  await writeFile(goalsPath, JSON.stringify(goals, null, 2), 'utf-8');
}

/**
 * Handle the import command
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdImport(args, logger) {
  logger.info('Importing configuration...');

  // Load from file or URL
  let imported;
  if (args.file) {
    logger.debug(`Loading from file: ${args.file}`);
    imported = await loadObjectFromFile(args.file);
  } else if (args.url) {
    logger.debug(`Loading from URL: ${args.url}`);
    imported = await loadObjectFromUrl(args.url);
  }

  // Coerce to standard format
  const { project, goals: importedGoals } = coerceConfigToProjectGoals(imported);

  // Validate imported goals
  const validation = validateGoalsStructure({ version: project.version || '1.0', goals: importedGoals });
  if (!validation.valid) {
    throw new ConfigurationError(
      `Imported goals are invalid: ${validation.errors.join('; ')}`,
      'import'
    );
  }

  // Load existing goals
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;
  const existing = await loadGoalsFile(goalsPath);

  // Merge or replace
  let finalGoals;
  if (args.replace) {
    logger.debug('Replacing existing goals');
    finalGoals = {
      version: project.version || existing.version || '1.0',
      goals: importedGoals,
      metadata: { ...existing.metadata, ...project.metadata, updatedAt: new Date().toISOString() },
      globalContext: project.globalContext || existing.globalContext
    };
  } else {
    logger.debug('Merging with existing goals');
    const mergedGoalsList = mergeGoals(existing.goals, importedGoals);
    finalGoals = {
      version: existing.version || project.version || '1.0',
      goals: mergedGoalsList,
      metadata: { ...existing.metadata, updatedAt: new Date().toISOString() },
      globalContext: existing.globalContext || project.globalContext
    };
  }

  // Save
  await saveGoalsFile(finalGoals, goalsPath);
  logger.success(`Imported ${importedGoals.length} goals to ${goalsPath}`);
  console.log(JSON.stringify({ imported: importedGoals.length, total: finalGoals.goals.length }, null, 2));

  return ExitCodes.SUCCESS;
}

/**
 * Handle the get command
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdGet(args, logger) {
  const pathExpr = args.positional[0];
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;

  logger.debug(`Getting value at path: ${pathExpr}`);

  const goals = await loadGoalsFile(goalsPath);
  const value = getByPath(goals, pathExpr);

  if (value === undefined) {
    console.error(`Path not found: ${pathExpr}`);
    return ExitCodes.VALIDATION_ERROR;
  }

  // Output based on type
  if (typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(value);
  }

  return ExitCodes.SUCCESS;
}

/**
 * Handle the set command
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdSet(args, logger) {
  const pathExpr = args.positional[0];
  let value = args.positional.slice(1).join(' ');
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;

  logger.debug(`Setting value at path: ${pathExpr}`);

  // Try to parse value as JSON for objects/arrays/numbers/booleans
  try {
    value = JSON.parse(value);
  } catch {
    // Keep as string if not valid JSON
  }

  const goals = await loadGoalsFile(goalsPath);
  setByPath(goals, pathExpr, value);

  // Update metadata
  if (goals.metadata) {
    goals.metadata.updatedAt = new Date().toISOString();
  }

  await saveGoalsFile(goals, goalsPath);
  logger.success(`Set ${pathExpr}`);
  console.log(JSON.stringify({ path: pathExpr, value }, null, 2));

  return ExitCodes.SUCCESS;
}

/**
 * Handle the delete command
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdDelete(args, logger) {
  const pathExpr = args.positional[0];
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;

  logger.debug(`Deleting value at path: ${pathExpr}`);

  const goals = await loadGoalsFile(goalsPath);
  const deleted = deleteByPath(goals, pathExpr);

  if (!deleted) {
    console.error(`Path not found: ${pathExpr}`);
    return ExitCodes.VALIDATION_ERROR;
  }

  // Update metadata
  if (goals.metadata) {
    goals.metadata.updatedAt = new Date().toISOString();
  }

  await saveGoalsFile(goals, goalsPath);
  logger.success(`Deleted ${pathExpr}`);

  return ExitCodes.SUCCESS;
}

/**
 * Handle the list-paths command
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdListPaths(args, logger) {
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;

  logger.debug('Listing editable paths');

  const goals = await loadGoalsFile(goalsPath);

  // Determine structure - if goals.project exists, use that, otherwise use flat structure
  const hasProjectStructure = !!goals.project;
  const project = hasProjectStructure ? goals.project : { metadata: goals.metadata };
  const goalsList = hasProjectStructure ? goals.project.goals : goals.goals;

  // Create a wrapper object to match path expressions
  const wrapper = hasProjectStructure ? goals : { project: { metadata: goals.metadata }, goals: goals.goals };

  const paths = collectContentStringPaths(project, goalsList, { includeContext: true });

  // Filter by include/exclude patterns
  const filteredPaths = paths.filter(p =>
    shouldIncludePath(p, args.include, args.exclude)
  );

  // Output
  if (args.format === 'json') {
    console.log(JSON.stringify(filteredPaths, null, 2));
  } else {
    for (const p of filteredPaths) {
      // Map path to actual location in goals object
      let actualPath = p;
      if (!hasProjectStructure && p.startsWith('project.metadata.')) {
        // Map project.metadata.X to metadata.X for flat structure
        actualPath = p.replace('project.metadata.', 'metadata.');
      }
      const value = getByPath(goals, actualPath);
      const preview = typeof value === 'string'
        ? value.substring(0, 60) + (value.length > 60 ? '...' : '')
        : JSON.stringify(value);
      console.log(`${p}: ${preview}`);
    }
  }

  logger.info(`Found ${filteredPaths.length} paths`);
  return ExitCodes.SUCCESS;
}

/**
 * Handle the ai-edit command
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdAiEdit(args, logger) {
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;

  logger.info('Starting AI edit...');

  // Build AI edit config from args
  const aiConfig = {
    llmUrl: args.llmUrl,
    protocol: args.llmProtocol || 'json',
    model: args.llmModel,
    batchSize: args.llmBatchSize || 10,
    timeoutMs: args.llmTimeoutMs || 120000,
    retries: args.llmRetries || 3,
    backoffMs: args.llmBackoffMs || 500,
    backoffMaxMs: args.llmBackoffMaxMs || 8000,
    includeGlobs: args.include || [],
    excludeGlobs: args.exclude || [],
    includeContext: args.aiEditIncludeContext || false,
    debugPath: args.verbose ? 'stderr' : null,
    apiKey: process.env.GOALS_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY
  };

  // Validate config
  const validation = validateAiEditConfig(aiConfig);
  if (!validation.valid) {
    for (const err of validation.errors) {
      console.error(`Error: ${err}`);
    }
    return ExitCodes.INVALID_ARGUMENTS;
  }

  // Load goals
  const goals = await loadGoalsFile(goalsPath);

  // Determine structure
  const hasProjectStructure = !!goals.project;
  const project = hasProjectStructure ? goals.project : { metadata: goals.metadata };
  const goalsList = hasProjectStructure ? goals.project?.goals : goals.goals;

  if (!goalsList || goalsList.length === 0) {
    console.error('No goals found in the file');
    return ExitCodes.VALIDATION_ERROR;
  }

  logger.debug(`Found ${goalsList.length} goals to process`);

  try {
    // Run AI editing
    const { edits, stats } = await aiEditStrings(aiConfig, project, goalsList);

    logger.info(`AI edit stats: ${stats.total} candidates, ${stats.processed} processed, ${stats.edited} edited`);

    if (edits.size === 0) {
      console.log('No edits suggested by AI.');
      return ExitCodes.SUCCESS;
    }

    // Preview or apply edits
    if (args.preview) {
      console.log('\n=== Proposed Edits ===\n');
      const previews = previewAiEdits(project, goalsList, edits);

      for (const preview of previews) {
        console.log(`Path: ${preview.path}`);
        console.log(`Before: ${preview.before.substring(0, 100)}${preview.before.length > 100 ? '...' : ''}`);
        console.log(`After:  ${preview.after.substring(0, 100)}${preview.after.length > 100 ? '...' : ''}`);
        console.log('');
      }

      console.log(`Total: ${previews.length} edit(s) proposed`);
      console.log('Run without --preview to apply these edits.');
    } else {
      // Apply edits
      applyAiEdits(project, goalsList, edits);

      // Reconstruct goals object
      let updatedGoals;
      if (hasProjectStructure) {
        updatedGoals = { ...goals, project: { ...project, goals: goalsList } };
      } else {
        updatedGoals = {
          ...goals,
          metadata: project.metadata,
          goals: goalsList
        };
      }

      // Update metadata
      if (updatedGoals.metadata) {
        updatedGoals.metadata.updatedAt = new Date().toISOString();
        updatedGoals.metadata.lastAiEdit = new Date().toISOString();
      }

      // Save
      await saveGoalsFile(updatedGoals, goalsPath);
      logger.success(`Applied ${edits.size} edit(s) to ${goalsPath}`);

      console.log(JSON.stringify({
        applied: edits.size,
        file: goalsPath
      }, null, 2));
    }

    return ExitCodes.SUCCESS;

  } catch (err) {
    console.error(`AI edit failed: ${err.message}`);
    if (args.verbose) {
      console.error(err.stack);
    }
    return ExitCodes.API_ERROR;
  }
}

/**
 * Handle the browse command (TUI)
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdBrowse(args, logger) {
  const goalsPath = args.goals || DEFAULT_GOALS_FILE;

  logger.debug('Starting TUI browser...');

  // Load goals
  const goals = await loadGoalsFile(goalsPath);

  if (!goals.goals || goals.goals.length === 0) {
    console.error('No goals found in the file');
    return ExitCodes.VALIDATION_ERROR;
  }

  // Return a promise that resolves when TUI exits
  return new Promise((resolve) => {
    // Create TUI app
    const app = new App();

    // Override shutdown to resolve promise instead of process.exit
    const originalShutdown = app.shutdown.bind(app);
    app.shutdown = () => {
      if (!app.running) return;
      app.running = false;

      // Stop render loop
      if (app._renderLoop) {
        clearInterval(app._renderLoop);
        app._renderLoop = null;
      }

      // Stop input
      app.input.stop();

      // Restore terminal
      writeStdout(ANSI.reset());
      writeStdout(ANSI.showCursor());
      writeStdout(ANSI.altScreenOff());

      // Resolve instead of exit
      resolve(ExitCodes.SUCCESS);
    };

    // Create browse screen
    const screen = new GoalsBrowserScreen({
      goals,
      onSelect: (goal, index) => {
        logger.debug(`Selected goal: ${goal.id}`);
      },
      onBack: () => {
        app.shutdown();
      }
    });

    // Start TUI
    app.mount(screen).start();
  });
}

/**
 * Resolve theme path from name or path
 * @param {string} theme - Theme name or path
 * @returns {string|null} Resolved path or null
 */
function resolveThemePath(theme) {
  if (!theme) return null;

  // Check if it's a path (contains / or \ or ends with .toml)
  if (theme.includes('/') || theme.includes('\\') || theme.endsWith('.toml')) {
    return resolve(theme);
  }

  // Treat as built-in theme name
  const themesDir = dirname(getDefaultThemePath());
  const themePath = resolve(themesDir, `${theme}.toml`);

  if (existsSync(themePath)) {
    return themePath;
  }

  // Not found - return as-is and let theme loader handle error
  return theme;
}

/**
 * Handle the tui command (full tabbed TUI)
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @returns {Promise<number>} Exit code
 */
async function cmdTui(args, logger) {
  logger.debug('Starting tabbed TUI...');

  // Resolve theme path
  const themePath = resolveThemePath(args.theme);
  if (themePath) {
    logger.debug(`Using theme: ${themePath}`);
  }

  try {
    await runMainTui({
      goalsPath: args.goals || DEFAULT_GOALS_FILE,
      contextPath: args.context,
      serverUrl: args.serverUrl || process.env.SESSION_SERVER_URL || 'http://localhost:3000',
      outputDir: args.output || process.env.OUTPUT_DIR || './output',
      themePath
    });

    return ExitCodes.SUCCESS;
  } catch (err) {
    logger.error(`TUI error: ${err.message}`);
    return ExitCodes.UNKNOWN_ERROR;
  }
}

/**
 * Run AI edit with TUI preview
 * @param {Object} args - Parsed arguments
 * @param {Logger} logger - Logger
 * @param {Map} edits - AI edit results
 * @param {Object} project - Project metadata
 * @param {Object[]} goalsList - Goals list
 * @returns {Promise<Object[]>} Selected edits
 */
async function runTuiEditPreview(args, logger, edits, project, goalsList) {
  // Convert edits to preview format
  const previews = previewAiEdits(project, goalsList, edits);

  return new Promise((resolve) => {
    const app = new App();

    const screen = new AiEditPreviewScreen({
      edits: previews,
      onApply: (selected) => {
        app.shutdown();
        resolve(selected);
      },
      onCancel: () => {
        app.shutdown();
        resolve([]);
      }
    });

    app.mount(screen).start();
  });
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
    // Route to command handlers
    if (args.command) {
      switch (args.command) {
        case 'import':
          return await cmdImport(args, logger);

        case 'get':
          return await cmdGet(args, logger);

        case 'set':
          return await cmdSet(args, logger);

        case 'delete':
          return await cmdDelete(args, logger);

        case 'list-paths':
          return await cmdListPaths(args, logger);

        case 'ai-edit':
          return await cmdAiEdit(args, logger);

        case 'browse':
          return await cmdBrowse(args, logger);

        case 'tui':
          return await cmdTui(args, logger);

        case 'validate':
          // Treat validate as dry-run
          args.dryRun = true;
          break;

        case 'run':
          // Continue to legacy execution
          break;

        default:
          console.error(`Unknown command: ${args.command}`);
          return ExitCodes.INVALID_ARGUMENTS;
      }
    }

    // Legacy mode or run/validate commands
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
