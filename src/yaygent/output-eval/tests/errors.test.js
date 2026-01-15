/**
 * @fileoverview Tests for custom error classes
 */

import { describe, test, expect } from 'bun:test';
import {
  EvaluationError,
  BundleNotFoundError,
  BundleIntegrityError,
  LLMError,
  ConfigurationError
} from '../lib/errors.js';

describe('EvaluationError', () => {
  test('creates error with message, code, and details', () => {
    const error = new EvaluationError('Test error', 'TEST_CODE', { key: 'value' });

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('EvaluationError');
  });

  test('defaults details to empty object', () => {
    const error = new EvaluationError('Test', 'CODE');
    expect(error.details).toEqual({});
  });

  test('is instance of Error', () => {
    const error = new EvaluationError('Test', 'CODE');
    expect(error instanceof Error).toBe(true);
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

  test('is instance of EvaluationError', () => {
    const error = new BundleNotFoundError('/path');
    expect(error instanceof EvaluationError).toBe(true);
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
