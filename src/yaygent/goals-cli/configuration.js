/**
 * @fileoverview Default configuration for Goals CLI
 * @module configuration
 */

/**
 * Default configuration object
 * 
 * This configuration supports generic LLM endpoints.
 * Override values via environment variables or a custom config file.
 */
export default {
  // Endpoint configuration (required)
  endpoint: {
    // API endpoint URL - can be Anthropic, OpenAI, or any compatible API
    url: process.env.GOALS_API_URL || "https://api.anthropic.com/v1/messages",
    
    // HTTP method for the API
    method: "POST",
    
    // Additional headers to include
    headers: {
      "Content-Type": "application/json",
      // For Anthropic API, include version header
      "anthropic-version": "2023-06-01"
    },
    
    // Request timeout in milliseconds
    timeout: parseInt(process.env.GOALS_TIMEOUT, 10) || 120000
  },

  // Authentication configuration (required)
  auth: {
    // Authentication type: "bearer", "header", or "query"
    type: "header",
    
    // API token - read from environment
    token: process.env.GOALS_API_KEY || process.env.ANTHROPIC_API_KEY,
    
    // Header name for 'header' auth type (Anthropic uses x-api-key)
    headerName: "x-api-key",
    
    // Query param name for 'query' auth type (if needed)
    paramName: "api_key"
  },

  // Model configuration (optional)
  model: {
    // Model identifier - varies by provider
    name: process.env.GOALS_MODEL || "claude-sonnet-4-20250514",
    
    // Generation parameters
    parameters: {
      // Sampling temperature (0-1, lower = more deterministic)
      temperature: parseFloat(process.env.GOALS_TEMPERATURE) || 0.7,
      
      // Maximum tokens to generate
      maxTokens: parseInt(process.env.GOALS_MAX_TOKENS, 10) || 4096,
      
      // Nucleus sampling parameter (optional)
      // topP: 0.9,
      
      // Stop sequences (optional)
      // stopSequences: []
    }
  },

  // Prompt construction configuration (optional)
  prompt: {
    // Path to custom system prompt template (null for default)
    systemTemplate: null,
    
    // Include metadata in prompts
    includeMetadata: true,
    
    // Context formatting: "xml", "markdown", or "json"
    contextFormat: "xml"
  },

  // Output configuration (optional)
  output: {
    // Default output format: "json", "markdown", "text", or "toon"
    defaultFormat: "toon",

    // Pretty-print JSON output
    prettyPrint: true
  },

  // Retry configuration (optional)
  retry: {
    // Maximum retry attempts
    maxAttempts: 3,
    
    // Initial backoff delay in milliseconds
    backoffMs: 1000,
    
    // Backoff multiplier for exponential backoff
    backoffMultiplier: 2
  }
};

/**
 * Load and merge configuration from a file
 * @param {string} configPath - Path to configuration file
 * @returns {Promise<Object>}
 */
export async function loadConfig(configPath) {
  try {
    const customConfig = await import(configPath);
    const defaultConfig = (await import('./configuration.js')).default;
    
    // Deep merge configurations
    return deepMerge(defaultConfig, customConfig.default || customConfig);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    throw new Error(`Error loading configuration: ${err.message}`);
  }
}

/**
 * Deep merge two objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
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
 * Validate configuration object
 * @param {Object} config - Configuration to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateConfig(config) {
  const errors = [];
  
  // Check endpoint
  if (!config.endpoint?.url) {
    errors.push('Missing required configuration: endpoint.url');
  }
  
  // Check auth
  if (!config.auth?.type) {
    errors.push('Missing required configuration: auth.type');
  } else {
    const validAuthTypes = ['bearer', 'header', 'query'];
    if (!validAuthTypes.includes(config.auth.type)) {
      errors.push(`Invalid auth.type: ${config.auth.type}. Must be one of: ${validAuthTypes.join(', ')}`);
    }
  }
  
  if (!config.auth?.token) {
    errors.push('Missing required configuration: auth.token (set GOALS_API_KEY or ANTHROPIC_API_KEY environment variable)');
  }
  
  // Check auth type specific requirements
  if (config.auth?.type === 'header' && !config.auth?.headerName) {
    errors.push('Missing required configuration: auth.headerName (required when auth.type is "header")');
  }
  
  if (config.auth?.type === 'query' && !config.auth?.paramName) {
    errors.push('Missing required configuration: auth.paramName (required when auth.type is "query")');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}
