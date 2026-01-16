/**
 * @fileoverview Configuration for Action Plan Service
 * @module action-plan-config
 */

/**
 * LLM Tiers for per-task routing
 */
const LLM_TIERS = ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY', 'QUINARY'];

/**
 * Default provider endpoints and models
 */
const PROVIDER_DEFAULTS = {
  anthropic: {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514'
  },
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o'
  }
};

/**
 * Build LLM configuration for a specific tier
 * @param {string} tier - Tier name (PRIMARY, SECONDARY, etc.)
 * @returns {Object|null} LLM configuration or null if not configured
 */
function buildTierConfig(tier) {
  const provider = process.env[`${tier}_LLM_PROVIDER`] ||
                   (tier === 'PRIMARY' ? (process.env.LLM_PROVIDER || 'anthropic') : '');

  let apiKey = process.env[`${tier}_LLM_API_KEY`];
  if (!apiKey && tier === 'PRIMARY') {
    // Fall back to legacy keys for PRIMARY tier
    apiKey = process.env.LLM_API_KEY ||
             process.env.ANTHROPIC_API_KEY ||
             process.env.OPENAI_API_KEY;
  }

  if (!apiKey) return null;

  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.anthropic;

  return {
    provider,
    endpoint: process.env[`${tier}_LLM_ENDPOINT`] ||
              (tier === 'PRIMARY' ? process.env.LLM_ENDPOINT : '') ||
              defaults.endpoint,
    apiKey,
    model: process.env[`${tier}_LLM_MODEL`] ||
           (tier === 'PRIMARY' ? process.env.LLM_MODEL : '') ||
           defaults.model,
    anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',
    parameters: {
      temperature: 0.3,
      maxTokens: 8192
    },
    timeout: parseInt(process.env[`${tier}_LLM_TIMEOUT`], 10) || 120000
  };
}

/**
 * Build all LLM tier configurations
 * @returns {Object} Map of tier name to configuration
 */
function buildAllTierConfigs() {
  const configs = {};
  for (const tier of LLM_TIERS) {
    const config = buildTierConfig(tier);
    if (config) {
      configs[tier] = config;
    }
  }
  return configs;
}

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

  // LLM Tiers for per-task routing
  llmTiers: LLM_TIERS,
  llmTierConfigs: buildAllTierConfigs(),

  // Action LLM configuration (PRIMARY tier by default)
  actionLlm: buildTierConfig('PRIMARY') || {
    provider: 'anthropic',
    endpoint: PROVIDER_DEFAULTS.anthropic.endpoint,
    apiKey: '',
    model: PROVIDER_DEFAULTS.anthropic.model,
    anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',
    parameters: { temperature: 0.3, maxTokens: 8192 },
    timeout: 120000
  },

  // Evaluation LLM configuration
  evaluationLlm: (() => {
    const provider = process.env.EVAL_LLM_PROVIDER || process.env.LLM_PROVIDER || 'anthropic';
    // Select API key based on provider (prefer provider-specific key)
    let apiKey = process.env.EVAL_LLM_API_KEY || process.env.PRIMARY_LLM_API_KEY || process.env.LLM_API_KEY;
    if (!apiKey) {
      apiKey = provider === 'openai'
        ? (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY)
        : (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
    }
    const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.anthropic;
    return {
      provider,
      endpoint: process.env.EVAL_LLM_ENDPOINT || process.env.LLM_ENDPOINT || defaults.endpoint,
      apiKey,
      model: process.env.EVAL_LLM_MODEL || process.env.LLM_MODEL || defaults.model,
      anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',
      parameters: {
        temperature: 0.1,
        maxTokens: 4096
      },
      timeout: parseInt(process.env.EVAL_LLM_TIMEOUT, 10) || 60000
    };
  })(),

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
