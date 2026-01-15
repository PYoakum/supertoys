/**
 * @fileoverview Tests for Bundle Loader
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { BundleLoader } from '../lib/bundle-loader.js';
import { BundleNotFoundError, BundleIntegrityError } from '../lib/errors.js';

const TEST_DIR = './tests/fixtures/test-bundle';

describe('BundleLoader', () => {
  // Setup test bundle structure
  beforeEach(async () => {
    await mkdir(join(TEST_DIR, 'session/context'), { recursive: true });
    await mkdir(join(TEST_DIR, 'execution/tasks'), { recursive: true });
    await mkdir(join(TEST_DIR, 'execution/evaluations'), { recursive: true });
    await mkdir(join(TEST_DIR, 'artifacts'), { recursive: true });

    // Create required files
    await writeFile(join(TEST_DIR, 'manifest.json'), JSON.stringify({
      bundleId: 'test-bundle',
      sessionId: 'session-123',
      version: '1.0.0'
    }));

    await writeFile(join(TEST_DIR, 'session/session.json'), JSON.stringify({
      id: 'session-123',
      state: 'completed'
    }));

    await writeFile(join(TEST_DIR, 'session/goals.json'), JSON.stringify({
      items: [{ id: 'goal-1', objective: 'Test goal' }]
    }));

    await writeFile(join(TEST_DIR, 'session/tasks.json'), JSON.stringify({
      tasks: [{ id: 'task-1', goalId: 'goal-1' }]
    }));

    await writeFile(join(TEST_DIR, 'execution/execution-log.json'), JSON.stringify({
      entries: []
    }));
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    test('initializes with bundle path', () => {
      const loader = new BundleLoader('/path/to/bundle');
      expect(loader.bundlePath).toBe('/path/to/bundle');
      expect(loader.loaded).toBe(false);
      expect(loader.data).toBeNull();
    });

    test('validates integrity by default', () => {
      const loader = new BundleLoader('/path');
      expect(loader.validateIntegrity).toBe(true);
    });

    test('can disable integrity validation', () => {
      const loader = new BundleLoader('/path', { validateIntegrity: false });
      expect(loader.validateIntegrity).toBe(false);
    });
  });

  describe('load', () => {
    test('throws BundleNotFoundError for non-existent path', async () => {
      const loader = new BundleLoader('./non-existent-bundle');

      try {
        await loader.load();
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error instanceof BundleNotFoundError).toBe(true);
      }
    });

    test('throws BundleIntegrityError for missing required files', async () => {
      // Remove a required file
      await rm(join(TEST_DIR, 'session/tasks.json'));

      const loader = new BundleLoader(TEST_DIR);

      try {
        await loader.load();
        expect(true).toBe(false);
      } catch (error) {
        expect(error instanceof BundleIntegrityError).toBe(true);
        expect(error.details.missingFiles).toContain('session/tasks.json');
      }
    });

    test('loads valid bundle successfully', async () => {
      const loader = new BundleLoader(TEST_DIR);
      const data = await loader.load();

      expect(loader.loaded).toBe(true);
      expect(data.manifest.bundleId).toBe('test-bundle');
      expect(data.session.id).toBe('session-123');
      expect(data.goals.items).toHaveLength(1);
      expect(data.tasks.tasks).toHaveLength(1);
    });

    test('skips integrity check when disabled', async () => {
      // Remove a required file
      await rm(join(TEST_DIR, 'session/tasks.json'));

      const loader = new BundleLoader(TEST_DIR, { validateIntegrity: false });
      const data = await loader.load();

      expect(loader.loaded).toBe(true);
      expect(data.tasks).toBeNull();
    });
  });

  describe('loadContextFiles', () => {
    test('loads context files from directory', async () => {
      await writeFile(join(TEST_DIR, 'session/context/readme.md'), '# Test');
      await writeFile(join(TEST_DIR, 'session/context/config.json'), '{}');

      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      expect(loader.data.context.files).toHaveLength(2);
    });

    test('returns empty files array for missing context dir', async () => {
      await rm(join(TEST_DIR, 'session/context'), { recursive: true });

      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      expect(loader.data.context.files).toHaveLength(0);
    });
  });

  describe('loadTaskOutputs', () => {
    test('loads task output markdown files', async () => {
      await writeFile(
        join(TEST_DIR, 'execution/tasks/001-task-1.md'),
        '# Task Output\n\n**Task ID:** task-1\n**Goal ID:** goal-1\n**Duration:** 1000'
      );

      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      expect(loader.data.taskOutputs).toHaveLength(1);
      expect(loader.data.taskOutputs[0].taskId).toBe('task-1');
    });

    test('parses metadata from task output', async () => {
      await writeFile(
        join(TEST_DIR, 'execution/tasks/001-task-1.md'),
        '**Task ID:** my-task\n**Goal ID:** my-goal\n**Duration:** 5000'
      );

      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      const metadata = loader.data.taskOutputs[0].metadata;
      expect(metadata.taskId).toBe('my-task');
      expect(metadata.goalId).toBe('my-goal');
      expect(metadata.durationMs).toBe(5000);
    });
  });

  describe('loadEvaluations', () => {
    test('loads evaluation JSON files', async () => {
      await writeFile(
        join(TEST_DIR, 'execution/evaluations/task-1-eval.json'),
        JSON.stringify({ taskId: 'task-1', success: true })
      );

      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      expect(loader.data.evaluations).toHaveLength(1);
      expect(loader.data.evaluations[0].success).toBe(true);
    });
  });

  describe('listArtifacts', () => {
    test('lists artifact files with metadata', async () => {
      await writeFile(join(TEST_DIR, 'artifacts/output.txt'), 'Hello World');
      await writeFile(join(TEST_DIR, 'artifacts/data.json'), '{"key": "value"}');

      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      expect(loader.data.artifacts).toHaveLength(2);
      const txtArtifact = loader.data.artifacts.find(a => a.path.includes('output.txt'));
      expect(txtArtifact.type).toBe('txt');
      expect(txtArtifact.content).toBe('Hello World');
    });
  });

  describe('getData', () => {
    test('throws if bundle not loaded', () => {
      const loader = new BundleLoader(TEST_DIR);
      expect(() => loader.getData()).toThrow('Bundle not loaded');
    });

    test('returns data after loading', async () => {
      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      const data = loader.getData();
      expect(data).not.toBeNull();
      expect(data.manifest).toBeDefined();
    });
  });

  describe('getSessionId', () => {
    test('returns session ID from manifest', async () => {
      const loader = new BundleLoader(TEST_DIR);
      await loader.load();

      expect(loader.getSessionId()).toBe('session-123');
    });

    test('returns undefined when not loaded', () => {
      const loader = new BundleLoader(TEST_DIR);
      expect(loader.getSessionId()).toBeUndefined();
    });
  });

  describe('parseTaskOutputMetadata', () => {
    test('extracts metadata from markdown content', () => {
      const loader = new BundleLoader(TEST_DIR);
      const content = `
**Task ID:** task-abc
**Goal ID:** goal-xyz
**Duration:** 12345
`;
      const metadata = loader.parseTaskOutputMetadata(content);

      expect(metadata.taskId).toBe('task-abc');
      expect(metadata.goalId).toBe('goal-xyz');
      expect(metadata.durationMs).toBe(12345);
    });

    test('returns empty object for missing metadata', () => {
      const loader = new BundleLoader(TEST_DIR);
      const metadata = loader.parseTaskOutputMetadata('No metadata here');

      expect(metadata).toEqual({});
    });
  });
});
