/**
 * @fileoverview Queue Manager for task queue state and execution order
 * @module queue-manager
 */

/**
 * Extract dependency ID from various formats
 * @param {*} dep - Dependency in any format
 * @returns {string}
 */
function extractDepId(dep) {
  if (typeof dep === 'string') return dep;
  if (typeof dep === 'number') return String(dep);
  if (dep && typeof dep === 'object') {
    if (dep.taskId) return extractDepId(dep.taskId);
    if (dep.id) return extractDepId(dep.id);
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
   */
  constructor(sessionId, tasks) {
    this.sessionId = sessionId;
    
    // Sort tasks by sequence number
    const sortedTasks = [...tasks].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
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
        totalTokenUsage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      }
    };
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
