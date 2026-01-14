/**
 * @fileoverview Output Eval Runner - Spawns and manages output-eval processes
 * @module output-eval-runner
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @typedef {Object} OutputEvalRunnerConfig
 * @property {boolean} enabled - Whether output-eval integration is enabled
 * @property {string} executablePath - Path to output-eval.js
 * @property {string} outputDir - Output directory for evaluation reports
 * @property {boolean} runInBackground - Run in background without waiting
 * @property {string[]} additionalArgs - Additional CLI arguments
 * @property {number} timeoutMs - Execution timeout
 */

/**
 * @typedef {Object} OutputEvalResult
 * @property {boolean} success - Whether output-eval completed successfully
 * @property {string} bundlePath - Bundle path that was evaluated
 * @property {number} [exitCode] - Process exit code
 * @property {string} [output] - Combined stdout/stderr output
 * @property {string} [error] - Error message if failed
 * @property {number} [durationMs] - Execution duration
 * @property {boolean} [background] - Whether running in background
 * @property {number} [pid] - Process ID if running in background
 */

/**
 * Output Eval Runner class
 */
export class OutputEvalRunner {
  /**
   * @param {OutputEvalRunnerConfig} config
   * @param {Object} [logger] - Logger instance (optional)
   */
  constructor(config, logger = null) {
    this.enabled = config.enabled !== false;
    this.executablePath = config.executablePath;
    this.outputDir = config.outputDir;
    this.runInBackground = config.runInBackground || false;
    this.additionalArgs = config.additionalArgs || [];
    this.timeoutMs = config.timeoutMs || 180000;
    this.logger = logger;

    // Resolve executable path relative to action-plan directory
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
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](message, data);
    } else if (this.logger && typeof this.logger === 'function') {
      this.logger(message);
    }
  }

  /**
   * Check if output-eval executable exists
   * @returns {boolean}
   */
  isAvailable() {
    if (!this.enabled) return false;
    return existsSync(this.executablePath);
  }

  /**
   * Run output-eval for a bundle
   * @param {string} bundlePath - Path to the bundle directory
   * @param {Object} [options={}] - Additional options
   * @returns {Promise<OutputEvalResult>}
   */
  async run(bundlePath, options = {}) {
    if (!this.enabled) {
      return {
        success: false,
        bundlePath,
        error: 'Output Eval integration is disabled'
      };
    }

    if (!this.isAvailable()) {
      return {
        success: false,
        bundlePath,
        error: `Output Eval executable not found: ${this.executablePath}`
      };
    }

    if (!existsSync(bundlePath)) {
      return {
        success: false,
        bundlePath,
        error: `Bundle path does not exist: ${bundlePath}`
      };
    }

    const startTime = Date.now();
    const args = this.buildArgs(bundlePath, options);

    this.log('info', `Starting output-eval for bundle: ${bundlePath}`);
    this.log('debug', 'Output-eval command', {
      executable: this.executablePath,
      args
    });

    if (this.runInBackground || options.background) {
      return this.runBackground(bundlePath, args);
    }

    return this.runForeground(bundlePath, args, startTime);
  }

  /**
   * Build command line arguments
   * @param {string} bundlePath
   * @param {Object} options
   * @returns {string[]}
   * @private
   */
  buildArgs(bundlePath, options = {}) {
    const args = [
      '--bundle', bundlePath,
      '--output', options.outputDir || this.outputDir
    ];

    // Add verbose flag if requested
    if (options.verbose) {
      args.push('--verbose');
    }

    // Add format if specified
    if (options.format) {
      args.push('--format', options.format);
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
   * Run output-eval in foreground (wait for completion)
   * @param {string} bundlePath
   * @param {string[]} args
   * @param {number} startTime
   * @returns {Promise<OutputEvalResult>}
   * @private
   */
  runForeground(bundlePath, args, startTime) {
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
        this.log('error', `Output-eval process error: ${err.message}`);
        resolve({
          success: false,
          bundlePath,
          error: err.message,
          output,
          durationMs: Date.now() - startTime
        });
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        if (timedOut) {
          this.log('error', `Output-eval timed out after ${this.timeoutMs}ms`);
          resolve({
            success: false,
            bundlePath,
            exitCode: code,
            error: `Process timed out after ${this.timeoutMs}ms`,
            output,
            durationMs
          });
          return;
        }

        const success = code === 0;
        if (success) {
          this.log('info', `Output-eval completed successfully (${durationMs}ms)`);
        } else {
          this.log('error', `Output-eval failed with exit code ${code}`);
        }

        resolve({
          success,
          bundlePath,
          exitCode: code,
          output,
          durationMs
        });
      });
    });
  }

  /**
   * Run output-eval in background (don't wait for completion)
   * @param {string} bundlePath
   * @param {string[]} args
   * @returns {Promise<OutputEvalResult>}
   * @private
   */
  runBackground(bundlePath, args) {
    return new Promise((resolve) => {
      const proc = spawn('bun', ['run', this.executablePath, ...args], {
        stdio: 'ignore',
        detached: true,
        env: { ...process.env }
      });

      proc.unref();

      // Track the background process
      this.backgroundProcesses.set(bundlePath, {
        pid: proc.pid,
        startedAt: new Date().toISOString()
      });

      this.log('info', `Output-eval started in background (PID: ${proc.pid})`);

      resolve({
        success: true,
        bundlePath,
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
   * @param {string} bundlePath
   * @returns {boolean}
   */
  isRunning(bundlePath) {
    const proc = this.backgroundProcesses.get(bundlePath);
    if (!proc) return false;

    try {
      // Send signal 0 to check if process exists
      process.kill(proc.pid, 0);
      return true;
    } catch {
      // Process doesn't exist
      this.backgroundProcesses.delete(bundlePath);
      return false;
    }
  }
}

export default OutputEvalRunner;
