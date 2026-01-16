/**
 * @fileoverview Framework Execution Tool for Bun Runtime
 * @module framework-exec-tool
 *
 * Specialized tool for running framework commands using Bun.
 * Replaces generic bash_command for common dev operations.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  timeout: 120000,        // 2 minutes
  outputSize: 1024 * 1024 // 1MB
};

/**
 * Maximum allowed limits
 */
const MAX_LIMITS = {
  timeout: 600000,        // 10 minutes
  outputSize: 10 * 1024 * 1024 // 10MB
};

/**
 * Predefined framework actions
 */
const FRAMEWORK_ACTIONS = {
  // Development
  'dev': {
    description: 'Start development server',
    commands: {
      default: ['bun', 'run', 'dev'],
      svelte: ['bun', 'run', 'dev'],
      next: ['bun', 'run', 'dev'],
      vite: ['bun', 'run', 'dev'],
      react: ['bun', 'run', 'start']
    }
  },
  'start': {
    description: 'Start production server',
    commands: {
      default: ['bun', 'run', 'start'],
      next: ['bun', 'run', 'start'],
      svelte: ['bun', 'run', 'preview']
    }
  },
  'build': {
    description: 'Build for production',
    commands: {
      default: ['bun', 'run', 'build']
    }
  },
  'test': {
    description: 'Run tests',
    commands: {
      default: ['bun', 'test'],
      vitest: ['bun', 'run', 'test'],
      jest: ['bun', 'run', 'test']
    }
  },
  'install': {
    description: 'Install dependencies',
    commands: {
      default: ['bun', 'install']
    }
  },
  'add': {
    description: 'Add a dependency',
    commands: {
      default: ['bun', 'add']  // package name appended
    }
  },
  'remove': {
    description: 'Remove a dependency',
    commands: {
      default: ['bun', 'remove']  // package name appended
    }
  },
  'lint': {
    description: 'Run linter',
    commands: {
      default: ['bun', 'run', 'lint']
    }
  },
  'format': {
    description: 'Format code',
    commands: {
      default: ['bun', 'run', 'format'],
      prettier: ['bunx', 'prettier', '--write', '.']
    }
  },
  'typecheck': {
    description: 'Run type checking',
    commands: {
      default: ['bun', 'run', 'typecheck'],
      tsc: ['bunx', 'tsc', '--noEmit']
    }
  },
  'create': {
    description: 'Create new project from template',
    commands: {
      svelte: ['bunx', 'sv', 'create'],
      next: ['bunx', 'create-next-app'],
      vite: ['bunx', 'create-vite'],
      react: ['bunx', 'create-react-app']
    }
  },
  'run-script': {
    description: 'Run a custom package.json script',
    commands: {
      default: ['bun', 'run']  // script name appended
    }
  }
};

/**
 * Framework Execution Tool
 */
export class FrameworkExecTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for FrameworkExecTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {number} */
    this.defaultTimeout = config.timeout || DEFAULT_LIMITS.timeout;
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      action,
      framework,
      projectDir = '',
      scriptName,
      packages = [],
      extraArgs = [],
      env = {},
      timeout = this.defaultTimeout,
      background = false
    } = args;

    // Validate required fields
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!action) {
      return this.formatError('action is required (e.g., dev, build, test, install)');
    }

    // Get action config
    const actionConfig = FRAMEWORK_ACTIONS[action];
    if (!actionConfig) {
      const validActions = Object.keys(FRAMEWORK_ACTIONS).join(', ');
      return this.formatError(`Unknown action: ${action}. Valid actions: ${validActions}`);
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const cwd = projectDir ? join(sandboxPath, projectDir) : sandboxPath;

    // Ensure working directory exists
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true, mode: 0o755 });
    }

    // Detect framework if not specified
    const detectedFramework = framework || await this.detectFramework(cwd);

    // Build command
    const command = this.buildCommand(action, detectedFramework, {
      scriptName,
      packages,
      extraArgs
    });

    if (!command) {
      return this.formatError(`Cannot build command for action: ${action}`);
    }

    // Clamp timeout
    const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

    try {
      const result = await this.runCommand({
        command,
        cwd,
        env: {
          ...env,
          SANDBOX_PATH: sandboxPath,
          // Bun-specific env vars
          BUN_INSTALL: process.env.BUN_INSTALL || join(process.env.HOME || '/tmp', '.bun'),
          FORCE_COLOR: '0',
          CI: 'true'
        },
        timeout: effectiveTimeout,
        background
      });

      return this.formatResponse({
        success: result.exitCode === 0,
        action,
        framework: detectedFramework || 'default',
        command: command.join(' '),
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        timedOut: result.timedOut || false,
        sandboxPath,
        projectDir: cwd
      });
    } catch (err) {
      return this.formatError(`Execution failed: ${err.message}`);
    }
  }

  /**
   * Detect framework from package.json
   * @param {string} dir
   * @returns {Promise<string|null>}
   */
  async detectFramework(dir) {
    try {
      const pkgPath = join(dir, 'package.json');
      if (!existsSync(pkgPath)) return null;

      const content = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Check for known frameworks
      if (deps['@sveltejs/kit'] || deps['svelte']) return 'svelte';
      if (deps['next']) return 'next';
      if (deps['vite']) return 'vite';
      if (deps['react-scripts']) return 'react';
      if (deps['vitest']) return 'vitest';
      if (deps['jest']) return 'jest';

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Build command array for action
   * @param {string} action
   * @param {string|null} framework
   * @param {Object} options
   * @returns {string[]|null}
   */
  buildCommand(action, framework, options = {}) {
    const { scriptName, packages = [], extraArgs = [] } = options;
    const actionConfig = FRAMEWORK_ACTIONS[action];

    if (!actionConfig) return null;

    // Get command for framework, fallback to default
    let cmd = actionConfig.commands[framework] || actionConfig.commands.default;
    if (!cmd) return null;

    // Clone to avoid mutation
    cmd = [...cmd];

    // Handle special actions that need additional args
    switch (action) {
      case 'add':
      case 'remove':
        if (packages.length === 0) {
          return null; // Need at least one package
        }
        cmd.push(...packages);
        break;

      case 'run-script':
        if (!scriptName) {
          return null; // Need script name
        }
        cmd.push(scriptName);
        break;

      case 'create':
        // For create commands, extra args are the project name etc
        break;
    }

    // Add any extra args
    if (extraArgs.length > 0) {
      cmd.push(...extraArgs);
    }

    return cmd;
  }

  /**
   * Run command
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async runCommand(options) {
    const { command, cwd, env, timeout, background } = options;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Merge environment
      const mergedEnv = {
        ...process.env,
        ...env,
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}:/usr/local/bin:/usr/bin:/bin`,
        HOME: process.env.HOME || '/tmp',
        TERM: 'xterm-256color'
      };

      const [cmd, ...args] = command;

      const proc = spawn(cmd, args, {
        cwd,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: background
      });

      // For background processes, don't wait
      if (background) {
        proc.unref();
        resolve({
          exitCode: 0,
          stdout: `Process started in background (PID: ${proc.pid})`,
          stderr: '',
          duration: Date.now() - startTime,
          timedOut: false,
          pid: proc.pid
        });
        return;
      }

      // Timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      // Capture stdout
      proc.stdout.on('data', (data) => {
        if (stdout.length < MAX_LIMITS.outputSize) {
          stdout += data.toString();
        }
      });

      // Capture stderr
      proc.stderr.on('data', (data) => {
        if (stderr.length < MAX_LIMITS.outputSize) {
          stderr += data.toString();
        }
      });

      // Handle completion
      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        resolve({
          exitCode: code ?? (timedOut ? 137 : 1),
          stdout: stdout.slice(0, MAX_LIMITS.outputSize),
          stderr: stderr.slice(0, MAX_LIMITS.outputSize),
          duration,
          timedOut
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          duration,
          timedOut: false
        });
      });
    });
  }

  /**
   * Format success response
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * Format error response
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message })
        }
      ],
      isError: true
    };
  }

  /**
   * Register tools with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'framework_exec',
      this.execute.bind(this),
      {
        name: 'framework_exec',
        description: `Execute framework commands using Bun runtime. Supports common development operations like dev server, build, test, install dependencies. Auto-detects framework from package.json. Actions: ${Object.keys(FRAMEWORK_ACTIONS).join(', ')}`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            action: {
              type: 'string',
              enum: Object.keys(FRAMEWORK_ACTIONS),
              description: 'Action to perform: dev (start dev server), build (production build), test (run tests), install (install deps), add/remove (manage deps), lint, format, typecheck, create (new project), run-script (custom script)'
            },
            framework: {
              type: 'string',
              enum: ['svelte', 'next', 'vite', 'react', 'vitest', 'jest'],
              description: 'Framework type (auto-detected if not specified)'
            },
            projectDir: {
              type: 'string',
              description: 'Project directory relative to sandbox root'
            },
            scriptName: {
              type: 'string',
              description: 'Script name for run-script action'
            },
            packages: {
              type: 'array',
              items: { type: 'string' },
              description: 'Package names for add/remove actions'
            },
            extraArgs: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional arguments to pass to the command'
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Additional environment variables'
            },
            timeout: {
              type: 'integer',
              default: 120000,
              description: 'Execution timeout in milliseconds (max 600000)'
            },
            background: {
              type: 'boolean',
              default: false,
              description: 'Run process in background (for dev servers)'
            }
          },
          required: ['sessionId', 'action']
        }
      }
    );
  }
}

/**
 * Create a FrameworkExecTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {FrameworkExecTool}
 */
export function createFrameworkExecTool(sandboxManager, config) {
  return new FrameworkExecTool(sandboxManager, config);
}

export default FrameworkExecTool;
