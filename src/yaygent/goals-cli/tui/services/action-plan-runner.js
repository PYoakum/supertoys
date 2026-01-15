/**
 * @fileoverview Action Plan CLI Runner
 * @module tui/services/action-plan-runner
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Runner for action-plan CLI
 */
export class ActionPlanRunner {
  /**
   * @param {Object} options
   * @param {string} [options.cliPath] - Path to action-plan CLI
   * @param {string} [options.outputDir='./output'] - Default output directory
   * @param {Object} [options.env] - Environment variables
   */
  constructor(options = {}) {
    this.cliPath = options.cliPath || resolve(__dirname, '../../../action-plan/action-plan.js');
    this.outputDir = options.outputDir || './output';
    this.env = options.env || {};
    this.currentProcess = null;
    this.running = false;
    this.aborted = false;
  }

  /**
   * Parse log line to extract level and message
   * @param {string} line
   * @returns {{level: string, message: string}}
   * @private
   */
  _parseLogLine(line) {
    // Try to extract level markers
    if (line.includes('[ERROR]') || line.includes('Error:')) {
      return { level: 'error', message: line };
    }
    if (line.includes('[WARN]') || line.includes('Warning:')) {
      return { level: 'warn', message: line };
    }
    if (line.includes('[DEBUG]')) {
      return { level: 'debug', message: line };
    }
    if (line.includes('✓') || line.includes('SUCCESS') || line.includes('Complete')) {
      return { level: 'success', message: line };
    }
    return { level: 'info', message: line };
  }

  /**
   * Run action-plan with session ID
   * @param {string} sessionId - Session ID to process
   * @param {Object} [options]
   * @param {boolean} [options.dryRun=false] - Dry run mode
   * @param {boolean} [options.verbose=false] - Verbose logging
   * @param {string} [options.output] - Output directory
   * @param {boolean} [options.noBundle=false] - Skip bundle generation
   * @param {boolean} [options.noEval=false] - Skip output-eval
   * @param {Function} [options.onLog] - Log callback (level, message)
   * @param {Function} [options.onProgress] - Progress callback (current, total)
   * @param {Function} [options.onComplete] - Completion callback (success, result)
   * @returns {Promise<{success: boolean, exitCode: number, output: string}>}
   */
  async run(sessionId, options = {}) {
    if (this.running) {
      throw new Error('Action plan is already running');
    }

    this.running = true;
    this.aborted = false;

    const args = ['--session', sessionId];

    if (options.dryRun) {
      args.push('--dry-run');
    }
    if (options.verbose) {
      args.push('--verbose');
    }
    if (options.output || this.outputDir) {
      args.push('--output', options.output || this.outputDir);
    }
    if (options.noBundle) {
      args.push('--no-bundle');
    }
    if (options.noEval) {
      args.push('--no-eval');
    }

    const env = {
      ...process.env,
      ...this.env,
      ...options.env
    };

    return new Promise((resolve, reject) => {
      const proc = spawn('node', [this.cliPath, ...args], {
        env,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = proc;
      let output = '';
      let currentTask = 0;
      let totalTasks = 0;

      const processLine = (line) => {
        output += line + '\n';

        // Try to extract progress
        const progressMatch = line.match(/\[(\d+)\/(\d+)\]/);
        if (progressMatch) {
          currentTask = parseInt(progressMatch[1], 10);
          totalTasks = parseInt(progressMatch[2], 10);
          if (options.onProgress) {
            options.onProgress(currentTask, totalTasks);
          }
        }

        // Emit log
        if (options.onLog) {
          const parsed = this._parseLogLine(line);
          options.onLog(parsed.level, parsed.message);
        }
      };

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(processLine);
      });

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
          output += line + '\n';
          if (options.onLog) {
            options.onLog('error', line);
          }
        });
      });

      proc.on('close', (code) => {
        this.running = false;
        this.currentProcess = null;

        const success = code === 0;
        const result = {
          success,
          exitCode: code,
          output,
          aborted: this.aborted
        };

        if (options.onComplete) {
          options.onComplete(success, result);
        }

        resolve(result);
      });

      proc.on('error', (err) => {
        this.running = false;
        this.currentProcess = null;

        if (options.onLog) {
          options.onLog('error', `Process error: ${err.message}`);
        }

        reject(err);
      });
    });
  }

  /**
   * Run the next available session
   * @param {Object} [options] - Same options as run()
   * @returns {Promise<{success: boolean, sessionId?: string, exitCode: number, output: string}>}
   */
  async runNext(options = {}) {
    if (this.running) {
      throw new Error('Action plan is already running');
    }

    this.running = true;
    this.aborted = false;

    const args = ['--next'];

    if (options.dryRun) {
      args.push('--dry-run');
    }
    if (options.verbose) {
      args.push('--verbose');
    }
    if (options.output || this.outputDir) {
      args.push('--output', options.output || this.outputDir);
    }

    const env = {
      ...process.env,
      ...this.env,
      ...options.env
    };

    return new Promise((resolve, reject) => {
      const proc = spawn('node', [this.cliPath, ...args], {
        env,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = proc;
      let output = '';
      let sessionId = null;

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
          output += line + '\n';

          // Extract session ID from output
          const sessionMatch = line.match(/session:\s*([a-f0-9-]+)/i);
          if (sessionMatch) {
            sessionId = sessionMatch[1];
          }

          if (options.onLog) {
            const parsed = this._parseLogLine(line);
            options.onLog(parsed.level, parsed.message);
          }
        });
      });

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
          output += line + '\n';
          if (options.onLog) {
            options.onLog('error', line);
          }
        });
      });

      proc.on('close', (code) => {
        this.running = false;
        this.currentProcess = null;

        const success = code === 0;
        resolve({
          success,
          sessionId,
          exitCode: code,
          output,
          aborted: this.aborted
        });
      });

      proc.on('error', (err) => {
        this.running = false;
        this.currentProcess = null;
        reject(err);
      });
    });
  }

  /**
   * List ready sessions
   * @returns {Promise<{success: boolean, sessions: Array, output: string}>}
   */
  async listReady() {
    const args = ['--list'];

    return new Promise((resolve, reject) => {
      const proc = spawn('node', [this.cliPath, ...args], {
        env: { ...process.env, ...this.env },
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      const sessions = [];

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;

        // Parse session IDs from output
        const lines = text.split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (match) {
            sessions.push({ id: match[1] });
          }
        }
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          sessions,
          output
        });
      });

      proc.on('error', reject);
    });
  }

  /**
   * Abort current execution
   */
  abort() {
    if (this.currentProcess) {
      this.aborted = true;
      this.currentProcess.kill('SIGINT');
    }
  }

  /**
   * Check if currently running
   * @returns {boolean}
   */
  isRunning() {
    return this.running;
  }

  /**
   * Set environment variable
   * @param {string} key
   * @param {string} value
   */
  setEnv(key, value) {
    this.env[key] = value;
  }

  /**
   * Get all environment variables
   * @returns {Object}
   */
  getEnv() {
    return { ...this.env };
  }
}

export default ActionPlanRunner;
