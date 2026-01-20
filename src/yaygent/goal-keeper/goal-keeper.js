#!/usr/bin/env node

/**
 * @fileoverview Goal Keeper Service - Main entry point
 * 
 * Watches a directory for goals files from the Goals CLI,
 * then triggers session creation and task list generation
 * on the Goals Session Server.
 * 
 * @module goal-keeper
 */

import { parseArgs } from 'util';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import config from './goal-keeper-config.js';
import { DirectoryWatcher } from './lib/directory-watcher.js';
import { SessionClient } from './lib/session-client.js';
import { FileProcessor } from './lib/file-processor.js';
import { ActionPlanRunner } from './lib/action-plan-runner.js';
import { ConfigurationError } from './lib/errors.js';

/**
 * Parse command line arguments
 */
function parseArguments() {
  const options = {
    watch: { type: 'string', short: 'w' },
    server: { type: 'string', short: 's' },
    config: { type: 'string', short: 'c' },
    'poll-interval': { type: 'string', short: 'p' },
    verbose: { type: 'boolean', short: 'v', default: false },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    'no-move': { type: 'boolean', default: false },
    'no-action-plan': { type: 'boolean', default: false },
    'action-plan-background': { type: 'boolean', default: false },
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
 * Show help
 */
function showHelp() {
  console.log(`
Goals Keeper Service v1.0.0

Watches a directory for goals files and automatically triggers
session creation and task list generation on the Session Server.

Usage: goals-keeper [options]

Options:
  -w, --watch <path>        Directory to watch (default: ./watch)
  -s, --server <url>        Session server URL (default: http://localhost:3000)
  -p, --poll-interval <ms>  Polling interval in ms (default: 2000)
  -v, --verbose             Enable verbose logging
  -d, --dry-run             Process files without calling server
  --no-move                 Don't move processed/failed files
  --no-action-plan          Don't auto-invoke action-plan after processing
  --action-plan-background  Run action-plan in background
  -h, --help                Show this help
  -V, --version             Show version

Environment Variables:
  WATCH_PATH                Directory to watch
  SESSION_SERVER_URL        Session server URL
  POLL_INTERVAL             Polling interval in ms
  LOG_LEVEL                 Logging level (debug, info, warn, error)

File Structure:
  The watcher expects goals files in JSON format:
  
  watch/
  ├── my-goals.json         # Goals file (required)
  └── context/              # Context directory (optional)
      ├── requirements.md
      └── notes.txt

  After processing:
  watch/
  ├── _processed/           # Successfully processed files
  │   ├── 2025-01-13_my-goals.json
  │   └── 2025-01-13_my-goals_result.json
  └── _failed/              # Failed files with error details
      ├── 2025-01-13_bad-goals.json
      └── 2025-01-13_bad-goals_error.json

Examples:
  goals-watcher -w ./inbox -s http://localhost:3000
  goals-watcher --watch ./goals-inbox --verbose
  goals-watcher -w ./watch --dry-run
`);
}

/**
 * Show version
 */
function showVersion() {
  console.log('Goals Watcher Service v1.0.0');
}

/**
 * Logger
 */
class Logger {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.level = options.level || 'info';
  }

  timestamp() {
    return new Date().toISOString();
  }

  debug(message, data = null) {
    if (this.verbose) {
      console.log(`[${this.timestamp()}] [DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  info(message, data = null) {
    console.log(`[${this.timestamp()}] [INFO] ${message}`, data ? JSON.stringify(data) : '');
  }

  warn(message, data = null) {
    console.warn(`[${this.timestamp()}] [WARN] ${message}`, data ? JSON.stringify(data) : '');
  }

  error(message, data = null) {
    console.error(`[${this.timestamp()}] [ERROR] ${message}`, data ? JSON.stringify(data) : '');
  }

  success(message, data = null) {
    console.log(`[${this.timestamp()}] [SUCCESS] [+] ${message}`, data ? JSON.stringify(data) : '');
  }
}

/**
 * Main service class
 */
class GoalsWatcherService {
  constructor(options = {}) {
    this.watchPath = options.watchPath || config.watch.path;
    this.serverUrl = options.serverUrl || config.sessionServer.baseUrl;
    this.dryRun = options.dryRun || false;
    this.moveFiles = options.moveFiles !== false;
    
    this.logger = new Logger({ verbose: options.verbose });
    
    this.watcher = new DirectoryWatcher(this.watchPath, {
      pollIntervalMs: options.pollIntervalMs || config.watch.pollIntervalMs,
      filePattern: config.watch.filePattern,
      stabilityThresholdMs: config.watch.stabilityThresholdMs,
      ignorePatterns: config.watch.ignorePatterns
    });

    this.sessionClient = new SessionClient({
      baseUrl: this.serverUrl,
      timeout: config.sessionServer.timeout,
      retry: config.sessionServer.retry
    });

    this.fileProcessor = new FileProcessor({
      moveProcessed: this.moveFiles,
      processedDir: config.processing.processedDir,
      failedDir: config.processing.failedDir,
      includeContext: config.processing.includeContext,
      contextDirName: config.processing.contextDirName
    });

    // Initialize ActionPlanRunner
    this.actionPlanEnabled = options.actionPlanEnabled !== false && config.actionPlan.enabled;
    this.actionPlanRunner = new ActionPlanRunner({
      ...config.actionPlan,
      enabled: this.actionPlanEnabled,
      runInBackground: options.actionPlanBackground || config.actionPlan.runInBackground
    }, this.logger);

    this.processing = false;
    this.stats = {
      filesDetected: 0,
      filesProcessed: 0,
      filesFailed: 0,
      sessionsCreated: 0,
      actionPlansStarted: 0,
      actionPlansCompleted: 0,
      actionPlansFailed: 0,
      startedAt: null
    };
  }

  /**
   * Start the service
   */
  async start() {
    this.logger.info('Starting Goal Keeper Service...');
    this.logger.info(`Watch path: ${this.watchPath}`);
    this.logger.info(`Session server: ${this.serverUrl}`);

    if (this.dryRun) {
      this.logger.warn('DRY RUN MODE - No server calls will be made');
    }

    // Log action-plan integration status
    if (this.actionPlanEnabled) {
      if (this.actionPlanRunner.isAvailable()) {
        this.logger.info('Action-plan integration: enabled');
        this.logger.info(`  Executable: ${this.actionPlanRunner.executablePath}`);
        this.logger.info(`  Run in background: ${this.actionPlanRunner.runInBackground}`);
      } else {
        this.logger.warn('Action-plan integration: enabled but executable not found');
        this.logger.warn(`  Expected at: ${this.actionPlanRunner.executablePath}`);
      }
    } else {
      this.logger.info('Action-plan integration: disabled');
    }

    // Ensure watch directory exists
    if (!existsSync(this.watchPath)) {
      this.logger.info(`Creating watch directory: ${this.watchPath}`);
      await mkdir(this.watchPath, { recursive: true });
    }

    // Check server connectivity (unless dry run)
    if (!this.dryRun) {
      this.logger.info('Checking session server connectivity...');
      const healthy = await this.sessionClient.healthCheck();
      if (!healthy) {
        this.logger.error('Cannot connect to session server');
        throw new ConfigurationError('Session server is not reachable', 'sessionServer.baseUrl');
      }
      this.logger.info('Session server is healthy');
    }

    // Setup watcher event handlers
    this.setupEventHandlers();

    // Start watching
    this.stats.startedAt = new Date();
    await this.watcher.start();

    this.logger.info('Goal Keeper started - waiting for goals files...');
    this.printStatus();
  }

  /**
   * Setup event handlers for watcher
   * @private
   */
  setupEventHandlers() {
    this.watcher.on('detected', (file) => {
      this.stats.filesDetected++;
      this.logger.info(`File detected: ${file.filename}`);
      this.logger.debug('File details', file);
    });

    this.watcher.on('stable', async (file) => {
      this.logger.info(`File stable, processing: ${file.filename}`);
      await this.processFile(file);
    });

    this.watcher.on('removed', (file) => {
      this.logger.debug(`File removed: ${file.filename}`);
    });

    this.watcher.on('error', (err) => {
      this.logger.error(`Watcher error: ${err.message}`);
    });
  }

  /**
   * Process a detected file
   * @param {Object} file
   * @private
   */
  async processFile(file) {
    if (this.processing) {
      this.logger.debug('Already processing, will retry later');
      return;
    }

    this.processing = true;
    const startTime = Date.now();

    try {
      this.logger.info(`Processing: ${file.filename}`);

      // Step 1: Parse and validate goals file
      this.logger.debug('Step 1: Parsing goals file...');
      const payload = await this.fileProcessor.process(file.path);
      
      this.logger.info(`Loaded ${payload.goals.goals.length} goals`);
      if (payload.context.files.length > 0) {
        this.logger.info(`Loaded ${payload.context.files.length} context files`);
      }

      let result;

      if (this.dryRun) {
        // Dry run - just validate
        this.logger.info('DRY RUN: Would create session with:');
        this.logger.info(`  - Goals: ${payload.goals.goals.length}`);
        this.logger.info(`  - Context files: ${payload.context.files.length}`);
        result = {
          dryRun: true,
          goalsCount: payload.goals.goals.length,
          contextFilesCount: payload.context.files.length
        };
      } else {
        // Step 2: Create session and process
        this.logger.info('Step 2: Creating session on server...');
        
        result = await this.sessionClient.createAndProcess(
          {
            goals: payload.goals,
            context: payload.context
          },
          {
            evaluation: config.llm.evaluationOptions,
            taskGeneration: config.llm.taskGenerationOptions
          }
        );

        this.stats.sessionsCreated++;
        this.logger.success(`Session created: ${result.sessionId}`);
        this.logger.info(`  State: ${result.state}`);
        this.logger.info(`  Tasks generated: ${result.taskList?.taskList?.tasks?.length || 0}`);

        // Auto-invoke action-plan if enabled and session is ready
        if (this.actionPlanEnabled && result.state === 'GENERATED') {
          await this.invokeActionPlan(result.sessionId, file);
        }
      }

      // Mark file as processed
      await this.fileProcessor.markProcessed(file.path, result);
      this.watcher.markProcessed(file.path);

      this.stats.filesProcessed++;
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.success(`Processing complete (${duration}s): ${file.filename}`);

    } catch (err) {
      this.stats.filesFailed++;
      this.logger.error(`Processing failed: ${err.message}`);
      
      if (err.details) {
        this.logger.debug('Error details', err.details);
      }

      // Mark file as failed
      try {
        await this.fileProcessor.markFailed(file.path, err);
        this.watcher.markProcessed(file.path);
      } catch (moveErr) {
        this.logger.error(`Failed to move file: ${moveErr.message}`);
      }

    } finally {
      this.processing = false;
    }
  }

  /**
   * Invoke action-plan for a session
   * @param {string} sessionId
   * @param {Object} file - Original file info
   * @private
   */
  async invokeActionPlan(sessionId, file) {
    this.logger.info(`Invoking action-plan for session: ${sessionId}`);
    this.stats.actionPlansStarted++;

    try {
      const result = await this.actionPlanRunner.run(sessionId, {
        verbose: this.logger.verbose
      });

      if (result.background) {
        this.logger.info(`Action-plan started in background (PID: ${result.pid})`);
        this.logger.info(`  Session: ${sessionId}`);
        this.logger.info(`  Source file: ${file.filename}`);
      } else if (result.success) {
        this.stats.actionPlansCompleted++;
        this.logger.success(`Action-plan completed for session: ${sessionId}`);
        this.logger.info(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
      } else {
        this.stats.actionPlansFailed++;
        this.logger.error(`Action-plan failed for session: ${sessionId}`);
        this.logger.error(`  Error: ${result.error || `Exit code ${result.exitCode}`}`);
        if (result.output) {
          this.logger.debug('Action-plan output', { output: result.output.slice(-500) });
        }
      }
    } catch (err) {
      this.stats.actionPlansFailed++;
      this.logger.error(`Action-plan invocation error: ${err.message}`);
    }
  }

  /**
   * Print service status
   */
  printStatus() {
    const status = this.watcher.getStatus();
    this.logger.info('─'.repeat(50));
    this.logger.info('Status:');
    this.logger.info(`  Running: ${status.running}`);
    this.logger.info(`  Watch path: ${status.watchPath}`);
    this.logger.info(`  Files detected: ${this.stats.filesDetected}`);
    this.logger.info(`  Files processed: ${this.stats.filesProcessed}`);
    this.logger.info(`  Files failed: ${this.stats.filesFailed}`);
    this.logger.info(`  Sessions created: ${this.stats.sessionsCreated}`);
    if (this.actionPlanEnabled) {
      this.logger.info(`  Action plans started: ${this.stats.actionPlansStarted}`);
      this.logger.info(`  Action plans completed: ${this.stats.actionPlansCompleted}`);
      this.logger.info(`  Action plans failed: ${this.stats.actionPlansFailed}`);
    }
    this.logger.info('─'.repeat(50));
  }

  /**
   * Stop the service
   */
  stop() {
    this.logger.info('Stopping watcher service...');
    this.watcher.stop();
    this.printStatus();
    this.logger.info('Service stopped');
  }

  /**
   * Get service stats
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startedAt ? Date.now() - this.stats.startedAt.getTime() : 0,
      watcher: this.watcher.getStatus()
    };
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = parseArguments();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    Goals Watcher Service v1.0.0                       ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const service = new GoalsWatcherService({
    watchPath: args.watch || config.watch.path,
    serverUrl: args.server || config.sessionServer.baseUrl,
    pollIntervalMs: args['poll-interval'] ? parseInt(args['poll-interval'], 10) : undefined,
    verbose: args.verbose,
    dryRun: args['dry-run'],
    moveFiles: !args['no-move'],
    actionPlanEnabled: !args['no-action-plan'],
    actionPlanBackground: args['action-plan-background']
  });

  // Handle shutdown signals
  const shutdown = () => {
    console.log('\nShutdown signal received...');
    service.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start service
  try {
    await service.start();
  } catch (err) {
    console.error(`Failed to start service: ${err.message}`);
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { GoalsWatcherService };