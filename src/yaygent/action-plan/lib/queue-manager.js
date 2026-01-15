/**
 * @fileoverview Queue Manager for task queue state and execution order
 * @module queue-manager
 */

/**
 * Extract dependency ID from various formats
 * Dependencies can be: string, number, or object with various property names
 * @param {*} dep - Dependency in any format
 * @param {number} [depth=0] - Recursion depth for safety
 * @returns {string}
 */
function extractDepId(dep, depth = 0) {
  // Safety: prevent infinite recursion
  if (depth > 10) return 'unknown';

  if (typeof dep === 'string') return dep;
  if (typeof dep === 'number') return String(dep);

  if (dep && typeof dep === 'object') {
    // Handle arrays - take first element
    if (Array.isArray(dep)) {
      if (dep.length > 0) {
        return extractDepId(dep[0], depth + 1);
      }
      return 'unknown';
    }

    // Try various property names that might contain the ID
    const idProps = ['taskId', 'id', 'dependsOn', 'target', 'dependency', 'task', 'ref'];
    for (const prop of idProps) {
      if (dep[prop] !== undefined && dep[prop] !== null) {
        return extractDepId(dep[prop], depth + 1);
      }
    }

    // If object has keys, try to find one that looks like an ID
    const keys = Object.keys(dep);
    if (keys.length > 0) {
      // Look for a key that contains 'id' or 'task'
      const idKey = keys.find(k => /id|task|ref/i.test(k));
      if (idKey && dep[idKey]) {
        return extractDepId(dep[idKey], depth + 1);
      }
      // Take first value as fallback
      const firstVal = dep[keys[0]];
      if (typeof firstVal === 'string' || typeof firstVal === 'number') {
        return String(firstVal);
      }
    }
  }

  return String(dep);
}

/**
 * @typedef {'initializing'|'running'|'paused'|'completed'|'failed'|'aborted'} QueueStatus
 */

/**
 * @typedef {Object} QueueState
 * @property {string} sessionId
 * @property {Object[]} allTasks
 * @property {Object[]} pendingTasks
 * @property {Object[]} completedTasks
 * @property {Object[]} failedTasks
 * @property {Object|null} currentTask
 * @property {QueueStatus} status
 * @property {QueueMetrics} metrics
 */

/**
 * @typedef {Object} QueueMetrics
 * @property {number} totalTasks
 * @property {number} completedCount
 * @property {number} failedCount
 * @property {number} remainingCount
 * @property {string} startedAt
 * @property {string|null} completedAt
 * @property {number} totalExecutionTimeMs
 * @property {TokenUsage} totalTokenUsage
 */

/**
 * Queue Manager class
 */
export class QueueManager {
  /**
   * @param {string} sessionId
   * @param {Object[]} tasks - Task list from session server
   * @param {Object} [options] - Configuration options
   * @param {number} [options.baseBufferMs=500] - Base buffer delay in ms
   * @param {number} [options.bufferPerDependent=200] - Additional buffer per dependent task
   * @param {number} [options.maxBufferMs=5000] - Maximum buffer delay in ms
   */
  constructor(sessionId, tasks, options = {}) {
    this.sessionId = sessionId;

    // Buffer/delay configuration
    this.bufferConfig = {
      baseBufferMs: options.baseBufferMs ?? 500,
      bufferPerDependent: options.bufferPerDependent ?? 200,
      maxBufferMs: options.maxBufferMs ?? 5000
    };

    // Track last completed task for buffer calculation
    this.lastCompletedTaskId = null;

    // Sort tasks by sequence number
    const sortedTasks = [...tasks].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    // Pre-compute dependency graph (which tasks depend on which)
    this.dependentsMap = this._buildDependentsMap(sortedTasks);

    /** @type {QueueState} */
    this.state = {
      sessionId,
      allTasks: sortedTasks,
      pendingTasks: sortedTasks.filter(t => t.state === 'pending' || t.state === 'ready'),
      completedTasks: sortedTasks.filter(t => t.state === 'completed'),
      failedTasks: sortedTasks.filter(t => t.state === 'failed'),
      currentTask: null,
      status: 'initializing',
      metrics: {
        totalTasks: sortedTasks.length,
        completedCount: sortedTasks.filter(t => t.state === 'completed').length,
        failedCount: sortedTasks.filter(t => t.state === 'failed').length,
        remainingCount: sortedTasks.filter(t => t.state === 'pending' || t.state === 'ready').length,
        startedAt: new Date().toISOString(),
        completedAt: null,
        totalExecutionTimeMs: 0,
        totalBufferTimeMs: 0,
        totalTokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      }
    };
  }

  /**
   * Build a map of task ID -> array of task IDs that depend on it
   * @param {Object[]} tasks
   * @returns {Map<string, string[]>}
   * @private
   */
  _buildDependentsMap(tasks) {
    const map = new Map();

    // Initialize all tasks with empty arrays
    for (const task of tasks) {
      map.set(task.id, []);
    }

    // Build reverse dependency map
    for (const task of tasks) {
      const deps = task.dependencies || [];
      for (const dep of deps) {
        const depId = extractDepId(dep);
        const dependents = map.get(depId);
        if (dependents) {
          dependents.push(task.id);
        }
      }
    }

    return map;
  }

  /**
   * Get the number of tasks that depend on a given task
   * @param {string} taskId
   * @returns {number}
   */
  getDependentCount(taskId) {
    return this.dependentsMap.get(taskId)?.length || 0;
  }

  /**
   * Calculate the recommended buffer delay for a completed task
   * Based on how many other tasks depend on it
   * @param {string} taskId
   * @returns {number} Buffer delay in milliseconds
   */
  getBufferDelayMs(taskId) {
    const dependentCount = this.getDependentCount(taskId);

    // No buffer needed if no dependents
    if (dependentCount === 0) {
      return 0;
    }

    // Calculate buffer: base + (perDependent * count), capped at max
    const buffer = this.bufferConfig.baseBufferMs +
                  (this.bufferConfig.bufferPerDependent * dependentCount);

    return Math.min(buffer, this.bufferConfig.maxBufferMs);
  }

  /**
   * Wait for the recommended buffer delay after completing a task
   * @param {string} taskId - The completed task ID
   * @returns {Promise<number>} The actual delay in ms (0 if no delay)
   */
  async waitForBuffer(taskId) {
    const delayMs = this.getBufferDelayMs(taskId);

    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      this.state.metrics.totalBufferTimeMs += delayMs;
    }

    return delayMs;
  }

  /**
   * Get current queue state
   * @returns {QueueState}
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Get queue status
   * @returns {QueueStatus}
   */
  getStatus() {
    return this.state.status;
  }

  /**
   * Set queue status
   * @param {QueueStatus} status
   */
  setStatus(status) {
    this.state.status = status;
    
    if (status === 'completed' || status === 'failed' || status === 'aborted') {
      this.state.metrics.completedAt = new Date().toISOString();
    }
  }

  /**
   * Check if all dependencies for a task are satisfied
   * @param {Object} task
   * @returns {boolean}
   * @private
   */
  areDependenciesSatisfied(task) {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }
    
    return task.dependencies.every(dep => {
      const depId = extractDepId(dep);
      const depTask = this.state.allTasks.find(t => t.id === depId);
      return depTask && depTask.state === 'completed';
    });
  }

  /**
   * Get the next task to execute
   * @returns {Object|null}
   */
  getNextTask() {
    // Find the first pending task with satisfied dependencies
    for (const task of this.state.pendingTasks) {
      if (this.areDependenciesSatisfied(task)) {
        return task;
      }
    }
    
    return null;
  }

  /**
   * Mark a task as current (in progress)
   * @param {string} taskId
   * @returns {Object}
   */
  startTask(taskId) {
    const task = this.state.allTasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    task.state = 'in_progress';
    task.startedAt = new Date().toISOString();
    this.state.currentTask = task;
    this.state.status = 'running';
    
    // Remove from pending
    this.state.pendingTasks = this.state.pendingTasks.filter(t => t.id !== taskId);
    
    return task;
  }

  /**
   * Mark a task as completed
   * @param {string} taskId
   * @param {Object} result - Execution result
   */
  completeTask(taskId, result) {
    const task = this.state.allTasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    task.state = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result;
    
    // Calculate execution time
    const startTime = new Date(task.startedAt).getTime();
    const endTime = new Date(task.completedAt).getTime();
    task.executionTimeMs = endTime - startTime;
    
    this.state.completedTasks.push(task);
    this.state.currentTask = null;
    
    // Update metrics
    this.state.metrics.completedCount++;
    this.state.metrics.remainingCount--;
    this.state.metrics.totalExecutionTimeMs += task.executionTimeMs;
    
    if (result.tokenUsage) {
      this.state.metrics.totalTokenUsage.promptTokens += result.tokenUsage.promptTokens || 0;
      this.state.metrics.totalTokenUsage.completionTokens += result.tokenUsage.completionTokens || 0;
      this.state.metrics.totalTokenUsage.totalTokens += result.tokenUsage.totalTokens || 0;
    }
    
    // Update dependency status for dependent tasks
    for (const t of this.state.allTasks) {
      if (t.dependencies) {
        const dep = t.dependencies.find(d => extractDepId(d) === taskId);
        if (dep && typeof dep === 'object') {
          dep.satisfied = true;
        }
      }
    }
  }

  /**
   * Mark a task as failed
   * @param {string} taskId
   * @param {Error} error
   */
  failTask(taskId, error) {
    const task = this.state.allTasks.find(t => t.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    task.state = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = {
      code: error.code || 'UNKNOWN_ERROR',
      message: error.message,
      details: error.details || {}
    };
    
    // Calculate execution time
    if (task.startedAt) {
      const startTime = new Date(task.startedAt).getTime();
      const endTime = new Date(task.completedAt).getTime();
      task.executionTimeMs = endTime - startTime;
      this.state.metrics.totalExecutionTimeMs += task.executionTimeMs;
    }
    
    this.state.failedTasks.push(task);
    this.state.currentTask = null;
    
    // Update metrics
    this.state.metrics.failedCount++;
    this.state.metrics.remainingCount--;
  }

  /**
   * Check if queue processing is complete
   * @returns {boolean}
   */
  isComplete() {
    return this.state.pendingTasks.length === 0 && this.state.currentTask === null;
  }

  /**
   * Check if all tasks completed successfully
   * @returns {boolean}
   */
  isSuccessful() {
    return this.isComplete() && this.state.failedTasks.length === 0;
  }

  /**
   * Check if queue is blocked (has pending tasks but none are ready)
   * @returns {boolean}
   */
  isBlocked() {
    if (this.state.pendingTasks.length === 0) {
      return false;
    }
    
    // Check if any pending task has satisfied dependencies
    for (const task of this.state.pendingTasks) {
      if (this.areDependenciesSatisfied(task)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Get current progress as percentage
   * @returns {number}
   */
  getProgress() {
    if (this.state.metrics.totalTasks === 0) {
      return 100;
    }
    return Math.round(
      (this.state.metrics.completedCount / this.state.metrics.totalTasks) * 100
    );
  }

  /**
   * Get metrics summary
   * @returns {QueueMetrics}
   */
  getMetrics() {
    return { ...this.state.metrics };
  }

  /**
   * Export state for persistence
   * @returns {Object}
   */
  exportState() {
    return {
      sessionId: this.sessionId,
      status: this.state.status,
      tasks: this.state.allTasks,
      metrics: this.state.metrics,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import state from persistence
   * @param {Object} exportedState
   * @returns {QueueManager}
   */
  static fromExportedState(exportedState) {
    const manager = new QueueManager(exportedState.sessionId, exportedState.tasks);
    manager.state.status = exportedState.status;
    manager.state.metrics = exportedState.metrics;
    
    // Rebuild task arrays based on states
    manager.state.pendingTasks = exportedState.tasks.filter(
      t => t.state === 'pending' || t.state === 'ready'
    );
    manager.state.completedTasks = exportedState.tasks.filter(t => t.state === 'completed');
    manager.state.failedTasks = exportedState.tasks.filter(t => t.state === 'failed');
    
    return manager;
  }
}

export default QueueManager;
