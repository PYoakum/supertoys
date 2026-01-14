/**
 * @fileoverview Session Server Client for triggering session creation
 * @module session-client
 */

import { SessionServerError } from './errors.js';

/**
 * @typedef {Object} SessionClientConfig
 * @property {string} baseUrl - Session server base URL
 * @property {number} [timeout=30000] - Request timeout
 * @property {RetryConfig} [retry] - Retry configuration
 */

/**
 * @typedef {Object} RetryConfig
 * @property {number} [maxAttempts=3]
 * @property {number} [baseDelayMs=1000]
 * @property {number} [backoffMultiplier=2]
 */

const DEFAULT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2
};

/**
 * Session Server Client
 */
export class SessionClient {
  /**
   * @param {SessionClientConfig} config
   */
  constructor(config) {
    if (!config.baseUrl) {
      throw new Error('baseUrl is required');
    }
    
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 30000;
    this.retry = { ...DEFAULT_RETRY, ...config.retry };
  }

  /**
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make HTTP request with retry
   * @param {string} method
   * @param {string} path
   * @param {Object} [body]
   * @returns {Promise<Object>}
   * @private
   */
  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    let lastError;

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const options = {
          method,
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        };

        if (body) {
          options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        clearTimeout(timeoutId);

        const data = await response.json();

        if (!response.ok) {
          throw new SessionServerError(
            data.error?.message || `HTTP ${response.status}`,
            path,
            response.status,
            data.error?.details
          );
        }

        return data;

      } catch (err) {
        if (err.name === 'AbortError') {
          lastError = new SessionServerError(`Request timeout after ${this.timeout}ms`, path, 0);
        } else if (err instanceof SessionServerError) {
          lastError = err;
          // Don't retry client errors (4xx)
          if (err.details?.statusCode >= 400 && err.details?.statusCode < 500) {
            throw err;
          }
        } else {
          lastError = new SessionServerError(err.message, path, 0);
        }

        if (attempt < this.retry.maxAttempts) {
          const delay = this.retry.baseDelayMs * Math.pow(this.retry.backoffMultiplier, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Health check
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await this.request('GET', '/health');
      return response.status === 'healthy';
    } catch {
      return false;
    }
  }

  /**
   * Create a new session with goals and context
   * @param {Object} payload - { goals, context }
   * @returns {Promise<Object>}
   */
  async createSession(payload) {
    const response = await this.request('POST', '/api/sessions', payload);
    return response.data;
  }

  /**
   * Evaluate goals (resolve dependencies, determine order)
   * @param {string} sessionId
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async evaluateGoals(sessionId, options = {}) {
    const response = await this.request('POST', '/api/evaluate', {
      sessionId,
      options
    });
    return response.data;
  }

  /**
   * Generate task list with tool bindings
   * @param {string} sessionId
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async generateTaskList(sessionId, options = {}) {
    const response = await this.request('POST', '/api/tasklist/generate', {
      sessionId,
      options
    });
    return response.data;
  }

  /**
   * Get session details
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async getSession(sessionId) {
    const response = await this.request('GET', `/api/sessions/${sessionId}`);
    return response.data;
  }

  /**
   * Full pipeline: Create session, evaluate, and generate tasks
   * @param {Object} payload - { goals, context }
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async createAndProcess(payload, options = {}) {
    // Step 1: Create session
    const session = await this.createSession(payload);
    const sessionId = session.sessionId;

    // Step 2: Evaluate goals
    const evaluation = await this.evaluateGoals(sessionId, options.evaluation || {});

    // Step 3: Generate task list
    const taskList = await this.generateTaskList(sessionId, options.taskGeneration || {});

    // Return complete result
    return {
      sessionId,
      session,
      evaluation,
      taskList,
      state: 'GENERATED'
    };
  }
}

export default SessionClient;