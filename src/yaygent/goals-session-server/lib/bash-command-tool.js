/**
 * @fileoverview Bash Command Tool for running shell scripts in sandboxed environments
 * @module bash-command-tool
 */

import { writeFile, unlink, mkdir, readFile, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  timeout: 60000,        // 1 minute
  outputSize: 1024 * 1024 // 1MB
};

/**
 * Maximum allowed limits
 */
const MAX_LIMITS = {
  timeout: 600000,       // 10 minutes
  outputSize: 10 * 1024 * 1024 // 10MB
};

/**
 * Commands that are blocked for security
 */
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=/dev/zero',
  'dd if=/dev/random',
  ':(){ :|:& };:',  // Fork bomb
  'chmod -R 777 /',
  'chown -R',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6'
];

/**
 * Bash Command Tool
 */
export class BashCommandTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for BashCommandTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {string} */
    this.shell = config.shell || '/bin/bash';

    /** @type {boolean} */
    this.allowSudo = config.allowSudo === true;

    /** @type {string[]} */
    this.allowedCommands = config.allowedCommands || null; // null = all allowed (except blocked)

    /** @type {string[]} */
    this.blockedCommands = config.blockedCommands || BLOCKED_COMMANDS;

    /** @type {Object} */
    this.defaultEnv = config.defaultEnv || {};
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      command,
      script,
      args: cmdArgs = [],
      env = {},
      workingDir,
      timeout = DEFAULT_LIMITS.timeout,
      captureStderr = true,
      shell = this.shell
    } = args;

    // Validate input
    if (!command && !script) {
      return this.formatError('Either command or script is required');
    }

    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const cwd = workingDir ? join(sandboxPath, workingDir) : sandboxPath;

    // Ensure working directory exists with proper permissions
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true, mode: 0o755 });
    }

    // Determine what to run
    let scriptPath = null;
    let actualCommand = command;

    if (script) {
      // Write script to temp file with execute permissions
      scriptPath = join(sandboxPath, `.tmp-script-${randomUUID()}.sh`);

      // Add shebang if not present
      let scriptContent = script;
      if (!scriptContent.startsWith('#!')) {
        scriptContent = `#!/bin/bash\nset -e\n${scriptContent}`;
      }

      await writeFile(scriptPath, scriptContent, { mode: 0o755 });

      // Ensure execute permission (in case umask overrides)
      await chmod(scriptPath, 0o755);

      actualCommand = scriptPath;
    }

    // Security check
    const securityCheck = this.checkSecurity(actualCommand, script);
    if (!securityCheck.allowed) {
      if (scriptPath) await unlink(scriptPath).catch(() => {});
      return this.formatError(`Security violation: ${securityCheck.reason}`);
    }

    // Clamp timeout
    const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

    try {
      const result = await this.runCommand({
        command: actualCommand,
        args: cmdArgs,
        cwd,
        env: { ...this.defaultEnv, ...env, SANDBOX_PATH: sandboxPath },
        timeout: effectiveTimeout,
        captureStderr,
        shell
      });

      return this.formatResponse({
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        timedOut: result.timedOut || false,
        sandboxPath,
        workingDir: cwd,
        command: command || '(script)'
      });
    } finally {
      // Cleanup temp script
      if (scriptPath) {
        await unlink(scriptPath).catch(() => {});
      }
    }
  }

  /**
   * Check command/script for security issues
   * @param {string} command
   * @param {string} [script]
   * @returns {{allowed: boolean, reason?: string}}
   */
  checkSecurity(command, script) {
    const content = script || command || '';

    // Check for sudo if not allowed
    if (!this.allowSudo && content.includes('sudo ')) {
      return { allowed: false, reason: 'sudo is not allowed' };
    }

    // Check blocked patterns
    for (const blocked of this.blockedCommands) {
      if (content.includes(blocked)) {
        return { allowed: false, reason: `Blocked command pattern: ${blocked}` };
      }
    }

    // Check allowlist if specified
    if (this.allowedCommands) {
      const cmdName = command.split(/\s+/)[0].split('/').pop();
      if (!this.allowedCommands.includes(cmdName)) {
        return { allowed: false, reason: `Command not in allowlist: ${cmdName}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Run a command
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async runCommand(options) {
    const { command, args, cwd, env, timeout, captureStderr, shell } = options;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Build command string - handle script files vs commands
      const cmdStr = command.endsWith('.sh')
        ? command  // Script file - run directly
        : `${command} ${args.join(' ')}`;

      // Merge environment, ensuring PATH includes common locations
      // Set CI=true to help with non-interactive execution of tools like npm create
      const mergedEnv = {
        ...process.env,
        ...env,
        PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
        HOME: process.env.HOME || '/tmp',
        TERM: 'xterm-256color',
        CI: 'true',
        NPM_CONFIG_YES: 'true',  // npm: auto-accept prompts
        FORCE_COLOR: '0'         // Disable color output for cleaner logs
      };

      // Spawn the process
      const proc = spawn(shell, ['-c', cmdStr], {
        cwd,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });

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
      if (captureStderr) {
        proc.stderr.on('data', (data) => {
          if (stderr.length < MAX_LIMITS.outputSize) {
            stderr += data.toString();
          }
        });
      }

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
      'bash_command',
      this.execute.bind(this),
      {
        name: 'bash_command',
        description: 'Execute bash commands or scripts in an isolated sandbox. Supports running single commands or multi-line scripts with environment variables and working directory control.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            command: {
              type: 'string',
              description: 'Single command to execute (alternative to script)'
            },
            script: {
              type: 'string',
              description: 'Multi-line bash script to execute (alternative to command)'
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Arguments to pass to the command'
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Environment variables to set'
            },
            workingDir: {
              type: 'string',
              description: 'Working directory relative to sandbox root'
            },
            timeout: {
              type: 'integer',
              default: 60000,
              description: 'Execution timeout in milliseconds (max 600000)'
            },
            captureStderr: {
              type: 'boolean',
              default: true,
              description: 'Whether to capture stderr output'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Create a BashCommandTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {BashCommandTool}
 */
export function createBashCommandTool(sandboxManager, config) {
  return new BashCommandTool(sandboxManager, config);
}

export default BashCommandTool;
