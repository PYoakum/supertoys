/**
 * @fileoverview Configuration for Action Plan Service
 * @module action-plan-config
 */

export default {
  // Session Server connection
  sessionServer: {
    baseUrl: process.env.SESSION_SERVER_URL || 'http://localhost:3000',
    timeout: parseInt(process.env.SESSION_TIMEOUT, 10) || 30000,
    retry: {
      maxAttempts: 3,
      baseDelayMs: 1000,
      backoffMultiplier: 2
    }
  },

  // Action LLM configuration
  actionLlm: {
    endpoint: process.env.ACTION_LLM_ENDPOINT || process.env.LLM_ENDPOINT || 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ACTION_LLM_API_KEY || process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
    model: process.env.ACTION_LLM_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    parameters: {
      temperature: 0.3,
      maxTokens: 8192
    },
    timeout: parseInt(process.env.ACTION_LLM_TIMEOUT, 10) || 120000
  },

  // Evaluation LLM configuration
  evaluationLlm: {
    endpoint: process.env.EVAL_LLM_ENDPOINT || process.env.LLM_ENDPOINT || 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.EVAL_LLM_API_KEY || process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
    model: process.env.EVAL_LLM_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    parameters: {
      temperature: 0.1,
      maxTokens: 4096
    },
    timeout: parseInt(process.env.EVAL_LLM_TIMEOUT, 10) || 60000
  },

  // Output configuration
  output: {
    baseDir: process.env.OUTPUT_DIR || './output',
    createBundleOnComplete: true,
    preserveIntermediateFiles: true
  },

  // Queue behavior
  queue: {
    pollIntervalMs: 1000,
    taskTimeoutMs: parseInt(process.env.TASK_TIMEOUT, 10) || 300000, // 5 minutes
    maxConsecutiveFailures: 1,
    continueOnEvaluationFailure: false
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'text',
    includeTimestamps: true
  },

  // Output Evaluation integration
  outputEval: {
    enabled: process.env.OUTPUT_EVAL_ENABLED !== 'false',
    // Path to output-eval executable (relative to this config or absolute)
    executablePath: process.env.OUTPUT_EVAL_PATH || '../output-eval/output-eval.js',
    // Output directory for evaluation reports
    outputDir: process.env.OUTPUT_EVAL_OUTPUT || './evaluation-output',
    // Whether to run output-eval in the background or wait for completion
    runInBackground: process.env.OUTPUT_EVAL_BACKGROUND === 'true',
    // Additional CLI arguments to pass to output-eval
    additionalArgs: process.env.OUTPUT_EVAL_ARGS ? process.env.OUTPUT_EVAL_ARGS.split(' ') : [],
    // Timeout for output-eval execution (only applies when not running in background)
    timeoutMs: parseInt(process.env.OUTPUT_EVAL_TIMEOUT, 10) || 180000  // 3 minutes
  }
};
