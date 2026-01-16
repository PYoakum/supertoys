/**
 * @fileoverview Session Server REST API Client
 * @module tui/services/session-server-client
 */

/**
 * Client for goals-session-server REST API
 */
export class SessionServerClient {
  /**
   * @param {Object} options
   * @param {string} [options.baseUrl='http://localhost:3000'] - Server base URL
   * @param {number} [options.timeout=30000] - Request timeout in ms
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:3000';
    this.timeout = options.timeout || 30000;
    this.connected = false;
    this.lastError = null;
  }

  /**
   * Make HTTP request to server
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {Object} [body] - Request body
   * @returns {Promise<Object>}
   * @private
   */
  async _request(method, path, body = null) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${this.baseUrl}${path}`, options);
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`HTTP ${response.status}: ${error}`);
      }

      const data = await response.json();
      this.connected = true;
      this.lastError = null;
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      this.lastError = err.message;
      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw err;
    }
  }

  /**
   * Check server health
   * @returns {Promise<{status: string, uptime: number}>}
   */
  async healthCheck() {
    try {
      const result = await this._request('GET', '/health');
      this.connected = true;
      return result;
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  /**
   * Create a new session
   * @param {Object} goals - Goals data
   * @param {Object} [context] - Context data
   * @returns {Promise<{sessionId: string}>}
   */
  async createSession(goals, context = null) {
    return this._request('POST', '/api/sessions', { goals, context });
  }

  /**
   * List all sessions
   * @returns {Promise<Array<{id: string, status: string, createdAt: string}>>}
   */
  async listSessions() {
    return this._request('GET', '/api/sessions');
  }

  /**
   * List sessions in ready state
   * @returns {Promise<Array<{id: string, status: string, createdAt: string}>>}
   */
  async listReadySessions() {
    const sessions = await this.listSessions();
    return sessions.filter(s => s.status === 'ready');
  }

  /**
   * Get session details
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async getSession(sessionId) {
    return this._request('GET', `/api/sessions/${sessionId}`);
  }

  /**
   * Delete a session
   * @param {string} sessionId
   * @returns {Promise<{success: boolean}>}
   */
  async deleteSession(sessionId) {
    return this._request('DELETE', `/api/sessions/${sessionId}`);
  }

  /**
   * Run evaluation on session
   * @param {string} sessionId
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async evaluate(sessionId, options = {}) {
    return this._request('POST', '/api/evaluate', { sessionId, options });
  }

  /**
   * Generate task list for session
   * @param {string} sessionId
   * @param {Object} [options={}]
   * @returns {Promise<{tasks: Array}>}
   */
  async generateTaskList(sessionId, options = {}) {
    return this._request('POST', '/api/tasklist/generate', { sessionId, options });
  }

  /**
   * Update/overwrite task list for session
   * @param {string} sessionId
   * @param {Object} taskList - Task list object with tasks array
   * @returns {Promise<Object>}
   */
  async updateTaskList(sessionId, taskList) {
    return this._request('PUT', '/api/tasklist/update', { sessionId, taskList });
  }

  /**
   * Execute a tool
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @param {string} [sessionId] - Optional session ID
   * @returns {Promise<Object>}
   */
  async executeTool(toolName, params, sessionId = null) {
    const body = { tool: toolName, params };
    if (sessionId) {
      body.sessionId = sessionId;
    }
    return this._request('POST', '/api/tools/execute', body);
  }

  /**
   * Get session logs
   * @param {string} sessionId
   * @returns {Promise<Array<{level: string, message: string, timestamp: string}>>}
   */
  async getSessionLogs(sessionId) {
    return this._request('GET', `/api/sessions/${sessionId}/logs`);
  }

  /**
   * Update session context
   * @param {string} sessionId
   * @param {Object} context
   * @returns {Promise<{success: boolean}>}
   */
  async updateContext(sessionId, context) {
    return this._request('PUT', `/api/sessions/${sessionId}/context`, { context });
  }

  /**
   * Get server status
   * @returns {Promise<Object>}
   */
  async getStatus() {
    return this._request('GET', '/api/status');
  }

  /**
   * Get sandbox info for a session
   * @param {string} sessionId
   * @returns {Promise<{sessionId: string, path: string, size: number, exists: boolean}>}
   */
  async getSandboxInfo(sessionId) {
    return this._request('GET', `/api/sandbox/${sessionId}`);
  }

  /**
   * Clean up sandbox for a session (removes all files)
   * @param {string} sessionId
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async cleanupSandbox(sessionId) {
    return this._request('DELETE', `/api/sandbox/${sessionId}`);
  }

  /**
   * List all sandboxes with stats
   * @returns {Promise<Object>}
   */
  async listSandboxes() {
    return this._request('GET', '/api/sandbox');
  }

  /**
   * Get available tools manifest
   * @returns {Promise<{serverName: string, serverVersion: string, tools: Array, toolCount: number}>}
   */
  async getTools() {
    return this._request('GET', '/api/tools');
  }

  /**
   * Get a specific tool schema
   * @param {string} toolName
   * @returns {Promise<Object>}
   */
  async getTool(toolName) {
    return this._request('GET', `/api/tools/${toolName}`);
  }

  /**
   * Import tasks - bypasses state checks for importing pre-defined task lists
   * @param {string} sessionId
   * @param {Object} taskList - Task list object with tasks array
   * @returns {Promise<Object>}
   */
  async importTaskList(sessionId, taskList) {
    return this._request('POST', '/api/tasklist/import', { sessionId, taskList });
  }
}

export default SessionServerClient;
