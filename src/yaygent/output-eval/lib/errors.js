/**
 * @fileoverview Custom error classes for Output Evaluation Service
 * @module errors
 */

export class EvaluationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'EvaluationError';
    this.code = code;
    this.details = details;
  }
}

export class BundleNotFoundError extends EvaluationError {
  constructor(path) {
    super(`Bundle not found: ${path}`, 'BUNDLE_NOT_FOUND', { path });
    this.name = 'BundleNotFoundError';
  }
}

export class BundleIntegrityError extends EvaluationError {
  constructor(message, missingFiles = []) {
    super(message, 'BUNDLE_INTEGRITY_ERROR', { missingFiles });
    this.name = 'BundleIntegrityError';
  }
}

export class LLMError extends EvaluationError {
  constructor(message, details = {}) {
    super(message, 'LLM_ERROR', details);
    this.name = 'LLMError';
  }
}

export class ConfigurationError extends EvaluationError {
  constructor(message, configKey) {
    super(message, 'CONFIG_ERROR', { configKey });
    this.name = 'ConfigurationError';
  }
}

export default {
  EvaluationError,
  BundleNotFoundError,
  BundleIntegrityError,
  LLMError,
  ConfigurationError
};
