/**
 * @fileoverview Tests for Queue Manager
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { QueueManager } from '../lib/queue-manager.js';

describe('QueueManager', () => {
  const createMockTasks = () => [
    { id: 'task-1', sequenceNumber: 1, state: 'pending' },
    { id: 'task-2', sequenceNumber: 2, state: 'pending' },
    { id: 'task-3', sequenceNumber: 3, state: 'pending' }
  ];

  describe('constructor', () => {
    test('initializes with session ID and tasks', () => {
      const tasks = createMockTasks();
      const manager = new QueueManager('session-123', tasks);

      expect(manager.sessionId).toBe('session-123');
      expect(manager.state.allTasks).toHaveLength(3);
    });

    test('sorts tasks by sequence number', () => {
      const tasks = [
        { id: 'task-3', sequenceNumber: 3, state: 'pending' },
        { id: 'task-1', sequenceNumber: 1, state: 'pending' },
        { id: 'task-2', sequenceNumber: 2, state: 'pending' }
      ];
      const manager = new QueueManager('session-123', tasks);

      expect(manager.state.allTasks[0].id).toBe('task-1');
      expect(manager.state.allTasks[1].id).toBe('task-2');
      expect(manager.state.allTasks[2].id).toBe('task-3');
    });

    test('initializes metrics correctly', () => {
      const tasks = createMockTasks();
      const manager = new QueueManager('session-123', tasks);

      expect(manager.state.metrics.totalTasks).toBe(3);
      expect(manager.state.metrics.completedCount).toBe(0);
      expect(manager.state.metrics.failedCount).toBe(0);
      expect(manager.state.metrics.remainingCount).toBe(3);
    });

    test('sets initial status to initializing', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(manager.state.status).toBe('initializing');
    });
  });

  describe('getState', () => {
    test('returns copy of state', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      const state = manager.getState();

      expect(state.sessionId).toBe('session-123');
      expect(state).not.toBe(manager.state); // Should be a copy
    });
  });

  describe('getStatus / setStatus', () => {
    test('gets and sets status', () => {
      const manager = new QueueManager('session-123', createMockTasks());

      manager.setStatus('running');
      expect(manager.getStatus()).toBe('running');
    });

    test('sets completedAt when status is terminal', () => {
      const manager = new QueueManager('session-123', createMockTasks());

      manager.setStatus('completed');
      expect(manager.state.metrics.completedAt).not.toBeNull();
    });
  });

  describe('getNextTask', () => {
    test('returns first pending task', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      const next = manager.getNextTask();

      expect(next.id).toBe('task-1');
    });

    test('returns null when no pending tasks', () => {
      const manager = new QueueManager('session-123', []);
      expect(manager.getNextTask()).toBeNull();
    });

    test('respects dependencies', () => {
      const tasks = [
        { id: 'task-1', sequenceNumber: 1, state: 'pending' },
        { id: 'task-2', sequenceNumber: 2, state: 'pending', dependencies: [{ taskId: 'task-1' }] }
      ];
      const manager = new QueueManager('session-123', tasks);

      // First task should be available
      expect(manager.getNextTask().id).toBe('task-1');

      // Complete task-1
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      // Now task-2 should be available
      expect(manager.getNextTask().id).toBe('task-2');
    });
  });

  describe('startTask', () => {
    test('marks task as in progress', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      const task = manager.startTask('task-1');

      expect(task.state).toBe('in_progress');
      expect(task.startedAt).toBeDefined();
    });

    test('sets current task', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');

      expect(manager.state.currentTask.id).toBe('task-1');
    });

    test('removes from pending tasks', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');

      expect(manager.state.pendingTasks.find(t => t.id === 'task-1')).toBeUndefined();
    });

    test('sets status to running', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');

      expect(manager.state.status).toBe('running');
    });

    test('throws for non-existent task', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(() => manager.startTask('non-existent')).toThrow('Task not found');
    });
  });

  describe('completeTask', () => {
    test('marks task as completed', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', { output: 'success' });

      const task = manager.state.allTasks.find(t => t.id === 'task-1');
      expect(task.state).toBe('completed');
      expect(task.result).toEqual({ output: 'success' });
    });

    test('updates metrics', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      expect(manager.state.metrics.completedCount).toBe(1);
      expect(manager.state.metrics.remainingCount).toBe(2);
    });

    test('adds to completed tasks', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      expect(manager.state.completedTasks).toHaveLength(1);
      expect(manager.state.completedTasks[0].id).toBe('task-1');
    });

    test('clears current task', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      expect(manager.state.currentTask).toBeNull();
    });

    test('tracks token usage', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', {
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      });

      expect(manager.state.metrics.totalTokenUsage.promptTokens).toBe(100);
      expect(manager.state.metrics.totalTokenUsage.completionTokens).toBe(50);
      expect(manager.state.metrics.totalTokenUsage.totalTokens).toBe(150);
    });

    test('throws for non-existent task', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(() => manager.completeTask('non-existent', {})).toThrow('Task not found');
    });
  });

  describe('failTask', () => {
    test('marks task as failed', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.failTask('task-1', new Error('Something went wrong'));

      const task = manager.state.allTasks.find(t => t.id === 'task-1');
      expect(task.state).toBe('failed');
      expect(task.error.message).toBe('Something went wrong');
    });

    test('updates metrics', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.failTask('task-1', new Error('Failed'));

      expect(manager.state.metrics.failedCount).toBe(1);
      expect(manager.state.metrics.remainingCount).toBe(2);
    });

    test('adds to failed tasks', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.failTask('task-1', new Error('Failed'));

      expect(manager.state.failedTasks).toHaveLength(1);
    });

    test('throws for non-existent task', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(() => manager.failTask('non-existent', new Error('X'))).toThrow('Task not found');
    });
  });

  describe('isComplete', () => {
    test('returns false when tasks are pending', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(manager.isComplete()).toBe(false);
    });

    test('returns false when task is in progress', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      expect(manager.isComplete()).toBe(false);
    });

    test('returns true when all tasks processed', () => {
      const tasks = [{ id: 'task-1', sequenceNumber: 1, state: 'pending' }];
      const manager = new QueueManager('session-123', tasks);
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      expect(manager.isComplete()).toBe(true);
    });
  });

  describe('isSuccessful', () => {
    test('returns false when not complete', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(manager.isSuccessful()).toBe(false);
    });

    test('returns false when there are failures', () => {
      const tasks = [{ id: 'task-1', sequenceNumber: 1, state: 'pending' }];
      const manager = new QueueManager('session-123', tasks);
      manager.startTask('task-1');
      manager.failTask('task-1', new Error('Failed'));

      expect(manager.isSuccessful()).toBe(false);
    });

    test('returns true when complete with no failures', () => {
      const tasks = [{ id: 'task-1', sequenceNumber: 1, state: 'pending' }];
      const manager = new QueueManager('session-123', tasks);
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      expect(manager.isSuccessful()).toBe(true);
    });
  });

  describe('isBlocked', () => {
    test('returns false when no pending tasks', () => {
      const manager = new QueueManager('session-123', []);
      expect(manager.isBlocked()).toBe(false);
    });

    test('returns false when tasks have satisfied dependencies', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(manager.isBlocked()).toBe(false);
    });

    test('returns true when all pending tasks have unsatisfied dependencies', () => {
      const tasks = [
        { id: 'task-1', sequenceNumber: 1, state: 'pending', dependencies: [{ taskId: 'non-existent' }] }
      ];
      const manager = new QueueManager('session-123', tasks);
      expect(manager.isBlocked()).toBe(true);
    });
  });

  describe('getProgress', () => {
    test('returns 100 for empty queue', () => {
      const manager = new QueueManager('session-123', []);
      expect(manager.getProgress()).toBe(100);
    });

    test('returns 0 for no completed tasks', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      expect(manager.getProgress()).toBe(0);
    });

    test('calculates percentage correctly', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', {});

      expect(manager.getProgress()).toBe(33); // 1/3 = 33%
    });
  });

  describe('getMetrics', () => {
    test('returns copy of metrics', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      const metrics = manager.getMetrics();

      expect(metrics.totalTasks).toBe(3);
      expect(metrics).not.toBe(manager.state.metrics);
    });
  });

  describe('exportState / fromExportedState', () => {
    test('exports and restores state', () => {
      const manager = new QueueManager('session-123', createMockTasks());
      manager.startTask('task-1');
      manager.completeTask('task-1', { output: 'test' });
      manager.setStatus('running');

      const exported = manager.exportState();
      expect(exported.sessionId).toBe('session-123');
      expect(exported.status).toBe('running');
      expect(exported.exportedAt).toBeDefined();

      const restored = QueueManager.fromExportedState(exported);
      expect(restored.sessionId).toBe('session-123');
      expect(restored.state.status).toBe('running');
      expect(restored.state.completedTasks).toHaveLength(1);
    });
  });
});
