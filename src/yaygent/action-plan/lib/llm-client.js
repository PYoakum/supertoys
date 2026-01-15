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
 * LLM Client class
 */
export class LLMClient {
  constructor(config) {
    if (!config.endpoint) throw new Error('endpoint is required');
    if (!config.apiKey) throw new Error('apiKey is required');

    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.parameters = config.parameters || { temperature: 0.2, maxTokens: 8192 };
    this.timeout = config.timeout || 180000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01'
    };
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
    const params = { ...this.parameters, ...parameters };
    
    const body = {
      model: this.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    };

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
          lastError = err;
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

export default LLMClient;
