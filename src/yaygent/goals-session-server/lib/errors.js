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
 * Path traversal error - attempted to access path outside sandbox
 * @extends ServerError
 */
export class PathTraversalError extends ServerError {
  constructor(path) {
    super(
      `Path traversal detected: ${path}`,
      'PATH_TRAVERSAL',
      403,
      { path }
    );
    this.name = 'PathTraversalError';
  }
}

/**
 * File exists error - file already exists when creating
 * @extends ServerError
 */
export class FileExistsError extends ServerError {
  constructor(path) {
    super(
      `File already exists: ${path}`,
      'FILE_EXISTS',
      409,
      { path }
    );
    this.name = 'FileExistsError';
  }
}

/**
 * File not found error
 * @extends ServerError
 */
export class FileNotFoundError extends ServerError {
  constructor(path) {
    super(
      `File not found: ${path}`,
      'FILE_NOT_FOUND',
      404,
      { path }
    );
    this.name = 'FileNotFoundError';
  }
}

/**
 * File size exceeded error
 * @extends ServerError
 */
export class FileSizeExceededError extends ServerError {
  constructor(size, maxSize) {
    super(
      `File size ${size} bytes exceeds maximum ${maxSize} bytes`,
      'FILE_SIZE_EXCEEDED',
      413,
      { size, maxSize }
    );
    this.name = 'FileSizeExceededError';
  }
}

/**
 * Sandbox quota exceeded error
 * @extends ServerError
 */
export class SandboxQuotaExceededError extends ServerError {
  constructor(currentSize, requestedSize, maxSize) {
    super(
      `Sandbox quota exceeded. Current: ${currentSize}, Requested: ${requestedSize}, Max: ${maxSize}`,
      'SANDBOX_QUOTA_EXCEEDED',
      507,
      { currentSize, requestedSize, maxSize }
    );
    this.name = 'SandboxQuotaExceededError';
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
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  FILE_EXISTS: 'FILE_EXISTS',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_SIZE_EXCEEDED: 'FILE_SIZE_EXCEEDED',
  SANDBOX_QUOTA_EXCEEDED: 'SANDBOX_QUOTA_EXCEEDED',
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
  PathTraversalError,
  FileExistsError,
  FileNotFoundError,
  FileSizeExceededError,
  SandboxQuotaExceededError,
  ErrorCodes,
  createErrorResponse
};
