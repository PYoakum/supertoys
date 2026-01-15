/**
 * @fileoverview Tests for custom error classes
 */

import { describe, test, expect } from 'bun:test';
import {
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
} from '../lib/errors.js';

describe('ActionPlanError', () => {
  test('creates error with message, code, and details', () => {
    const error = new ActionPlanError('Test error', 'TEST_CODE', { key: 'value' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('ActionPlanError');
  });

  test('defaults details to empty object', () => {
    const error = new ActionPlanError('Test', 'CODE');
    expect(error.details).toEqual({});
  });

  test('is instance of Error', () => {
    const error = new ActionPlanError('Test', 'CODE');
    expect(error instanceof Error).toBe(true);
  });
});

describe('SessionNotFoundError', () => {
  test('creates error with session ID', () => {
    const error = new SessionNotFoundError('session-123');

    expect(error.message).toBe('Session not found: session-123');
    expect(error.code).toBe('SESSION_NOT_FOUND');
    expect(error.details.sessionId).toBe('session-123');
    expect(error.name).toBe('SessionNotFoundError');
  });

  test('is instance of ActionPlanError', () => {
    const error = new SessionNotFoundError('session-123');
    expect(error instanceof ActionPlanError).toBe(true);
  });
});

describe('SessionInvalidStateError', () => {
  test('creates error with state details', () => {
    const error = new SessionInvalidStateError('session-123', 'created', 'loaded');

    expect(error.message).toContain('session-123');
    expect(error.message).toContain('created');
    expect(error.message).toContain('loaded');
    expect(error.code).toBe('SESSION_INVALID_STATE');
    expect(error.details.sessionId).toBe('session-123');
    expect(error.details.currentState).toBe('created');
    expect(error.details.requiredState).toBe('loaded');
    expect(error.name).toBe('SessionInvalidStateError');
  });
});

describe('ConnectionError', () => {
  test('creates error with URL', () => {
    const error = new ConnectionError('Connection failed', 'http://localhost:3000');

    expect(error.message).toBe('Connection failed');
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.details.url).toBe('http://localhost:3000');
    expect(error.name).toBe('ConnectionError');
  });
});

describe('TaskExecutionError', () => {
  test('creates error with task ID and details', () => {
    const error = new TaskExecutionError('task-1', 'Timeout', { timeout: 30000 });

    expect(error.message).toBe('Task task-1 execution failed: Timeout');
    expect(error.code).toBe('TASK_EXECUTION_ERROR');
    expect(error.details.taskId).toBe('task-1');
    expect(error.details.timeout).toBe(30000);
    expect(error.name).toBe('TaskExecutionError');
  });

  test('defaults details', () => {
    const error = new TaskExecutionError('task-1', 'Failed');
    expect(error.details.taskId).toBe('task-1');
  });
});

describe('TaskEvaluationError', () => {
  test('creates error with task ID', () => {
    const error = new TaskEvaluationError('task-1', 'Invalid output');

    expect(error.message).toBe('Task task-1 evaluation failed: Invalid output');
    expect(error.code).toBe('TASK_EVALUATION_ERROR');
    expect(error.details.taskId).toBe('task-1');
    expect(error.name).toBe('TaskEvaluationError');
  });
});

describe('BundleError', () => {
  test('creates error with details', () => {
    const error = new BundleError('Bundle creation failed', { path: '/output' });

    expect(error.message).toBe('Bundle creation failed');
    expect(error.code).toBe('BUNDLE_ERROR');
    expect(error.details.path).toBe('/output');
    expect(error.name).toBe('BundleError');
  });
});

describe('BundleNotFoundError', () => {
  test('creates error with path', () => {
    const error = new BundleNotFoundError('/path/to/bundle');

    expect(error.message).toBe('Bundle not found: /path/to/bundle');
    expect(error.code).toBe('BUNDLE_NOT_FOUND');
    expect(error.details.path).toBe('/path/to/bundle');
    expect(error.name).toBe('BundleNotFoundError');
  });
});

describe('BundleIntegrityError', () => {
  test('creates error with missing files', () => {
    const missingFiles = ['file1.json', 'file2.json'];
    const error = new BundleIntegrityError('Checksum mismatch', missingFiles);

    expect(error.message).toBe('Checksum mismatch');
    expect(error.code).toBe('BUNDLE_INTEGRITY_ERROR');
    expect(error.details.missingFiles).toEqual(missingFiles);
    expect(error.name).toBe('BundleIntegrityError');
  });

  test('defaults missing files to empty array', () => {
    const error = new BundleIntegrityError('Corrupt bundle');
    expect(error.details.missingFiles).toEqual([]);
  });
});

describe('LLMError', () => {
  test('creates error with details', () => {
    const error = new LLMError('Rate limited', { retryAfter: 60 });

    expect(error.message).toBe('Rate limited');
    expect(error.code).toBe('LLM_ERROR');
    expect(error.details.retryAfter).toBe(60);
    expect(error.name).toBe('LLMError');
  });
});

describe('ConfigurationError', () => {
  test('creates error with config key', () => {
    const error = new ConfigurationError('Invalid API key', 'apiKey');

    expect(error.message).toBe('Invalid API key');
    expect(error.code).toBe('CONFIG_ERROR');
    expect(error.details.configKey).toBe('apiKey');
    expect(error.name).toBe('ConfigurationError');
  });
});
