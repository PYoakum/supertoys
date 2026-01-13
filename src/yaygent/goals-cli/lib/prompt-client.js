/**
 * @fileoverview PromptClient class for communicating with LLM endpoints
 * @module prompt-client
 */

import { ApiError, ErrorCodes } from './errors.js';

/**
 * @typedef {Object} PromptClientConfig
 * @property {EndpointConfig} endpoint - Endpoint configuration
 * @property {AuthConfig} auth - Authentication configuration
 * @property {ModelConfig} [model] - Model configuration
 * @property {RetryConfig} [retry] - Retry configuration
 */

/**
 * @typedef {Object} EndpointConfig
 * @property {string} url - API endpoint URL
 * @property {string} [method='POST'] - HTTP method
 * @property {Object.<string, string>} [headers={}] - Additional headers
 * @property {number} [timeout=120000] - Request timeout in milliseconds
 */

/**
 * @typedef {Object} AuthConfig
 * @property {'bearer'|'header'|'query'} type - Authentication type
 * @property {string} token - API token
 * @property {string} [headerName] - Header name for 'header' auth type
 * @property {string} [paramName] - Query param name for 'query' auth type
 */

/**
 * @typedef {Object} ModelConfig
 * @property {string} name - Model identifier
 * @property {ModelParameters} [parameters] - Generation parameters
 */

/**
 * @typedef {Object} ModelParameters
 * @property {number} [temperature=0.7] - Sampling temperature
 * @property {number} [maxTokens=4096] - Maximum tokens to generate
 * @property {number} [topP] - Nucleus sampling parameter
 * @property {string[]} [stopSequences] - Stop sequences
 */

/**
 * @typedef {Object} RetryConfig
 * @property {number} [maxAttempts=3] - Maximum retry attempts
 * @property {number} [backoffMs=1000] - Initial backoff in milliseconds
 * @property {number} [backoffMultiplier=2] - Backoff multiplier
 */

/**
 * @typedef {Object} PromptPayload
 * @property {string} [systemPrompt] - System-level instructions
 * @property {string} userPrompt - The main prompt content
 * @property {Object} [parameters] - Override model parameters
 */

/**
 * @typedef {Object} PromptResponse
 * @property {boolean} success - Whether the request succeeded
 * @property {string} content - Response content
 * @property {Object} [usage] - Token usage information
 * @property {Object} [metadata] - Additional response metadata
 */

/**
 * Default configuration values
 */
const DEFAULTS = {
  endpoint: {
    method: 'POST',
    headers: {},
    timeout: 120000
  },
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2
  },
  model: {
    parameters: {
      temperature: 0.7,
      maxTokens: 4096
    }
  }
};

/**
 * PromptClient class for LLM communication
 */
export class PromptClient {
  /**
   * @param {PromptClientConfig} config
   */
  constructor(config) {
    this.validateConfig(config);
    
    /** @type {EndpointConfig} */
    this.endpoint = { ...DEFAULTS.endpoint, ...config.endpoint };
    
    /** @type {AuthConfig} */
    this.auth = config.auth;
    
    /** @type {ModelConfig} */
    this.model = {
      name: config.model?.name,
      parameters: { ...DEFAULTS.model.parameters, ...config.model?.parameters }
    };
    
    /** @type {RetryConfig} */
    this.retry = { ...DEFAULTS.retry, ...config.retry };
  }

  /**
   * Validate configuration
   * @param {PromptClientConfig} config
   * @throws {Error}
   * @private
   */
  validateConfig(config) {
    if (!config.endpoint?.url) {
      throw new Error('Configuration must include endpoint.url');
    }
    
    if (!config.auth?.type) {
      throw new Error('Configuration must include auth.type');
    }
    
    if (!config.auth?.token) {
      throw new Error('Configuration must include auth.token');
    }
    
    const validAuthTypes = ['bearer', 'header', 'query'];
    if (!validAuthTypes.includes(config.auth.type)) {
      throw new Error(`Invalid auth.type: ${config.auth.type}. Must be one of: ${validAuthTypes.join(', ')}`);
    }
    
    if (config.auth.type === 'header' && !config.auth.headerName) {
      throw new Error('auth.headerName is required when auth.type is "header"');
    }
    
    if (config.auth.type === 'query' && !config.auth.paramName) {
      throw new Error('auth.paramName is required when auth.type is "query"');
    }
  }

  /**
   * Build request headers with authentication
   * @returns {Object.<string, string>}
   * @private
   */
  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      ...this.endpoint.headers
    };
    
    switch (this.auth.type) {
      case 'bearer':
        headers['Authorization'] = `Bearer ${this.auth.token}`;
        break;
      case 'header':
        headers[this.auth.headerName] = this.auth.token;
        break;
      // Query auth is handled in URL
    }
    
    return headers;
  }

  /**
   * Build request URL with query auth if applicable
   * @returns {string}
   * @private
   */
  buildUrl() {
    let url = this.endpoint.url;
    
    if (this.auth.type === 'query') {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${this.auth.paramName}=${encodeURIComponent(this.auth.token)}`;
    }
    
    return url;
  }

  /**
   * Build the request body for the LLM API
   * This is a generic format that can be adapted for different providers
   * @param {PromptPayload} payload
   * @returns {Object}
   * @private
   */
  buildRequestBody(payload) {
    const params = { ...this.model.parameters, ...payload.parameters };
    
    // Generic format - can be overridden for specific providers
  
      const body = {
        model: this.model.name,
        max_tokens: params.maxTokens,
        temperature: params.temperature
      };
    
    
    // Build messages array (works for most chat-based APIs)
    const messages = [];
    
    if (payload.systemPrompt) {
      body.system = payload.systemPrompt
      /*
      messages.push({
        role: 'system',
        content: payload.systemPrompt
      });
      */
    }
    
    messages.push({
      role: 'user',
      content: payload.userPrompt
    });
    
    body.messages = messages;
    
    // Add optional parameters if provided
    if (params.topP !== undefined) {
      body.top_p = params.topP;
    }
    
    if (params.stopSequences?.length > 0) {
      body.stop_sequences = params.stopSequences;
    }
    
    return body;
  }

  /**
   * Parse the response from the LLM API
   * This handles various response formats
   * @param {Object} response - Raw API response
   * @returns {PromptResponse}
   * @private
   */
  parseResponse(response) {
    // Handle Anthropic-style response
    if (response.content && Array.isArray(response.content)) {
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      
      return {
        success: true,
        content: textContent,
        usage: response.usage ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
        } : undefined,
        metadata: {
          model: response.model,
          stopReason: response.stop_reason
        }
      };
    }
    
    // Handle OpenAI-style response
    if (response.choices && Array.isArray(response.choices)) {
      const content = response.choices
        .map(choice => choice.message?.content || choice.text || '')
        .join('\n');
      
      return {
        success: true,
        content,
        usage: response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        } : undefined,
        metadata: {
          model: response.model,
          finishReason: response.choices[0]?.finish_reason
        }
      };
    }
    
    // Handle generic text response
    if (typeof response === 'string') {
      return {
        success: true,
        content: response,
        usage: undefined,
        metadata: {}
      };
    }
    
    // Handle direct content field
    if (response.content && typeof response.content === 'string') {
      return {
        success: true,
        content: response.content,
        usage: response.usage,
        metadata: response
      };
    }
    
    throw new Error('Unable to parse API response format');
  }

  /**
   * Sleep for a specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send a prompt request to the configured endpoint
   * @param {PromptPayload} payload
   * @returns {Promise<PromptResponse>}
   * @throws {ApiError}
   */
  async execute(payload) {
    if (!payload.userPrompt) {
      throw new Error('payload.userPrompt is required');
    }
    
    const url = this.buildUrl();
    const headers = this.buildHeaders();
    const body = this.buildRequestBody(payload);
    
    let lastError;
    
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.endpoint.timeout);
        
        const response = await fetch(url, {
          method: this.endpoint.method,
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Handle non-OK responses
        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unable to read error body');
          
          // Check for retryable errors
          if (response.status === 429) {
            lastError = new ApiError(
              `Rate limited by API (attempt ${attempt}/${this.retry.maxAttempts})`,
              response.status,
              errorBody,
              { code: ErrorCodes.API_RATE_LIMITED }
            );
            
            if (attempt < this.retry.maxAttempts) {
              const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
              await this.sleep(delay);
              continue;
            }
            throw lastError;
          }
          
          if (response.status >= 500) {
            lastError = new ApiError(
              `Server error: ${response.status} (attempt ${attempt}/${this.retry.maxAttempts})`,
              response.status,
              errorBody,
              { code: ErrorCodes.API_SERVER_ERROR }
            );
            
            if (attempt < this.retry.maxAttempts) {
              const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
              await this.sleep(delay);
              continue;
            }
            throw lastError;
          }
          
          // Non-retryable error
          throw new ApiError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status,
            errorBody
          );
        }
        
        // Parse successful response
        const responseData = await response.json();
        return this.parseResponse(responseData);
        
      } catch (err) {
        // Handle abort (timeout)
        if (err.name === 'AbortError') {
          lastError = new ApiError(
            `Request timeout after ${this.endpoint.timeout}ms (attempt ${attempt}/${this.retry.maxAttempts})`,
            null,
            null,
            { code: ErrorCodes.API_TIMEOUT }
          );
          
          if (attempt < this.retry.maxAttempts) {
            const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }
        
        // Handle connection errors
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.cause?.code === 'ECONNREFUSED') {
          lastError = new ApiError(
            `Connection failed: ${err.message} (attempt ${attempt}/${this.retry.maxAttempts})`,
            null,
            null,
            { code: ErrorCodes.API_CONNECTION_FAILED }
          );
          
          if (attempt < this.retry.maxAttempts) {
            const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }
        
        // Re-throw ApiErrors as-is
        if (err instanceof ApiError) {
          throw err;
        }
        
        // Wrap other errors
        throw new ApiError(
          `Unexpected error: ${err.message}`,
          null,
          null,
          { originalError: err.message }
        );
      }
    }
    
    // Should not reach here, but just in case
    throw lastError || new ApiError('Request failed after all retry attempts');
  }

  /**
   * Test connectivity to the endpoint
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      // Most LLM APIs don't have a dedicated health endpoint,
      // so we'll just verify the URL is reachable
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(this.endpoint.url, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Even a 4xx response means the server is reachable
      return true;
    } catch (err) {
      return false;
    }
  }
}

export default PromptClient;
