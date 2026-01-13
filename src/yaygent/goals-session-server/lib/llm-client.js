/**
 * @fileoverview LLM Client for generic LLM endpoint communication
 * @module llm-client
 */

import { LLMError, LLMUnavailableError, RateLimitedError } from './errors.js';

/**
 * @typedef {Object} LLMClientConfig
 * @property {string} endpoint - API endpoint URL
 * @property {string} apiKey - API authentication key
 * @property {string} [model] - Default model identifier
 * @property {LLMParameters} [parameters] - Default generation parameters
 * @property {RetryConfig} [retry] - Retry configuration
 * @property {number} [timeout=120000] - Request timeout in milliseconds
 * @property {Object} [headers] - Additional headers
 */

/**
 * @typedef {Object} LLMParameters
 * @property {number} [temperature=0.7] - Sampling temperature
 * @property {number} [maxTokens=4096] - Maximum tokens to generate
 */

/**
 * @typedef {Object} RetryConfig
 * @property {number} [maxAttempts=3] - Maximum retry attempts
 * @property {number} [backoffMs=1000] - Initial backoff in milliseconds
 * @property {number} [backoffMultiplier=2] - Backoff multiplier
 */

/**
 * Default configuration
 */
const DEFAULTS = {
  timeout: 120000,
  parameters: {
    temperature: 0.7,
    maxTokens: 4096
  },
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2
  }
};

/**
 * LLM Client class
 */
export class LLMClient {
  /**
   * @param {LLMClientConfig} config
   */
  constructor(config) {
    if (!config.endpoint) {
      throw new Error('LLM endpoint is required');
    }
    if (!config.apiKey) {
      throw new Error('LLM API key is required');
    }

    /** @type {string} */
    this.endpoint = config.endpoint;
    
    /** @type {string} */
    this.apiKey = config.apiKey;
    
    /** @type {string|undefined} */
    this.model = config.model;
    
    /** @type {LLMParameters} */
    this.parameters = { ...DEFAULTS.parameters, ...config.parameters };
    
    /** @type {RetryConfig} */
    this.retry = { ...DEFAULTS.retry, ...config.retry };
    
    /** @type {number} */
    this.timeout = config.timeout || DEFAULTS.timeout;
    
    /** @type {Object} */
    this.headers = config.headers || {};
  }

  /**
   * Build request headers
   * @returns {Object}
   * @private
   */
  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2024-01-01',
      ...this.headers
    };
  }

  /**
   * Build request body
   * @param {Object} options
   * @param {string} options.systemPrompt
   * @param {string} options.userPrompt
   * @param {Object} [options.parameters]
   * @returns {Object}
   * @private
   */
  buildRequestBody({ systemPrompt, userPrompt, parameters = {} }) {
    const params = { ...this.parameters, ...parameters };
    
    const body = {
      model: this.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    };
    
    return body;
  }

  /**
   * Parse response from LLM
   * @param {Object} response
   * @returns {Object}
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
        content: textContent,
        usage: response.usage ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
        } : undefined,
        model: response.model,
        stopReason: response.stop_reason
      };
    }
    
    // Handle OpenAI-style response
    if (response.choices && Array.isArray(response.choices)) {
      const content = response.choices
        .map(choice => choice.message?.content || choice.text || '')
        .join('\n');
      
      return {
        content,
        usage: response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        } : undefined,
        model: response.model,
        stopReason: response.choices[0]?.finish_reason
      };
    }
    
    throw new LLMError('Unable to parse LLM response format', { response });
  }

  /**
   * Sleep for specified duration
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send a request to the LLM
   * @param {Object} options
   * @param {string} options.systemPrompt - System prompt
   * @param {string} options.userPrompt - User prompt
   * @param {Object} [options.parameters] - Override parameters
   * @returns {Promise<Object>}
   */
  async send({ systemPrompt, userPrompt, parameters }) {
    const headers = this.buildHeaders();
    const body = this.buildRequestBody({ systemPrompt, userPrompt, parameters });
    
    let lastError;
    
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Handle errors
        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unable to read error');
          
          if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            lastError = new RateLimitedError(retryAfter);
            
            if (attempt < this.retry.maxAttempts) {
              const delay = retryAfter 
                ? parseInt(retryAfter, 10) * 1000
                : this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
              await this.sleep(delay);
              continue;
            }
            throw lastError;
          }
          
          if (response.status >= 500) {
            lastError = new LLMUnavailableError(`LLM service error: ${response.status}`);
            
            if (attempt < this.retry.maxAttempts) {
              const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
              await this.sleep(delay);
              continue;
            }
            throw lastError;
          }
          
          throw new LLMError(
            `LLM request failed: ${response.status} ${response.statusText}`,
            { statusCode: response.status, body: errorBody }
          );
        }
        
        const responseData = await response.json();
        return this.parseResponse(responseData);
        
      } catch (err) {
        if (err.name === 'AbortError') {
          lastError = new LLMError(`Request timeout after ${this.timeout}ms`);
          
          if (attempt < this.retry.maxAttempts) {
            const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }
        
        if (err instanceof LLMError || err instanceof LLMUnavailableError || err instanceof RateLimitedError) {
          throw err;
        }
        
        // Connection errors
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          lastError = new LLMUnavailableError(`Cannot connect to LLM: ${err.message}`);
          
          if (attempt < this.retry.maxAttempts) {
            const delay = this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
            await this.sleep(delay);
            continue;
          }
          throw lastError;
        }
        
        throw new LLMError(`Unexpected error: ${err.message}`, { originalError: err.message });
      }
    }
    
    throw lastError || new LLMError('Request failed after all retry attempts');
  }

  /**
   * Test connectivity
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      await fetch(this.endpoint, {
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  }
}

export default LLMClient;
