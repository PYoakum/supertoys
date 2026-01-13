/**
 * @fileoverview Custom error classes for the Goals CLI application
 * @module errors
 */

/**
 * Base error class for all application errors
 * @extends Error
 */
export class GoalsError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} code - Machine-readable error code
   * @param {Object} [details={}] - Additional error context
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'GoalsError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Convert error to JSON representation
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

/**
 * Validation errors (invalid input data)
 * @extends GoalsError
 */
export class ValidationError extends GoalsError {
  /**
   * @param {string} message - Error message
   * @param {string} [field] - Field that failed validation
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, field, details = {}) {
    super(message, 'VALIDATION_ERROR', { field, ...details });
    this.name = 'ValidationError';
  }
}

/**
 * Configuration errors
 * @extends GoalsError
 */
export class ConfigurationError extends GoalsError {
  /**
   * @param {string} message - Error message
   * @param {string} [configKey] - Configuration key that caused the error
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, configKey, details = {}) {
    super(message, 'CONFIG_ERROR', { configKey, ...details });
    this.name = 'ConfigurationError';
  }
}

/**
 * File system errors
 * @extends GoalsError
 */
export class FileSystemError extends GoalsError {
  /**
   * @param {string} message - Error message
   * @param {string} path - File/directory path
   * @param {string} operation - Operation that failed (read, write, etc.)
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, path, operation, details = {}) {
    super(message, 'FS_ERROR', { path, operation, ...details });
    this.name = 'FileSystemError';
  }
}

/**
 * API communication errors
 * @extends GoalsError
 */
export class ApiError extends GoalsError {
  /**
   * @param {string} message - Error message
   * @param {number} [statusCode] - HTTP status code
   * @param {*} [response] - Response body
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, statusCode, response, details = {}) {
    super(message, 'API_ERROR', { statusCode, response, ...details });
    this.name = 'ApiError';
  }
}

/**
 * Goals file specific errors
 * @extends GoalsError
 */
export class GoalsFileError extends GoalsError {
  /**
   * @param {string} message - Error message
   * @param {string} errorCode - Specific error code (E001, E002, etc.)
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, errorCode, details = {}) {
    super(message, errorCode, details);
    this.name = 'GoalsFileError';
  }
}

/**
 * Context loading errors
 * @extends GoalsError
 */
export class ContextError extends GoalsError {
  /**
   * @param {string} message - Error message
   * @param {string} errorCode - Specific error code (E004, E005, etc.)
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, errorCode, details = {}) {
    super(message, errorCode, details);
    this.name = 'ContextError';
  }
}

/**
 * Error code reference
 * @readonly
 * @enum {string}
 */
export const ErrorCodes = {
  // Input errors (E001-E009)
  GOALS_FILE_NOT_FOUND: 'E001',
  GOALS_FILE_INVALID_JSON: 'E002',
  GOALS_FILE_SCHEMA_INVALID: 'E003',
  CONTEXT_DIR_NOT_FOUND: 'E004',
  CONTEXT_DIR_EMPTY: 'E005',
  CONTEXT_SIZE_EXCEEDED: 'E006',
  
  // Config errors (E010-E019)
  CONFIG_FILE_NOT_FOUND: 'E010',
  CONFIG_SYNTAX_ERROR: 'E011',
  CONFIG_MISSING_REQUIRED: 'E012',
  CONFIG_INVALID_VALUE: 'E013',
  
  // Auth errors (E020-E029)
  AUTH_MISSING_TOKEN: 'E020',
  AUTH_INVALID_TOKEN: 'E021',
  AUTH_TOKEN_EXPIRED: 'E022',
  
  // API errors (E030-E039)
  API_CONNECTION_FAILED: 'E030',
  API_TIMEOUT: 'E031',
  API_RATE_LIMITED: 'E032',
  API_SERVER_ERROR: 'E033',
  API_INVALID_RESPONSE: 'E034'
};

/**
 * Exit codes for CLI
 * @readonly
 * @enum {number}
 */
export const ExitCodes = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGUMENTS: 2,
  CONFIGURATION_ERROR: 3,
  VALIDATION_ERROR: 4,
  API_ERROR: 5,
  INTERRUPTED: 10
};

/**
 * Map error types to exit codes
 * @param {Error} error - Error instance
 * @returns {number} Exit code
 */
export function getExitCode(error) {
  if (error instanceof ValidationError || error instanceof GoalsFileError) {
    return ExitCodes.VALIDATION_ERROR;
  }
  if (error instanceof ConfigurationError) {
    return ExitCodes.CONFIGURATION_ERROR;
  }
  if (error instanceof ApiError) {
    return ExitCodes.API_ERROR;
  }
  return ExitCodes.GENERAL_ERROR;
}
