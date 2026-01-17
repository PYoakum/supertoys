/**
 * @fileoverview LLM Client for generic LLM endpoint communication
 * @module llm-client
 */

import { LLMError, LLMUnavailableError, RateLimitedError } from './errors.js';

/**
 * @typedef {Object} LLMClientConfig
 * @property {string} [provider='anthropic'] - Provider: 'anthropic', 'openai', or 'custom'
 * @property {string} endpoint - API endpoint URL
 * @property {string} apiKey - API authentication key
 * @property {string} [model] - Default model identifier
 * @property {string} [anthropicVersion='2023-06-01'] - Anthropic API version
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
 * Provider configurations
 */
const PROVIDERS = {
  anthropic: {
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514'
  },
  openai: {
    defaultEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o'
  },
  custom: {
    defaultEndpoint: '',
    defaultModel: ''
  }
};

/**
 * Default configuration
 */
const DEFAULTS = {
  timeout: 120000,
  parameters: {
    temperature: 0.7,
    maxTokens: 8192
  },
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2
  }
};

/**
 * LLM Client class with multi-provider support
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
    this.provider = config.provider || 'anthropic';

    /** @type {string} */
    this.endpoint = config.endpoint;

    /** @type {string} */
    this.apiKey = config.apiKey;

    /** @type {string|undefined} */
    this.model = config.model;

    /** @type {string} */
    this.anthropicVersion = config.anthropicVersion || '2023-06-01';

    /** @type {LLMParameters} */
    this.parameters = { ...DEFAULTS.parameters, ...config.parameters };

    /** @type {RetryConfig} */
    this.retry = { ...DEFAULTS.retry, ...config.retry };

    /** @type {number} */
    this.timeout = config.timeout || DEFAULTS.timeout;

    /** @type {number} */
    this.requestDelayMs = config.requestDelayMs || 0;

    /** @type {number} */
    this.lastRequestTime = 0;

    /** @type {Object} */
    this.headers = config.headers || {};

    /** @type {Object|null} */
    this.logger = null;
  }

  /**
   * Wait for rate limit delay if configured
   * @private
   */
  async _waitForRateLimit() {
    if (this.requestDelayMs > 0) {
      const elapsed = Date.now() - this.lastRequestTime;
      const remaining = this.requestDelayMs - elapsed;
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Set the logger instance
   * @param {Object} logger - LLMLogger instance
   */
  setLogger(logger) {
    this.logger = logger;
  }

  /**
   * Build request headers based on provider
   * @returns {Object}
   * @private
   */
  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      ...this.headers
    };

    switch (this.provider) {
      case 'anthropic':
        headers['x-api-key'] = this.apiKey;
        headers['anthropic-version'] = this.anthropicVersion;
        break;
      case 'openai':
        headers['Authorization'] = `Bearer ${this.apiKey}`;
        break;
      case 'custom':
      default:
        // Custom provider - try both auth methods
        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
          headers['x-api-key'] = this.apiKey;
        }
        break;
    }

    return headers;
  }

  /**
   * Build request body based on provider
   * @param {Object} options
   * @param {string} options.systemPrompt
   * @param {string} options.userPrompt
   * @param {Object} [options.parameters]
   * @returns {Object}
   * @private
   */
  buildRequestBody({ systemPrompt, userPrompt, parameters = {} }) {
    const params = { ...this.parameters, ...parameters };

    switch (this.provider) {
      case 'openai':
        return {
          model: this.model,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        };

      case 'anthropic':
      default:
        return {
          model: this.model,
          max_tokens: params.maxTokens,
          temperature: params.temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        };
    }
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
   * @param {string} [options.sessionId] - Session ID for logging
   * @param {string} [options.operation] - Operation name for logging
   * @returns {Promise<Object>}
   */
  async send({ systemPrompt, userPrompt, parameters, sessionId, operation }) {
    const headers = this.buildHeaders();
    const body = this.buildRequestBody({ systemPrompt, userPrompt, parameters });

    // Log the request if logger is available
    let requestNum = 0;
    if (this.logger && sessionId) {
      this.logger.logRequest(sessionId, operation || 'unknown', {
        systemPrompt,
        userPrompt,
        parameters
      });
      requestNum = this.logger.getRequestCount(sessionId);
    }

    let lastError;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        // Wait for rate limit delay if configured
        await this._waitForRateLimit();

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
        const parsed = this.parseResponse(responseData);

        // Log the response if logger is available
        if (this.logger && sessionId) {
          this.logger.logResponse(sessionId, operation || 'unknown', requestNum, parsed);
        }

        return parsed;

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
   * Send a streaming request to the LLM
   * @param {Object} options
   * @param {string} options.systemPrompt - System prompt
   * @param {string} options.userPrompt - User prompt
   * @param {Object} [options.parameters] - Override parameters
   * @param {string} [options.protocol='sse'] - Streaming protocol: 'sse' or 'ndjson'
   * @param {function} [options.onChunk] - Callback for each chunk
   * @returns {Promise<Object>}
   */
  async sendStream({ systemPrompt, userPrompt, parameters, protocol = 'sse', onChunk }) {
    const headers = this.buildHeaders();
    const body = this.buildRequestBody({ systemPrompt, userPrompt, parameters });
    body.stream = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read error');
        throw new LLMError(
          `LLM request failed: ${response.status} ${response.statusText}`,
          { statusCode: response.status, body: errorBody }
        );
      }

      // Read streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let usage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse based on protocol
        if (protocol === 'sse') {
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);

                // Extract content delta (Anthropic format)
                if (parsed.type === 'content_block_delta') {
                  const delta = parsed.delta?.text || '';
                  fullContent += delta;
                  if (onChunk) onChunk(delta);
                }

                // Extract usage (Anthropic format)
                if (parsed.type === 'message_delta' && parsed.usage) {
                  usage = {
                    inputTokens: parsed.usage.input_tokens,
                    outputTokens: parsed.usage.output_tokens,
                    totalTokens: (parsed.usage.input_tokens || 0) + (parsed.usage.output_tokens || 0)
                  };
                }
              } catch {
                // Skip unparseable chunks
              }
            }
          }
        } else if (protocol === 'ndjson') {
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.content) {
                fullContent += parsed.content;
                if (onChunk) onChunk(parsed.content);
              }
            } catch {
              // Skip unparseable chunks
            }
          }
        }
      }

      // Flush remaining buffer
      buffer += decoder.decode();

      return {
        content: fullContent,
        usage,
        model: this.model,
        stopReason: 'end_turn'
      };

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        throw new LLMError(`Request timeout after ${this.timeout}ms`);
      }

      if (err instanceof LLMError) {
        throw err;
      }

      throw new LLMError(`Streaming error: ${err.message}`, { originalError: err.message });
    }
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

export { PROVIDERS };
export default LLMClient;
