/**
 * @fileoverview Custom error classes for Goals Watcher Service
 * @module errors
 */

export class WatcherError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'WatcherError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class ConfigurationError extends WatcherError {
  constructor(message, configKey) {
    super(message, 'CONFIG_ERROR', { configKey });
    this.name = 'ConfigurationError';
  }
}

export class DirectoryNotFoundError extends WatcherError {
  constructor(path) {
    super(`Directory not found: ${path}`, 'DIR_NOT_FOUND', { path });
    this.name = 'DirectoryNotFoundError';
  }
}

export class FileValidationError extends WatcherError {
  constructor(message, filePath, details = {}) {
    super(message, 'FILE_VALIDATION_ERROR', { filePath, ...details });
    this.name = 'FileValidationError';
  }
}

export class SessionServerError extends WatcherError {
  constructor(message, endpoint, statusCode, details = {}) {
    super(message, 'SESSION_SERVER_ERROR', { endpoint, statusCode, ...details });
    this.name = 'SessionServerError';
  }
}

export class ProcessingError extends WatcherError {
  constructor(message, filePath, stage, details = {}) {
    super(message, 'PROCESSING_ERROR', { filePath, stage, ...details });
    this.name = 'ProcessingError';
  }
}

export default {
  WatcherError,
  ConfigurationError,
  DirectoryNotFoundError,
  FileValidationError,
  SessionServerError,
  ProcessingError
};