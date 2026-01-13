/**
 * @fileoverview Configuration for Output Evaluation Service
 * @module output-eval-config
 */

export default {
  // Evaluation LLM configuration
  evaluationLlm: {
    endpoint: process.env.EVAL_LLM_ENDPOINT || process.env.LLM_ENDPOINT || 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.EVAL_LLM_API_KEY || process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
    model: process.env.EVAL_LLM_MODEL || process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    parameters: {
      temperature: 0.2,
      maxTokens: 8192
    },
    timeout: 180000
  },

  // Input configuration
  input: {
    bundlePath: null,
    validateIntegrity: true,
    requiredFiles: [
      'manifest.json',
      'session/session.json',
      'session/goals.json',
      'session/tasks.json',
      'execution/execution-log.json'
    ]
  },

  // Output configuration
  output: {
    baseDir: process.env.OUTPUT_DIR || './evaluation-output',
    formats: ['markdown', 'json'],
    generateLearningsDoc: true,
    generateRecommendationDocs: true
  },

  // Scoring configuration
  scoring: {
    weights: {
      taskCompletion: 0.30,
      outputQuality: 0.25,
      toolUtilization: 0.20,
      goalAlignment: 0.15,
      processEfficiency: 0.10
    },
    gradeThresholds: {
      A: 90,
      B: 80,
      C: 70,
      D: 60
    }
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'text'
  }
};
