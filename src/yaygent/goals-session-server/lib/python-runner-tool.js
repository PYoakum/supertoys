/**
 * @fileoverview Python Runner Tool for executing Python code in sandboxed environments
 * @module python-runner-tool
 */

import { writeFile, unlink, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
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
 * Modules that are blocked for security by default
 */
const DEFAULT_BLOCKED_MODULES = [
  'subprocess',
  'os.system',
  'os.popen',
  'os.spawn',
  'commands',
  'pty',
  'ctypes',
  '__builtins__.__import__'
];

/**
 * Python Runner Tool
 */
export class PythonRunnerTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for PythonRunnerTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {string} */
    this.pythonPath = config.pythonPath || 'python3';

    /** @type {string[]} */
    this.blockedModules = config.blockedModules || DEFAULT_BLOCKED_MODULES;

    /** @type {string[]} */
    this.allowedModules = config.allowedModules || null; // null = all allowed (except blocked)

    /** @type {boolean} */
    this.allowNetworkAccess = config.allowNetworkAccess === true;

    /** @type {boolean} */
    this.allowFileWrite = config.allowFileWrite !== false;

    /** @type {string[]} */
    this.pipPackages = config.pipPackages || []; // Pre-approved packages
  }

  /**
   * Main entry point - run Python code
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      code,
      filePath,
      args: scriptArgs = [],
      env = {},
      workingDir,
      timeout = DEFAULT_LIMITS.timeout,
      pythonVersion,
      installPackages = [],
      inputData
    } = args;

    // Validate input
    if (!code && !filePath) {
      return this.formatError('Either code or filePath is required');
    }

    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const cwd = workingDir ? join(sandboxPath, workingDir) : sandboxPath;

    // Ensure working directory exists
    if (!existsSync(cwd)) {
      await mkdir(cwd, { recursive: true });
    }

    // Determine Python executable
    const pythonExe = pythonVersion ? `python${pythonVersion}` : this.pythonPath;

    // Install requested packages if any
    if (installPackages.length > 0) {
      const installResult = await this.installPackages(installPackages, sandboxPath, pythonExe);
      if (!installResult.success) {
        return this.formatError(`Failed to install packages: ${installResult.error}`);
      }
    }

    // Get the code to run
    let pythonCode = code;
    let scriptPath = null;

    if (filePath) {
      // Read from file in sandbox
      const fullPath = join(sandboxPath, filePath);
      if (!existsSync(fullPath)) {
        return this.formatError(`File not found: ${filePath}`);
      }
      pythonCode = await readFile(fullPath, 'utf-8');
    }

    // Security check
    const securityCheck = this.checkSecurity(pythonCode);
    if (!securityCheck.allowed) {
      return this.formatError(`Security violation: ${securityCheck.reason}`);
    }

    // Write code to temp file
    scriptPath = join(sandboxPath, `.tmp-script-${randomUUID()}.py`);
    await writeFile(scriptPath, pythonCode);

    // Clamp timeout
    const effectiveTimeout = Math.min(timeout, MAX_LIMITS.timeout);

    try {
      const result = await this.runPython({
        scriptPath,
        args: scriptArgs,
        cwd,
        env: {
          ...env,
          PYTHONPATH: sandboxPath,
          SANDBOX_PATH: sandboxPath,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUNBUFFERED: '1'
        },
        timeout: effectiveTimeout,
        pythonExe,
        inputData
      });

      return this.formatResponse({
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        timedOut: result.timedOut || false
      });
    } finally {
      // Cleanup temp script
      if (scriptPath) {
        await unlink(scriptPath).catch(() => {});
      }
    }
  }

  /**
   * Install pip packages in the sandbox
   * @param {string[]} packages
   * @param {string} sandboxPath
   * @param {string} pythonExe
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async installPackages(packages, sandboxPath, pythonExe) {
    // Filter to only allowed packages if configured
    const filteredPackages = this.pipPackages.length > 0
      ? packages.filter(p => this.pipPackages.includes(p.split('==')[0].split('[')[0]))
      : packages;

    if (filteredPackages.length === 0) {
      return { success: true };
    }

    return new Promise((resolve) => {
      const venvPath = join(sandboxPath, '.venv');

      // Create venv if it doesn't exist
      const createVenv = !existsSync(venvPath);

      const setupCommands = createVenv
        ? `${pythonExe} -m venv ${venvPath} && ${venvPath}/bin/pip install ${filteredPackages.join(' ')}`
        : `${venvPath}/bin/pip install ${filteredPackages.join(' ')}`;

      const proc = spawn('/bin/bash', ['-c', setupCommands], {
        cwd: sandboxPath,
        timeout: 120000 // 2 minutes for package install
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr || `Exit code: ${code}` });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Check Python code for security issues
   * @param {string} code
   * @returns {{allowed: boolean, reason?: string}}
   */
  checkSecurity(code) {
    // Check for blocked module imports
    for (const blocked of this.blockedModules) {
      // Check various import patterns
      const patterns = [
        new RegExp(`import\\s+${blocked.replace('.', '\\.')}`, 'i'),
        new RegExp(`from\\s+${blocked.replace('.', '\\.')}\\s+import`, 'i'),
        new RegExp(`__import__\\s*\\(\\s*['"]${blocked.replace('.', '\\.')}['"]`, 'i')
      ];

      for (const pattern of patterns) {
        if (pattern.test(code)) {
          return { allowed: false, reason: `Blocked module: ${blocked}` };
        }
      }
    }

    // Check for dangerous eval/exec patterns
    if (/eval\s*\(\s*input/i.test(code)) {
      return { allowed: false, reason: 'eval(input()) is not allowed' };
    }

    // Check for compile() with exec
    if (/compile\s*\(.*\)\s*.*exec/i.test(code)) {
      return { allowed: false, reason: 'compile() with exec is not allowed' };
    }

    return { allowed: true };
  }

  /**
   * Run Python script
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async runPython(options) {
    const { scriptPath, args, cwd, env, timeout, pythonExe, inputData } = options;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Check for venv and use it if available
      const venvPython = join(cwd, '.venv', 'bin', 'python');
      const actualPython = existsSync(venvPython) ? venvPython : pythonExe;

      const proc = spawn(actualPython, [scriptPath, ...args], {
        cwd,
        env: { ...process.env, ...env },
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
      'python_runner',
      this.execute.bind(this),
      {
        name: 'python_runner',
        description: 'Execute Python code in an isolated sandbox. Supports inline code or script files, package installation, virtual environments, and stdin input.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            code: {
              type: 'string',
              description: 'Python code to execute (alternative to filePath)'
            },
            filePath: {
              type: 'string',
              description: 'Path to Python file in sandbox (alternative to code)'
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command-line arguments to pass to the script'
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
            pythonVersion: {
              type: 'string',
              description: 'Python version to use (e.g., "3.11")'
            },
            installPackages: {
              type: 'array',
              items: { type: 'string' },
              description: 'Pip packages to install before running (e.g., ["requests", "pandas==2.0.0"])'
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
 * Create a PythonRunnerTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {PythonRunnerTool}
 */
export function createPythonRunnerTool(sandboxManager, config) {
  return new PythonRunnerTool(sandboxManager, config);
}

export default PythonRunnerTool;
