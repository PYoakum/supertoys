/**
 * @fileoverview Progress Display for CLI output
 * @module progress-display
 */

/**
 * Progress Display class
 */
export class ProgressDisplay {
  /**
   * @param {Object} [options={}]
   * @param {boolean} [options.verbose=false]
   */
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.startTime = Date.now();
  }

  /**
   * Print header
   * @param {string} sessionId
   */
  printHeader(sessionId) {
    console.log(`
Action Plan Service v1.0.0
══════════════════════════════════════════════════════════════════════

Session: ${sessionId}
`);
  }

  /**
   * Print queue status
   * @param {Object} metrics
   */
  printQueueStatus(metrics) {
    console.log(`Tasks: ${metrics.totalTasks} total, ${metrics.completedCount} completed, ${metrics.failedCount} failed
Status: Running
`);
  }

  /**
   * Print separator
   */
  printSeparator() {
    console.log('──────────────────────────────────────────────────────────────────────');
  }

  /**
   * Print task start
   * @param {Object} task
   * @param {number} current
   * @param {number} total
   */
  printTaskStart(task, current, total) {
    this.printSeparator();
    console.log(`[${current}/${total}] Executing: ${task.title}`);
    console.log(`      Tool: ${task.tool.toolName}`);
    console.log(`      Status: ⏳ In Progress...`);
  }

  /**
   * Print task execution complete
   * @param {number} durationSec
   */
  printExecutionComplete(durationSec) {
    console.log(`\n      ✅ Execution complete (${durationSec.toFixed(1)}s)`);
  }

  /**
   * Print evaluation result
   * @param {boolean} success
   */
  printEvaluationResult(success) {
    if (success) {
      console.log(`      ✅ Evaluation passed`);
    } else {
      console.log(`      ❌ Evaluation failed`);
    }
  }

  /**
   * Print progress bar
   * @param {number} percent
   */
  printProgress(percent) {
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    console.log(`      Progress: ${bar} ${percent.toFixed(1)}%`);
  }

  /**
   * Print task error
   * @param {Error} error
   */
  printTaskError(error) {
    console.log(`\n      ❌ Error: ${error.message}`);
    if (this.verbose && error.details) {
      console.log(`      Details: ${JSON.stringify(error.details)}`);
    }
  }

  /**
   * Print completion summary
   * @param {Object} metrics
   * @param {string} bundlePath
   */
  printCompletion(metrics, bundlePath) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    
    console.log(`
══════════════════════════════════════════════════════════════════════
Execution Complete!

Summary:
  ${metrics.failedCount === 0 ? '✅' : '❌'} Tasks Completed: ${metrics.completedCount}/${metrics.totalTasks}
  ⏱️  Total Duration: ${duration}s
  ${bundlePath ? `📁 Bundle Created: ${bundlePath}` : ''}

══════════════════════════════════════════════════════════════════════
`);
  }

  /**
   * Print failure summary
   * @param {Object} metrics
   * @param {string} reason
   */
  printFailure(metrics, reason) {
    console.log(`
══════════════════════════════════════════════════════════════════════
Execution Failed!

Reason: ${reason}

Summary:
  ✅ Tasks Completed: ${metrics.completedCount}/${metrics.totalTasks}
  ❌ Tasks Failed: ${metrics.failedCount}
  ⏱️  Total Duration: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s

══════════════════════════════════════════════════════════════════════
`);
  }

  /**
   * Print abort message
   */
  printAbort() {
    console.log(`
══════════════════════════════════════════════════════════════════════
Execution Aborted!

Partial state has been saved.

══════════════════════════════════════════════════════════════════════
`);
  }

  /**
   * Print verbose message
   * @param {string} message
   */
  verbose(message) {
    if (this.verbose) {
      console.log(`[VERBOSE] ${message}`);
    }
  }

  /**
   * Print info message
   * @param {string} message
   */
  info(message) {
    console.log(`[INFO] ${message}`);
  }

  /**
   * Print error message
   * @param {string} message
   */
  error(message) {
    console.error(`[ERROR] ${message}`);
  }
}

export default ProgressDisplay;
