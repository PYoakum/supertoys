/**
 * @fileoverview Server configuration for Goals Session Server
 * @module server-config
 */

export default {
  // Server settings
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
    cors: {
      enabled: true,
      origins: ['*'],
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS']
    }
  },

  // Session management
  session: {
    ttlMs: parseInt(process.env.SESSION_TTL, 10) || 3600000,
    maxAge: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000,
    cleanupIntervalMs: 60000,
    maxSessions: parseInt(process.env.MAX_SESSIONS, 10) || 1000
  },

  // LLM configuration
  llm: {
    provider: process.env.LLM_PROVIDER || 'anthropic',
    endpoint: process.env.LLM_ENDPOINT || 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
    model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',
    timeout: parseInt(process.env.LLM_TIMEOUT, 10) || 120000,
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2
    },
    parameters: {
      evaluation: {
        temperature: 0.3,
        maxTokens: 8192
      },
      taskGeneration: {
        temperature: 0.2,
        maxTokens: 16384
      }
    }
  },

  // Tool Router settings
  toolRouter: {
    notepadDir: process.env.NOTEPAD_DIR || './notes'
  },

  // MCP Server settings
  mcp: {
    enabled: process.env.MCP_ENABLED !== 'false',
    name: 'goals-session-server',
    version: '1.0.0'
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'text'
  }
};
