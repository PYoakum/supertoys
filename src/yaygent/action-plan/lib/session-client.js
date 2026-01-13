/**
 * @fileoverview Session client for communicating with Goals Session Server
 * @module session-client
 */

import { 
  SessionNotFoundError, 
  SessionInvalidStateError, 
  ConnectionError 
} from './errors.js';

/**
 * @typedef {Object} SessionClientConfig
 * @property {string} baseUrl - Base URL of the session server
 * @property {number} [timeout=30000] - Request timeout in ms
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
 * Client for Goals Session Server REST API
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
   * Sleep for specified duration
   * @param {number} ms
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make an HTTP request with retry logic
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
          // Handle specific error codes
          if (response.status === 404 && data.error?.code === 'SESSION_NOT_FOUND') {
            throw new SessionNotFoundError(data.error.details?.sessionId || 'unknown');
          }
          if (data.error?.code === 'SESSION_INVALID_STATE') {
            throw new SessionInvalidStateError(
              data.error.details?.sessionId,
              data.error.details?.currentState,
              data.error.details?.requiredState
            );
          }
          throw new Error(data.error?.message || `HTTP ${response.status}`);
        }

        return data;

      } catch (err) {
        lastError = err;

        if (err.name === 'AbortError') {
          lastError = new ConnectionError(`Request timeout after ${this.timeout}ms`, url);
        } else if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
          lastError = new ConnectionError(`Cannot connect to session server: ${err.message}`, url);
        }

        // Don't retry on specific errors
        if (err instanceof SessionNotFoundError || err instanceof SessionInvalidStateError) {
          throw err;
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
   * Get a session by ID
   * @param {string} sessionId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async getSession(sessionId, options = {}) {
    const params = new URLSearchParams();
    if (options.includeContext) params.set('includeContext', 'true');
    if (options.includeTaskList !== false) params.set('includeTaskList', 'true');
    
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request('GET', `/api/sessions/${sessionId}${query}`);
    return response.data;
  }

  /**
   * Get the task list for a session
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async getTaskList(sessionId) {
    const session = await this.getSession(sessionId, { includeTaskList: true });
    return session.taskList;
  }

  /**
   * Get the goals for a session
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async getGoals(sessionId) {
    const session = await this.getSession(sessionId);
    return session.goals;
  }

  /**
   * Get the context for a session
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async getContext(sessionId) {
    const session = await this.getSession(sessionId, { includeContext: true });
    return session.context;
  }

  /**
   * Update a task's status
   * @param {string} sessionId
   * @param {string} taskId
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async updateTask(sessionId, taskId, updates) {
    // Use the MCP-style endpoint via REST
    // The session server should expose this, but we'll use a workaround
    // by getting the session and using the session_update_task equivalent
    const response = await this.request('POST', `/api/sessions/${sessionId}/tasks/${taskId}`, updates);
    return response.data;
  }

  /**
   * Update a goal's status
   * @param {string} sessionId
   * @param {string} goalId
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async updateGoal(sessionId, goalId, updates) {
    const response = await this.request('POST', `/api/sessions/${sessionId}/goals/${goalId}`, updates);
    return response.data;
  }

  /**
   * Get the tool manifest
   * @returns {Promise<Object>}
   */
  async getToolManifest() {
    const response = await this.request('GET', '/api/tools');
    return response.data;
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
}

export default SessionClient;
