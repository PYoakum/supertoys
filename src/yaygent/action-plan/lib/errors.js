/**
 * @fileoverview Custom error classes for Action Plan Service
 * @module errors
 */

export class ActionPlanError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ActionPlanError';
    this.code = code;
    this.details = details;
  }
}

export class SessionNotFoundError extends ActionPlanError {
  constructor(sessionId) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND', { sessionId });
    this.name = 'SessionNotFoundError';
  }
}

export class SessionInvalidStateError extends ActionPlanError {
  constructor(sessionId, currentState, requiredState) {
    super(
      `Session ${sessionId} is in state '${currentState}', expected '${requiredState}'`,
      'SESSION_INVALID_STATE',
      { sessionId, currentState, requiredState }
    );
    this.name = 'SessionInvalidStateError';
  }
}

export class ConnectionError extends ActionPlanError {
  constructor(message, url) {
    super(message, 'CONNECTION_ERROR', { url });
    this.name = 'ConnectionError';
  }
}

export class TaskExecutionError extends ActionPlanError {
  constructor(taskId, message, details = {}) {
    super(`Task ${taskId} execution failed: ${message}`, 'TASK_EXECUTION_ERROR', { taskId, ...details });
    this.name = 'TaskExecutionError';
  }
}

export class TaskEvaluationError extends ActionPlanError {
  constructor(taskId, message) {
    super(`Task ${taskId} evaluation failed: ${message}`, 'TASK_EVALUATION_ERROR', { taskId });
    this.name = 'TaskEvaluationError';
  }
}

export class BundleError extends ActionPlanError {
  constructor(message, details = {}) {
    super(message, 'BUNDLE_ERROR', details);
    this.name = 'BundleError';
  }
}

export class BundleNotFoundError extends ActionPlanError {
  constructor(path) {
    super(`Bundle not found: ${path}`, 'BUNDLE_NOT_FOUND', { path });
    this.name = 'BundleNotFoundError';
  }
}

export class BundleIntegrityError extends ActionPlanError {
  constructor(message, missingFiles = []) {
    super(message, 'BUNDLE_INTEGRITY_ERROR', { missingFiles });
    this.name = 'BundleIntegrityError';
  }
}

export class LLMError extends ActionPlanError {
  constructor(message, details = {}) {
    super(message, 'LLM_ERROR', details);
    this.name = 'LLMError';
  }
}

export class ConfigurationError extends ActionPlanError {
  constructor(message, configKey) {
    super(message, 'CONFIG_ERROR', { configKey });
    this.name = 'ConfigurationError';
  }
}

export default {
  ActionPlanError,
  SessionNotFoundError,
  SessionInvalidStateError,
  ConnectionError,
  TaskExecutionError,
  TaskEvaluationError,
  BundleError,
  BundleNotFoundError,
  BundleIntegrityError,
  LLMError,
  ConfigurationError
};
