/**
 * @fileoverview Output Eval CLI Runner
 * @module tui/services/output-eval-runner
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Runner for output-eval CLI
 */
export class OutputEvalRunner {
  /**
   * @param {Object} options
   * @param {string} [options.cliPath] - Path to output-eval CLI
   * @param {string} [options.outputDir='./evaluation-output'] - Default output directory
   * @param {Object} [options.env] - Environment variables
   */
  constructor(options = {}) {
    this.cliPath = options.cliPath || resolve(__dirname, '../../../output-eval/output-eval.js');
    this.outputDir = options.outputDir || './evaluation-output';
    this.env = options.env || {};
    this.currentProcess = null;
    this.running = false;
  }

  /**
   * Parse log line to extract level and message
   * @param {string} line
   * @returns {{level: string, message: string}}
   * @private
   */
  _parseLogLine(line) {
    if (line.includes('Error:') || line.includes('⚠️')) {
      return { level: 'error', message: line };
    }
    if (line.includes('Warning:')) {
      return { level: 'warn', message: line };
    }
    if (line.includes('✅') || line.includes('Complete')) {
      return { level: 'success', message: line };
    }
    if (line.includes('⏳')) {
      return { level: 'info', message: line };
    }
    return { level: 'info', message: line };
  }

  /**
   * Run output-eval on a bundle
   * @param {string} bundlePath - Path to session bundle
   * @param {Object} [options]
   * @param {string} [options.format='all'] - Output format: markdown, json, all
   * @param {boolean} [options.verbose=false] - Verbose logging
   * @param {string} [options.output] - Output directory
   * @param {boolean} [options.noLearnings=false] - Skip learnings document
   * @param {boolean} [options.noRecommendations=false] - Skip recommendations
   * @param {boolean} [options.runInBackground=false] - Run in background
   * @param {Function} [options.onLog] - Log callback (level, message)
   * @param {Function} [options.onComplete] - Completion callback (success, result)
   * @returns {Promise<{success: boolean, exitCode: number, output: string, scores?: Object}>}
   */
  async run(bundlePath, options = {}) {
    if (this.running && !options.runInBackground) {
      throw new Error('Output eval is already running');
    }

    const args = ['--bundle', bundlePath];

    if (options.format) {
      args.push('--format', options.format);
    }
    if (options.verbose) {
      args.push('--verbose');
    }
    if (options.output || this.outputDir) {
      args.push('--output', options.output || this.outputDir);
    }
    if (options.noLearnings) {
      args.push('--no-learnings');
    }
    if (options.noRecommendations) {
      args.push('--no-recommendations');
    }

    const env = {
      ...process.env,
      ...this.env,
      ...options.env
    };

    if (options.runInBackground) {
      // Spawn detached process
      const proc = spawn('node', [this.cliPath, ...args], {
        env,
        cwd: process.cwd(),
        stdio: 'ignore',
        detached: true
      });

      proc.unref();

      return {
        success: true,
        background: true,
        pid: proc.pid,
        exitCode: null,
        output: ''
      };
    }

    this.running = true;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const proc = spawn('node', [this.cliPath, ...args], {
        env,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = proc;
      let output = '';
      let scores = null;

      const processLine = (line) => {
        output += line + '\n';

        // Try to extract scores from output
        const overallMatch = line.match(/Overall:\s*(\d+)\/100\s*\(([A-F])\s*-/);
        if (overallMatch) {
          scores = {
            overall: parseInt(overallMatch[1], 10),
            grade: overallMatch[2]
          };
        }

        // Extract individual scores
        const scoreMatch = line.match(/(Task Completion|Output Quality|Tool Utilization|Goal Alignment|Process Efficiency):\s*(\d+)\/100/);
        if (scoreMatch && scores) {
          const key = scoreMatch[1].toLowerCase().replace(/\s+/g, '_');
          scores[key] = parseInt(scoreMatch[2], 10);
        }

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
          scores,
          durationMs: Date.now() - startTime
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
   * Abort current execution
   */
  abort() {
    if (this.currentProcess) {
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

export default OutputEvalRunner;
