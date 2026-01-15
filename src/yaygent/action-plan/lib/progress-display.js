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
   * @param {Object} [evaluation] - Full evaluation result for verbose output
   */
  printEvaluationResult(success, evaluation = null) {
    if (success) {
      console.log(`      ✅ Evaluation passed`);
    } else {
      console.log(`      ❌ Evaluation failed`);
      // Always show reason summary for failures
      if (evaluation?.reason?.summary) {
        console.log(`      Reason: ${evaluation.reason.summary}`);
      }
      // Show more details in verbose mode
      if (this.verbose && evaluation) {
        if (evaluation.reason?.details) {
          console.log(`      Details: ${evaluation.reason.details}`);
        }
        if (evaluation.issues && evaluation.issues.length > 0) {
          console.log(`      Issues:`);
          evaluation.issues.forEach(issue => {
            console.log(`        - ${issue}`);
          });
        }
        if (evaluation.criteriaUnmatched && evaluation.criteriaUnmatched.length > 0) {
          console.log(`      Unmet criteria:`);
          evaluation.criteriaUnmatched.forEach(c => {
            console.log(`        - ${c}`);
          });
        }
      }
    }
  }

  /**
   * Print tool invocation result (for debugging)
   * @param {Object} toolResult
   */
  printToolResult(toolResult) {
    if (!this.verbose) return;
    console.log(`      Tool result:`);
    console.log(`        Success: ${toolResult.success}`);
    if (toolResult.error) {
      console.log(`        Error: ${toolResult.error}`);
    }
    if (toolResult.result) {
      const resultStr = JSON.stringify(toolResult.result).slice(0, 200);
      console.log(`        Result: ${resultStr}${resultStr.length >= 200 ? '...' : ''}`);
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
   * @param {Object} [evalResult] - Output-eval result
   */
  printCompletion(metrics, bundlePath, evalResult = null) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);

    let evalStatus = '';
    if (evalResult) {
      if (evalResult.background) {
        evalStatus = `\n  📊 Evaluation: Running in background (PID: ${evalResult.pid})`;
      } else if (evalResult.success) {
        evalStatus = `\n  📊 Evaluation: Complete (${(evalResult.durationMs / 1000).toFixed(1)}s)`;
      } else {
        evalStatus = `\n  ⚠️  Evaluation: Failed - ${evalResult.error || 'Unknown error'}`;
      }
    }

    // Show buffer time if any
    let bufferInfo = '';
    if (metrics.totalBufferTimeMs && metrics.totalBufferTimeMs > 0) {
      const bufferSec = (metrics.totalBufferTimeMs / 1000).toFixed(1);
      bufferInfo = `\n  ⏳ Buffer Time: ${bufferSec}s`;
    }

    console.log(`
══════════════════════════════════════════════════════════════════════
Execution Complete!

Summary:
  ${metrics.failedCount === 0 ? '✅' : '❌'} Tasks Completed: ${metrics.completedCount}/${metrics.totalTasks}
  ⏱️  Total Duration: ${duration}s${bufferInfo}
  ${bundlePath ? `📁 Bundle Created: ${bundlePath}` : ''}${evalStatus}

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
