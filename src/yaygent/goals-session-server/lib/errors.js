5/**
 * @fileoverview Custom error classes for the Goals Session Server
 * @module errors
 */

/**
 * Base error class for all server errors
 * @extends Error
 */
export class ServerError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} code - Machine-readable error code
   * @param {number} [statusCode=500] - HTTP status code
   * @param {Object} [details={}] - Additional error context
   */
  constructor(message, code, statusCode = 500, details = {}) {
    super(message);
    this.name = 'ServerError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert error to JSON response format
   * @returns {Object}
   */
  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: Object.keys(this.details).length > 0 ? this.details : undefined
      }
    };
  }
}

/**
 * Session not found error
 * @extends ServerError
 */
export class SessionNotFoundError extends ServerError {
  constructor(sessionId) {
    super(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
      404,
      { sessionId }
    );
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Session expired error
 * @extends ServerError
 */
export class SessionExpiredError extends ServerError {
  constructor(sessionId) {
    super(
      `Session has expired: ${sessionId}`,
      'SESSION_EXPIRED',
      410,
      { sessionId }
    );
    this.name = 'SessionExpiredError';
  }
}

/**
 * Session invalid state error
 * @extends ServerError
 */
export class SessionInvalidStateError extends ServerError {
  constructor(sessionId, currentState, requiredState) {
    super(
      `Session ${sessionId} is in state '${currentState}', but '${requiredState}' is required`,
      'SESSION_INVALID_STATE',
      400,
      { sessionId, currentState, requiredState }
    );
    this.name = 'SessionInvalidStateError';
  }
}

/**
 * Validation error
 * @extends ServerError
 */
export class ValidationError extends ServerError {
  constructor(message, field, details = {}) {
    super(message, 'VALIDATION_ERROR', 400, { field, ...details });
    this.name = 'ValidationError';
  }
}

/**
 * Tool not found error
 * @extends ServerError
 */
export class ToolNotFoundError extends ServerError {
  constructor(toolName) {
    super(
      `Tool not found: ${toolName}`,
      'TOOL_NOT_FOUND',
      404,
      { toolName }
    );
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Tool binding failed error
 * @extends ServerError
 */
export class ToolBindingError extends ServerError {
  constructor(unboundTasks, availableTools) {
    super(
      'One or more tasks could not be bound to available tools',
      'TOOL_BINDING_FAILED',
      422,
      { unboundTasks, availableTools }
    );
    this.name = 'ToolBindingError';
  }
}

/**
 * LLM error
 * @extends ServerError
 */
export class LLMError extends ServerError {
  constructor(message, details = {}) {
    super(message, 'LLM_ERROR', 502, details);
    this.name = 'LLMError';
  }
}

/**
 * LLM unavailable error
 * @extends ServerError
 */
export class LLMUnavailableError extends ServerError {
  constructor(message = 'LLM service is unavailable') {
    super(message, 'LLM_UNAVAILABLE', 503);
    this.name = 'LLMUnavailableError';
  }
}

/**
 * Rate limited error
 * @extends ServerError
 */
export class RateLimitedError extends ServerError {
  constructor(retryAfter) {
    super(
      'Rate limited by upstream service',
      'LLM_RATE_LIMITED',
      429,
      { retryAfter }
    );
    this.name = 'RateLimitedError';
  }
}

/**
 * Error codes enum
 * @readonly
 * @enum {string}
 */
export const ErrorCodes = {
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID_STATE: 'SESSION_INVALID_STATE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_BINDING_FAILED: 'TOOL_BINDING_FAILED',
  LLM_ERROR: 'LLM_ERROR',
  LLM_UNAVAILABLE: 'LLM_UNAVAILABLE',
  LLM_RATE_LIMITED: 'LLM_RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Create error response object
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {Object} [details] - Additional details
 * @returns {Object}
 */
export function createErrorResponse(statusCode, code, message, details) {
  return {
    success: false,
    error: {
      code,
      message,
      details: details || undefined
    }
  };
}

export default {
  ServerError,
  SessionNotFoundError,
  SessionExpiredError,
  SessionInvalidStateError,
  ValidationError,
  ToolNotFoundError,
  ToolBindingError,
  LLMError,
  LLMUnavailableError,
  RateLimitedError,
  ErrorCodes,
  createErrorResponse
};
