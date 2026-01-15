/**
 * @fileoverview LLM Client for evaluation analysis
 * @module llm-client
 */

import { LLMError } from './errors.js';

const DEFAULT_RETRY = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2
};

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
 * LLM Client class with multi-provider support
 */
export class LLMClient {
  /**
   * @param {Object} config
   * @param {string} [config.provider='anthropic'] - Provider: 'anthropic', 'openai', or 'custom'
   * @param {string} config.endpoint - API endpoint URL
   * @param {string} config.apiKey - API key
   * @param {string} config.model - Model identifier
   * @param {string} [config.anthropicVersion='2023-06-01'] - Anthropic API version
   * @param {Object} [config.parameters] - Generation parameters
   * @param {number} [config.timeout] - Request timeout in ms
   * @param {Object} [config.retry] - Retry configuration
   */
  constructor(config) {
    if (!config.endpoint) throw new Error('endpoint is required');
    if (!config.apiKey) throw new Error('apiKey is required');

    this.provider = config.provider || 'anthropic';
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.anthropicVersion = config.anthropicVersion || '2023-06-01';
    this.parameters = config.parameters || { temperature: 0.2, maxTokens: 8192 };
    this.timeout = config.timeout || 180000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build headers based on provider
   * @returns {Object}
   */
  buildHeaders() {
    const headers = {
      'Content-Type': 'application/json'
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
        // Custom provider - try both auth methods, prefer Bearer
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

  parseResponse(response) {
    if (response.content && Array.isArray(response.content)) {
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      return {
        content: textContent,
        usage: response.usage ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
        } : undefined,
        model: response.model
      };
    }

    if (response.choices && Array.isArray(response.choices)) {
      const content = response.choices.map(c => c.message?.content || c.text || '').join('\n');
      return {
        content,
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        } : undefined,
        model: response.model
      };
    }

    throw new LLMError('Unable to parse LLM response format');
  }

  async send({ systemPrompt, userPrompt, parameters = {} }) {
    const body = this.buildRequestBody({ systemPrompt, userPrompt, parameters });

    let lastError;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          let errorMessage = `Request failed: ${response.status}`;

          // Try to parse error details
          try {
            const errorJson = JSON.parse(errorBody);
            if (errorJson.error?.message) {
              errorMessage = `${response.status}: ${errorJson.error.message}`;
            }
          } catch {
            // Use raw error body if not JSON
            if (errorBody) {
              errorMessage = `${response.status}: ${errorBody.slice(0, 200)}`;
            }
          }

          if (response.status === 429 || response.status >= 500) {
            lastError = new LLMError(errorMessage);
            if (attempt < this.retry.maxAttempts) {
              await this.sleep(this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1));
              continue;
            }
          }

          throw new LLMError(errorMessage, { body: errorBody, status: response.status });
        }

        const data = await response.json();
        return this.parseResponse(data);

      } catch (err) {
        if (err.name === 'AbortError') {
          lastError = new LLMError(`Request timeout after ${this.timeout}ms`);
        } else if (err instanceof LLMError) {
          // Don't retry client errors (4xx except 429) - they won't succeed
          throw err;
        } else {
          lastError = new LLMError(`Unexpected error: ${err.message}`);
        }

        if (attempt < this.retry.maxAttempts) {
          await this.sleep(this.retry.backoffMs * Math.pow(this.retry.backoffMultiplier, attempt - 1));
          continue;
        }
      }
    }

    throw lastError || new LLMError('Request failed after all retry attempts');
  }

  async healthCheck() {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      await fetch(this.endpoint, { method: 'HEAD', signal: controller.signal });
      return true;
    } catch {
      return false;
    }
  }
}

export { PROVIDERS };
export default LLMClient;
