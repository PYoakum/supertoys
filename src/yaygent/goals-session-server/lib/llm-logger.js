/**
 * @fileoverview LLM Response Logger - Captures raw LLM responses for debugging
 * @module llm-logger
 */

import { mkdirSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

/**
 * LLM Logger class - logs all LLM interactions to session-specific directories
 */
export class LLMLogger {
  /**
   * @param {Object} config
   * @param {string} config.baseDir - Base directory for logs
   * @param {boolean} [config.enabled=true] - Whether logging is enabled
   * @param {boolean} [config.logPrompts=true] - Whether to log prompts
   * @param {boolean} [config.logResponses=true] - Whether to log responses
   */
  constructor(config = {}) {
    this.baseDir = config.baseDir || './llm-logs';
    this.enabled = config.enabled !== false;
    this.logPrompts = config.logPrompts !== false;
    this.logResponses = config.logResponses !== false;

    // Ensure base directory exists
    if (this.enabled) {
      try {
        mkdirSync(this.baseDir, { recursive: true });
      } catch (err) {
        console.error(`[LLMLogger] Failed to create base directory: ${err.message}`);
        this.enabled = false;
      }
    }

    // Track request counter per session
    this.requestCounters = new Map();
  }

  /**
   * Get or create session directory
   * @param {string} sessionId
   * @returns {string} - Path to session directory
   * @private
   */
  getSessionDir(sessionId) {
    const sessionDir = join(this.baseDir, sessionId || 'unknown-session');
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      // Directory might already exist
    }
    return sessionDir;
  }

  /**
   * Get next request number for session
   * @param {string} sessionId
   * @returns {number}
   * @private
   */
  getNextRequestNumber(sessionId) {
    const current = this.requestCounters.get(sessionId) || 0;
    const next = current + 1;
    this.requestCounters.set(sessionId, next);
    return next;
  }

  /**
   * Log an LLM request (prompt)
   * @param {string} sessionId - Session ID
   * @param {string} operation - Operation name (e.g., 'evaluation', 'taskGeneration')
   * @param {Object} request - Request data
   * @returns {string} - Request ID for correlating with response
   */
  logRequest(sessionId, operation, request) {
    if (!this.enabled || !this.logPrompts) return null;

    const requestNum = this.getNextRequestNumber(sessionId);
    const timestamp = new Date().toISOString();
    const requestId = `${operation}-${requestNum}`;
    const sessionDir = this.getSessionDir(sessionId);

    const logEntry = {
      requestId,
      timestamp,
      operation,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      parameters: request.parameters
    };

    const filename = `${requestNum.toString().padStart(3, '0')}-${operation}-request.json`;
    const filepath = join(sessionDir, filename);

    try {
      writeFileSync(filepath, JSON.stringify(logEntry, null, 2));
      // Verbose file logging disabled - use debug mode if needed
    } catch (err) {
      console.error(`[LLMLogger] Failed to log request: ${err.message}`);
    }

    return requestId;
  }

  /**
   * Log an LLM response (raw content)
   * @param {string} sessionId - Session ID
   * @param {string} operation - Operation name
   * @param {number} requestNum - Request number to correlate with
   * @param {Object} response - Response data
   * @param {string} response.content - Raw response content
   * @param {Object} [response.usage] - Token usage
   * @param {string} [response.model] - Model used
   */
  logResponse(sessionId, operation, requestNum, response) {
    if (!this.enabled || !this.logResponses) return;

    const timestamp = new Date().toISOString();
    const sessionDir = this.getSessionDir(sessionId);

    // Log the raw content separately for easy inspection
    const rawFilename = `${requestNum.toString().padStart(3, '0')}-${operation}-response-raw.txt`;
    const rawFilepath = join(sessionDir, rawFilename);

    try {
      writeFileSync(rawFilepath, response.content || '');
      // Verbose file logging disabled - use debug mode if needed
    } catch (err) {
      console.error(`[LLMLogger] Failed to log raw response: ${err.message}`);
    }

    // Log metadata as JSON
    const metaEntry = {
      timestamp,
      operation,
      requestNum,
      contentLength: (response.content || '').length,
      usage: response.usage,
      model: response.model,
      stopReason: response.stopReason
    };

    const metaFilename = `${requestNum.toString().padStart(3, '0')}-${operation}-response-meta.json`;
    const metaFilepath = join(sessionDir, metaFilename);

    try {
      writeFileSync(metaFilepath, JSON.stringify(metaEntry, null, 2));
    } catch (err) {
      console.error(`[LLMLogger] Failed to log response metadata: ${err.message}`);
    }
  }

  /**
   * Log a parsing error with the problematic content
   * @param {string} sessionId - Session ID
   * @param {string} operation - Operation name
   * @param {number} requestNum - Request number
   * @param {Error} error - The parsing error
   * @param {string} content - The content that failed to parse
   */
  logParseError(sessionId, operation, requestNum, error, content) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const sessionDir = this.getSessionDir(sessionId);

    const errorEntry = {
      timestamp,
      operation,
      requestNum,
      errorMessage: error.message,
      errorStack: error.stack,
      contentLength: (content || '').length,
      contentPreview: (content || '').slice(0, 500),
      contentEnd: (content || '').slice(-500)
    };

    const filename = `${requestNum.toString().padStart(3, '0')}-${operation}-parse-error.json`;
    const filepath = join(sessionDir, filename);

    try {
      writeFileSync(filepath, JSON.stringify(errorEntry, null, 2));
      console.log(`[LLMLogger] Logged parse error to ${filepath}`);
    } catch (err) {
      console.error(`[LLMLogger] Failed to log parse error: ${err.message}`);
    }
  }

  /**
   * Log a summary entry to the session log
   * @param {string} sessionId
   * @param {string} message
   */
  logSummary(sessionId, message) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const sessionDir = this.getSessionDir(sessionId);
    const summaryPath = join(sessionDir, 'session-log.txt');

    try {
      appendFileSync(summaryPath, `[${timestamp}] ${message}\n`);
    } catch (err) {
      console.error(`[LLMLogger] Failed to log summary: ${err.message}`);
    }
  }

  /**
   * Get current request count for session
   * @param {string} sessionId
   * @returns {number}
   */
  getRequestCount(sessionId) {
    return this.requestCounters.get(sessionId) || 0;
  }
}

export default LLMLogger;
