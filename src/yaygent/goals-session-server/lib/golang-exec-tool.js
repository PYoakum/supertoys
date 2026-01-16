/**
 * @fileoverview Go Execution Tool for running Go code in sandboxed environments
 * @module golang-exec-tool
 *
 * Executes Go code with sandbox isolation. Supports:
 * - Inline code execution (go run)
 * - File execution from sandbox
 * - Go modules support
 * - Build and run modes
 * - Test execution
 */

import { writeFile, unlink, mkdir, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';
import { randomUUID } from 'crypto';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  timeout: 60000,         // 1 minute
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
 * Packages/imports that are blocked for security
 */
const DEFAULT_BLOCKED_IMPORTS = [
  'os/exec',
  'syscall',
  'unsafe',
  'plugin',
  'runtime/cgo',
  'C'  // CGO
];

/**
 * Go Execution Tool
 */
export class GolangExecTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for GolangExecTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {string} */
    this.goPath = config.goPath || 'go';

    /** @type {string[]} */
    this.blockedImports = config.blockedImports || DEFAULT_BLOCKED_IMPORTS;

    /** @type {boolean} */
    this.allowNetworkAccess = config.allowNetworkAccess === true;

    /** @type {boolean} */
    this.allowCGO = config.allowCGO === true;

    /** @type {string[]} */
    this.allowedModules = config.allowedModules || null; // null = all allowed
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      code,
      filePath,
      action = 'run',
      args: programArgs = [],
      env = {},
      workingDir,
      timeout = DEFAULT_LIMITS.timeout,
      moduleName,
      buildFlags = [],
      testFlags = [],
      inputData
    } = args;

    // Validate input
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!code && !filePath && action !== 'mod-init' && action !== 'mod-tidy') {
      return this.formatError('Either code or filePath is required (except for mod-init/mod-tidy)');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const cwd = workingDir ? join(sandboxPath, workingDir) : sandboxPath;

    // Ensure working directory exists
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true, mode: 0o755 });
    }

    // Route to appropriate action
    switch (action) {
      case 'run':
        return this._runCode(args, sandboxPath, cwd);
      case 'build':
        return this._buildCode(args, sandboxPath, cwd);
      case 'test':
        return this._runTests(args, sandboxPath, cwd);
      case 'mod-init':
        return this._modInit(args, sandboxPath, cwd);
      case 'mod-tidy':
        return this._modTidy(args, sandboxPath, cwd);
      case 'fmt':
        return this._formatCode(args, sandboxPath, cwd);
      case 'vet':
        return this._vetCode(args, sandboxPath, cwd);
      default:
        return this.formatError(`Unknown action: ${action}. Use: run, build, test, mod-init, mod-tidy, fmt, vet`);
    }
  }

  /**
   * Run Go code directly (go run)
   * @private
   */
  async _runCode(args, sandboxPath, cwd) {
    const {
      code,
      filePath,
      args: programArgs = [],
      env = {},
      timeout = DEFAULT_LIMITS.timeout,
      buildFlags = [],
      inputData
    } = args;

    let scriptPath = null;
    let createdFile = false;

    try {
      // Get the code
      let goCode;
      if (code) {
        goCode = code;
        // Write to temp file
        scriptPath = join(cwd, `main_${randomUUID().slice(0, 8)}.go`);
        await writeFile(scriptPath, goCode);
        createdFile = true;
      } else if (filePath) {
        scriptPath = join(sandboxPath, filePath);
        if (!existsSync(scriptPath)) {
          return this.formatError(`File not found: ${filePath}`);
        }
        goCode = await readFile(scriptPath, 'utf-8');
      }

      // Security check
      const securityCheck = this.checkSecurity(goCode);
      if (!securityCheck.allowed) {
        return this.formatError(`Security violation: ${securityCheck.reason}`);
      }

      // Clamp timeout
      const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

      // Build go run command
      const goArgs = ['run', ...buildFlags, scriptPath, ...programArgs];

      const result = await this._executeGo({
        args: goArgs,
        cwd,
        env,
        timeout: effectiveTimeout,
        inputData
      });

      return this.formatResponse({
        success: result.exitCode === 0,
        action: 'run',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        timedOut: result.timedOut || false,
        sandboxPath,
        workingDir: cwd
      });
    } finally {
      // Cleanup temp file
      if (createdFile && scriptPath) {
        await unlink(scriptPath).catch(() => {});
      }
    }
  }

  /**
   * Build Go code (go build)
   * @private
   */
  async _buildCode(args, sandboxPath, cwd) {
    const {
      code,
      filePath,
      outputName,
      buildFlags = [],
      timeout = DEFAULT_LIMITS.timeout
    } = args;

    let scriptPath = null;
    let createdFile = false;

    try {
      // Get the code
      let goCode;
      if (code) {
        goCode = code;
        scriptPath = join(cwd, `main_${randomUUID().slice(0, 8)}.go`);
        await writeFile(scriptPath, goCode);
        createdFile = true;
      } else if (filePath) {
        scriptPath = join(sandboxPath, filePath);
        if (!existsSync(scriptPath)) {
          return this.formatError(`File not found: ${filePath}`);
        }
        goCode = await readFile(scriptPath, 'utf-8');
      }

      // Security check
      const securityCheck = this.checkSecurity(goCode);
      if (!securityCheck.allowed) {
        return this.formatError(`Security violation: ${securityCheck.reason}`);
      }

      // Determine output name
      const output = outputName || 'main';
      const outputPath = join(cwd, output);

      // Clamp timeout
      const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

      // Build go build command
      const goArgs = ['build', '-o', outputPath, ...buildFlags, scriptPath];

      const result = await this._executeGo({
        args: goArgs,
        cwd,
        env: {},
        timeout: effectiveTimeout
      });

      return this.formatResponse({
        success: result.exitCode === 0,
        action: 'build',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        outputPath: result.exitCode === 0 ? output : null,
        sandboxPath,
        workingDir: cwd
      });
    } finally {
      if (createdFile && scriptPath) {
        await unlink(scriptPath).catch(() => {});
      }
    }
  }

  /**
   * Run Go tests (go test)
   * @private
   */
  async _runTests(args, sandboxPath, cwd) {
    const {
      filePath,
      testFlags = [],
      timeout = DEFAULT_LIMITS.timeout,
      verbose = true
    } = args;

    // Determine test target
    const testTarget = filePath ? join(sandboxPath, filePath) : './...';

    // Clamp timeout
    const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

    // Build go test command
    const goArgs = ['test'];
    if (verbose) goArgs.push('-v');
    goArgs.push(...testFlags, testTarget);

    const result = await this._executeGo({
      args: goArgs,
      cwd,
      env: {},
      timeout: effectiveTimeout
    });

    return this.formatResponse({
      success: result.exitCode === 0,
      action: 'test',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      sandboxPath,
      workingDir: cwd
    });
  }

  /**
   * Initialize Go module (go mod init)
   * @private
   */
  async _modInit(args, sandboxPath, cwd) {
    const { moduleName = 'sandbox/app', timeout = DEFAULT_LIMITS.timeout } = args;

    // Check if go.mod already exists
    const goModPath = join(cwd, 'go.mod');
    if (existsSync(goModPath)) {
      return this.formatResponse({
        success: true,
        action: 'mod-init',
        message: 'go.mod already exists',
        moduleName,
        sandboxPath,
        workingDir: cwd
      });
    }

    const result = await this._executeGo({
      args: ['mod', 'init', moduleName],
      cwd,
      env: {},
      timeout: Math.min(timeout, MAX_LIMITS.timeout)
    });

    return this.formatResponse({
      success: result.exitCode === 0,
      action: 'mod-init',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      moduleName,
      sandboxPath,
      workingDir: cwd
    });
  }

  /**
   * Tidy Go modules (go mod tidy)
   * @private
   */
  async _modTidy(args, sandboxPath, cwd) {
    const { timeout = DEFAULT_LIMITS.timeout } = args;

    const result = await this._executeGo({
      args: ['mod', 'tidy'],
      cwd,
      env: {},
      timeout: Math.min(timeout, MAX_LIMITS.timeout)
    });

    return this.formatResponse({
      success: result.exitCode === 0,
      action: 'mod-tidy',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      sandboxPath,
      workingDir: cwd
    });
  }

  /**
   * Format Go code (go fmt)
   * @private
   */
  async _formatCode(args, sandboxPath, cwd) {
    const { filePath, timeout = DEFAULT_LIMITS.timeout } = args;

    const target = filePath ? join(sandboxPath, filePath) : './...';

    const result = await this._executeGo({
      args: ['fmt', target],
      cwd,
      env: {},
      timeout: Math.min(timeout, MAX_LIMITS.timeout)
    });

    return this.formatResponse({
      success: result.exitCode === 0,
      action: 'fmt',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      sandboxPath,
      workingDir: cwd
    });
  }

  /**
   * Vet Go code (go vet)
   * @private
   */
  async _vetCode(args, sandboxPath, cwd) {
    const { filePath, timeout = DEFAULT_LIMITS.timeout } = args;

    const target = filePath ? join(sandboxPath, filePath) : './...';

    const result = await this._executeGo({
      args: ['vet', target],
      cwd,
      env: {},
      timeout: Math.min(timeout, MAX_LIMITS.timeout)
    });

    return this.formatResponse({
      success: result.exitCode === 0,
      action: 'vet',
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      sandboxPath,
      workingDir: cwd
    });
  }

  /**
   * Check Go code for security issues
   * @param {string} code
   * @returns {{allowed: boolean, reason?: string}}
   */
  checkSecurity(code) {
    // Check for blocked imports
    for (const blocked of this.blockedImports) {
      // Match import patterns
      const patterns = [
        new RegExp(`import\\s+"${blocked}"`, 'i'),
        new RegExp(`import\\s+\\w+\\s+"${blocked}"`, 'i'),
        new RegExp(`"${blocked}"`, 'i')  // In import block
      ];

      for (const pattern of patterns) {
        if (pattern.test(code)) {
          // Special case for CGO
          if (blocked === 'C' && !this.allowCGO) {
            return { allowed: false, reason: 'CGO (import "C") is not allowed' };
          } else if (blocked !== 'C') {
            return { allowed: false, reason: `Blocked import: ${blocked}` };
          }
        }
      }
    }

    // Check for inline assembly
    if (/asm\s*\(/.test(code) || /go:linkname/.test(code)) {
      return { allowed: false, reason: 'Inline assembly and go:linkname are not allowed' };
    }

    // Check for go:noescape directive (often used for unsafe operations)
    if (/\/\/go:noescape/.test(code)) {
      return { allowed: false, reason: 'go:noescape directive is not allowed' };
    }

    return { allowed: true };
  }

  /**
   * Execute Go command
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async _executeGo(options) {
    const { args, cwd, env, timeout, inputData } = options;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Environment setup
      const goEnv = {
        ...process.env,
        ...env,
        PATH: `${process.env.PATH}:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin`,
        HOME: process.env.HOME || '/tmp',
        GOPATH: join(cwd, '.gopath'),
        GOCACHE: join(cwd, '.gocache'),
        GOMODCACHE: join(cwd, '.gomodcache'),
        GO111MODULE: 'on',
        CGO_ENABLED: this.allowCGO ? '1' : '0'
      };

      const proc = spawn(this.goPath, args, {
        cwd,
        env: goEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Timeout handler
      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      // Send input data if provided
      if (inputData) {
        proc.stdin.write(inputData);
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }

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
      'golang_exec',
      this.execute.bind(this),
      {
        name: 'golang_exec',
        description: `Execute Go code in an isolated sandbox. Supports multiple actions:

ACTIONS:
- run: Execute Go code directly (go run)
- build: Compile Go code to binary (go build)
- test: Run Go tests (go test)
- mod-init: Initialize Go module (go mod init)
- mod-tidy: Tidy Go module dependencies (go mod tidy)
- fmt: Format Go code (go fmt)
- vet: Run Go vet for static analysis (go vet)

SECURITY:
- Blocked imports: os/exec, syscall, unsafe, plugin, CGO
- No inline assembly or go:linkname
- Sandboxed file system access

WORKFLOW EXAMPLE:
1. action="mod-init" with moduleName="myapp"
2. action="run" with code="package main..."
3. action="build" to compile
4. action="test" to run tests`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            action: {
              type: 'string',
              enum: ['run', 'build', 'test', 'mod-init', 'mod-tidy', 'fmt', 'vet'],
              default: 'run',
              description: 'Action to perform'
            },
            code: {
              type: 'string',
              description: 'Go source code to execute (alternative to filePath)'
            },
            filePath: {
              type: 'string',
              description: 'Path to Go file in sandbox (alternative to code)'
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command-line arguments to pass to the program (for run action)'
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
            moduleName: {
              type: 'string',
              default: 'sandbox/app',
              description: 'Module name for mod-init action'
            },
            outputName: {
              type: 'string',
              description: 'Output binary name for build action'
            },
            buildFlags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional flags for go build/run (e.g., ["-ldflags", "-s -w"])'
            },
            testFlags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional flags for go test (e.g., ["-cover", "-race"])'
            },
            verbose: {
              type: 'boolean',
              default: true,
              description: 'Verbose output for test action'
            },
            inputData: {
              type: 'string',
              description: 'Data to send to stdin'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Create a GolangExecTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {GolangExecTool}
 */
export function createGolangExecTool(sandboxManager, config) {
  return new GolangExecTool(sandboxManager, config);
}

export default GolangExecTool;
