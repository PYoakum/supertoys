/**
 * @fileoverview Configuration for Goals Watcher Service
 * @module goal-keeper-config
 */

export default {
  // Directory to watch for goals files
  watch: {
    path: process.env.WATCH_PATH || './watch',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL, 10) || 2000,
    // Supports both JSON and TOON markdown files
    filePattern: process.env.FILE_PATTERN || '*.{json,md}',
    recursive: process.env.WATCH_RECURSIVE === 'true',
    stabilityThresholdMs: parseInt(process.env.STABILITY_THRESHOLD, 10) || 3000,
    ignorePatterns: ['_processed', '_failed', '.DS_Store', 'node_modules']
  },

  // Session server connection
  sessionServer: {
    baseUrl: process.env.SESSION_SERVER_URL || 'http://localhost:3000',
    timeout: parseInt(process.env.SESSION_TIMEOUT, 10) || 60000,
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      backoffMultiplier: 2
    }
  },

  // File processing options
  processing: {
    moveProcessed: process.env.MOVE_PROCESSED !== 'false',
    processedDir: process.env.PROCESSED_DIR || '_processed',
    failedDir: process.env.FAILED_DIR || '_failed',
    includeContext: process.env.INCLUDE_CONTEXT !== 'false',
    contextDirName: process.env.CONTEXT_DIR_NAME || 'context'
  },

  // LLM options for session server
  llm: {
    evaluationOptions: {
      model: process.env.LLM_MODEL,
      temperature: parseFloat(process.env.LLM_TEMPERATURE) || undefined,
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS, 10) || 8192
    },
    taskGenerationOptions: {
      model: process.env.LLM_MODEL,
      strictToolBinding: true,
      maxTokens: parseInt(process.env.LLM_MAX_TOKENS, 10) || 8192
    }
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'text',
    includeTimestamps: true
  },

  // Service behavior
  service: {
    exitOnError: process.env.EXIT_ON_ERROR === 'true',
    maxConcurrentProcessing: 1,  // Sequential processing only
    healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 30000
  },

  // Action Plan integration
  actionPlan: {
    enabled: process.env.ACTION_PLAN_ENABLED !== 'false',
    // Path to action-plan executable (relative to this config or absolute)
    executablePath: process.env.ACTION_PLAN_PATH || '../action-plan/action-plan.js',
    // Output directory for action-plan results
    outputDir: process.env.ACTION_PLAN_OUTPUT || './output',
    // Whether to run action-plan in the background or wait for completion
    runInBackground: process.env.ACTION_PLAN_BACKGROUND === 'true',
    // Additional CLI arguments to pass to action-plan
    additionalArgs: process.env.ACTION_PLAN_ARGS ? process.env.ACTION_PLAN_ARGS.split(' ') : [],
    // Timeout for action-plan execution (only applies when not running in background)
    timeoutMs: parseInt(process.env.ACTION_PLAN_TIMEOUT, 10) || 300000  // 5 minutes
  }
};