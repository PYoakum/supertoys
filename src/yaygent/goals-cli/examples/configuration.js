/**
 * @fileoverview Example configuration for Goals CLI
 * 
 * Copy this file to your project and customize as needed.
 * Configuration values can be overridden via environment variables.
 */

export default {
  // Endpoint configuration
  endpoint: {
    // API endpoint URL - customize for your LLM provider
    url: process.env.GOALS_API_URL || "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2024-01-01"
    },
    timeout: 120000
  },

  // Authentication
  auth: {
    type: "header",
    token: process.env.GOALS_API_KEY || process.env.ANTHROPIC_API_KEY,
    headerName: "x-api-key"
  },

  // Model settings
  model: {
    name: process.env.GOALS_MODEL || "claude-sonnet-4-20250514",
    parameters: {
      temperature: 0.7,
      maxTokens: 4096
    }
  },

  // Prompt settings
  prompt: {
    systemTemplate: null,
    includeMetadata: true,
    contextFormat: "xml"
  },

  // Output settings
  output: {
    defaultFormat: "json",
    prettyPrint: true
  },

  // Retry settings
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2
  }
};
