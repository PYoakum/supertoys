/**
 * @fileoverview Action Plan Runner - Spawns and manages action-plan processes
 * @module action-plan-runner
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @typedef {Object} ActionPlanRunnerConfig
 * @property {boolean} enabled - Whether action-plan integration is enabled
 * @property {string} executablePath - Path to action-plan.js
 * @property {string} outputDir - Output directory for action-plan
 * @property {boolean} runInBackground - Run in background without waiting
 * @property {string[]} additionalArgs - Additional CLI arguments
 * @property {number} timeoutMs - Execution timeout
 */

/**
 * @typedef {Object} ActionPlanResult
 * @property {boolean} success - Whether action-plan completed successfully
 * @property {string} sessionId - Session ID that was processed
 * @property {number} [exitCode] - Process exit code
 * @property {string} [output] - Combined stdout/stderr output
 * @property {string} [error] - Error message if failed
 * @property {number} [durationMs] - Execution duration
 * @property {boolean} [background] - Whether running in background
 * @property {number} [pid] - Process ID if running in background
 */

/**
 * Action Plan Runner class
 */
export class ActionPlanRunner {
  /**
   * @param {ActionPlanRunnerConfig} config
   * @param {Object} [logger] - Logger instance
   */
  constructor(config, logger = null) {
    this.enabled = config.enabled !== false;
    this.executablePath = config.executablePath;
    this.outputDir = config.outputDir;
    this.runInBackground = config.runInBackground || false;
    this.additionalArgs = config.additionalArgs || [];
    this.timeoutMs = config.timeoutMs || 300000;
    this.logger = logger;

    // Resolve executable path relative to goal-keeper directory
    if (!this.executablePath.startsWith('/')) {
      this.executablePath = resolve(__dirname, '..', this.executablePath);
    }

    // Track background processes
    this.backgroundProcesses = new Map();
  }

  /**
   * Log a message
   * @param {string} level
   * @param {string} message
   * @param {Object} [data]
   * @private
   */
  log(level, message, data = null) {
    if (this.logger && this.logger[level]) {
      this.logger[level](message, data);
    }
  }

  /**
   * Check if action-plan executable exists
   * @returns {boolean}
   */
  isAvailable() {
    if (!this.enabled) return false;
    return existsSync(this.executablePath);
  }

  /**
   * Run action-plan for a session
   * @param {string} sessionId - Session ID to process
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<ActionPlanResult>}
   */
  async run(sessionId, options = {}) {
    if (!this.enabled) {
      return {
        success: false,
        sessionId,
        error: 'Action Plan integration is disabled'
      };
    }

    if (!this.isAvailable()) {
      return {
        success: false,
        sessionId,
        error: `Action Plan executable not found: ${this.executablePath}`
      };
    }

    const startTime = Date.now();
    const args = this.buildArgs(sessionId, options);

    this.log('info', `Starting action-plan for session: ${sessionId}`);
    this.log('debug', 'Action-plan command', {
      executable: this.executablePath,
      args
    });

    if (this.runInBackground || options.background) {
      return this.runBackground(sessionId, args);
    }

    return this.runForeground(sessionId, args, startTime);
  }

  /**
   * Build command line arguments
   * @param {string} sessionId
   * @param {Object} options
   * @returns {string[]}
   * @private
   */
  buildArgs(sessionId, options = {}) {
    const args = [
      '--session', sessionId,
      '--output', options.outputDir || this.outputDir
    ];

    // Add verbose flag if requested
    if (options.verbose) {
      args.push('--verbose');
    }

    // Add any additional configured args
    args.push(...this.additionalArgs);

    // Add any runtime additional args
    if (options.additionalArgs) {
      args.push(...options.additionalArgs);
    }

    return args;
  }

  /**
   * Run action-plan in foreground (wait for completion)
   * @param {string} sessionId
   * @param {string[]} args
   * @param {number} startTime
   * @returns {Promise<ActionPlanResult>}
   * @private
   */
  runForeground(sessionId, args, startTime) {
    return new Promise((resolve) => {
      let output = '';
      let timedOut = false;

      const proc = spawn('bun', ['run', this.executablePath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.timeoutMs);

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        this.log('error', `Action-plan process error: ${err.message}`);
        resolve({
          success: false,
          sessionId,
          error: err.message,
          output,
          durationMs: Date.now() - startTime
        });
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          this.log('error', `Action-plan timed out after ${this.timeoutMs}ms`);
          resolve({
            success: false,
            sessionId,
            exitCode: code,
            error: `Process timed out after ${this.timeoutMs}ms`,
            output,
            durationMs
          });
          return;
        }

        const success = code === 0;
        if (success) {
          this.log('info', `Action-plan completed successfully (${durationMs}ms)`);
        } else {
          this.log('error', `Action-plan failed with exit code ${code}`);
        }

        resolve({
          success,
          sessionId,
          exitCode: code,
          output,
          durationMs
        });
      });
    });
  }

  /**
   * Run action-plan in background (don't wait for completion)
   * @param {string} sessionId
   * @param {string[]} args
   * @returns {Promise<ActionPlanResult>}
   * @private
   */
  runBackground(sessionId, args) {
    return new Promise((resolve) => {
      const proc = spawn('bun', ['run', this.executablePath, ...args], {
        stdio: 'ignore',
        detached: true,
        env: { ...process.env }
      });

      proc.unref();

      // Track the background process
      this.backgroundProcesses.set(sessionId, {
        pid: proc.pid,
        startedAt: new Date().toISOString()
      });

      this.log('info', `Action-plan started in background (PID: ${proc.pid})`);

      resolve({
        success: true,
        sessionId,
        background: true,
        pid: proc.pid
      });
    });
  }

  /**
   * Get status of background processes
   * @returns {Object}
   */
  getBackgroundProcesses() {
    return Object.fromEntries(this.backgroundProcesses);
  }

  /**
   * Check if a background process is still running
   * @param {string} sessionId
   * @returns {boolean}
   */
  isRunning(sessionId) {
    const proc = this.backgroundProcesses.get(sessionId);
    if (!proc) return false;

    try {
      // Send signal 0 to check if process exists
      process.kill(proc.pid, 0);
      return true;
    } catch {
      // Process doesn't exist
      this.backgroundProcesses.delete(sessionId);
      return false;
    }
  }
}

export default ActionPlanRunner;
