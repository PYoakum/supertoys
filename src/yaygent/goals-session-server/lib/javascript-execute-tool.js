/**
 * @fileoverview JavaScript Execute Tool for running code in sandboxed environments
 * @module javascript-execute-tool
 */

import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * @typedef {Object} ExecutePermissions
 * @property {boolean} [network=false] - Allow network access
 * @property {'none'|'read'|'write'} [fileSystem='read'] - File system access level
 * @property {string[]} [allowedHosts] - Allowlist of network hosts
 * @property {string[]} [allowedModules] - Allowlist of importable modules
 * @property {string[]} [denyModules] - Denylist of modules
 */

/**
 * @typedef {Object} ExecuteLimits
 * @property {number} [timeout=30000] - Execution timeout in milliseconds
 * @property {number} [memory=512] - Memory limit in MB
 * @property {number} [outputSize=1048576] - Maximum output size in bytes
 */

/**
 * Default denied modules for security
 */
const DEFAULT_DENY_MODULES = [
  'child_process',
  'cluster',
  'dgram',
  'dns',
  'net',
  'tls',
  'worker_threads',
  'vm'
];

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  timeout: 30000,
  memory: 512,
  outputSize: 1024 * 1024 // 1MB
};

/**
 * Maximum allowed limits
 */
const MAX_LIMITS = {
  timeout: 300000, // 5 minutes
  memory: 2048,    // 2GB
  outputSize: 10 * 1024 * 1024 // 10MB
};

/**
 * JavaScript Execute Tool
 */
export class JavaScriptExecuteTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for JavaScriptExecuteTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {Object} */
    this.runtimes = {
      node: config.nodePath || 'node',
      bun: config.bunPath || 'bun',
      workerd: config.workerdPath || 'npx miniflare'
    };

    /** @type {boolean} */
    this.nodeEnabled = config.nodeEnabled !== false;

    /** @type {boolean} */
    this.bunEnabled = config.bunEnabled !== false;

    /** @type {boolean} */
    this.workerdEnabled = config.workerdEnabled !== false;
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      runtime = 'node',
      code,
      entryPoint,
      args: scriptArgs = [],
      env = {},
      permissions = {},
      limits = {},
      input = {},
      options = {}
    } = args;

    // Validate runtime
    if (!['node', 'bun', 'workerd'].includes(runtime)) {
      throw new Error(`Invalid runtime: ${runtime}. Valid options: node, bun, workerd`);
    }

    if (!code && !entryPoint) {
      throw new Error('Either code or entryPoint is required');
    }

    // Check runtime availability
    await this.checkRuntimeAvailable(runtime);

    // Prepare execution
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const execDir = join(sandboxPath, '.exec', randomUUID());
    await mkdir(execDir, { recursive: true });

    // Resolve limits within bounds
    const effectiveLimits = this.resolveLimits(limits);
    const effectivePermissions = this.resolvePermissions(permissions);

    // Create execution script
    const scriptPath = await this.prepareScript(execDir, {
      code,
      entryPoint,
      sandboxPath,
      runtime,
      permissions: effectivePermissions,
      options
    });

    try {
      // Execute based on runtime
      let result;
      switch (runtime) {
        case 'node':
          result = await this.executeNode(scriptPath, {
            args: scriptArgs,
            env,
            limits: effectiveLimits,
            permissions: effectivePermissions,
            input,
            sandboxPath,
            execDir
          });
          break;
        case 'bun':
          result = await this.executeBun(scriptPath, {
            args: scriptArgs,
            env,
            limits: effectiveLimits,
            permissions: effectivePermissions,
            input,
            sandboxPath,
            execDir
          });
          break;
        case 'workerd':
          result = await this.executeWorkerd(scriptPath, {
            args: scriptArgs,
            env,
            limits: effectiveLimits,
            permissions: effectivePermissions,
            input,
            sandboxPath,
            execDir
          });
          break;
      }

      return this.formatResponse({
        success: true,
        runtime,
        ...result
      });
    } finally {
      // Cleanup execution directory
      try {
        const { rm } = await import('fs/promises');
        await rm(execDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Check if runtime is available
   * @param {string} runtime
   */
  async checkRuntimeAvailable(runtime) {
    const checks = {
      node: async () => {
        if (!this.nodeEnabled) throw new Error('Node.js runtime is disabled');
        return this.checkCommand('node', ['--version']);
      },
      bun: async () => {
        if (!this.bunEnabled) throw new Error('Bun runtime is disabled');
        return this.checkCommand('bun', ['--version']);
      },
      workerd: async () => {
        if (!this.workerdEnabled) throw new Error('Workerd runtime is disabled');
        // Workerd availability is checked at execution time
        return true;
      }
    };

    try {
      await checks[runtime]();
    } catch (err) {
      const error = new Error(`Runtime '${runtime}' is not available: ${err.message}`);
      error.code = 'RUNTIME_UNAVAILABLE';
      throw error;
    }
  }

  /**
   * Check if a command is available
   * @param {string} cmd
   * @param {string[]} args
   * @returns {Promise<boolean>}
   */
  checkCommand(cmd, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { timeout: 5000 });
      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve(true);
        else reject(new Error(`Command exited with code ${code}`));
      });
    });
  }

  /**
   * Resolve limits within allowed bounds
   * @param {ExecuteLimits} limits
   * @returns {ExecuteLimits}
   */
  resolveLimits(limits) {
    return {
      timeout: Math.min(limits.timeout || DEFAULT_LIMITS.timeout, MAX_LIMITS.timeout),
      memory: Math.min(limits.memory || DEFAULT_LIMITS.memory, MAX_LIMITS.memory),
      outputSize: Math.min(limits.outputSize || DEFAULT_LIMITS.outputSize, MAX_LIMITS.outputSize)
    };
  }

  /**
   * Resolve permissions with defaults
   * @param {ExecutePermissions} permissions
   * @returns {ExecutePermissions}
   */
  resolvePermissions(permissions) {
    return {
      network: permissions.network || false,
      fileSystem: permissions.fileSystem || 'read',
      allowedHosts: permissions.allowedHosts || [],
      allowedModules: permissions.allowedModules || [],
      denyModules: permissions.denyModules || DEFAULT_DENY_MODULES
    };
  }

  /**
   * Prepare execution script with wrapper
   * @param {string} execDir
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async prepareScript(execDir, options) {
    const { code, entryPoint, sandboxPath, runtime, permissions, options: execOptions } = options;

    let scriptContent;

    if (code) {
      // Wrap inline code
      scriptContent = this.wrapCode(code, {
        runtime,
        permissions,
        options: execOptions
      });
    } else {
      // Load from entry point
      const entryPath = join(sandboxPath, entryPoint);
      if (!existsSync(entryPath)) {
        throw new Error(`Entry point not found: ${entryPoint}`);
      }
      // Create a wrapper that imports the entry point
      scriptContent = this.createEntryWrapper(entryPath, {
        runtime,
        permissions,
        options: execOptions
      });
    }

    const scriptPath = join(execDir, runtime === 'workerd' ? 'worker.js' : 'script.mjs');
    await writeFile(scriptPath, scriptContent, 'utf-8');

    return scriptPath;
  }

  /**
   * Wrap code with security and capture logic
   * @param {string} code
   * @param {Object} options
   * @returns {string}
   */
  wrapCode(code, options) {
    const { runtime, permissions, options: execOptions } = options;

    if (runtime === 'workerd') {
      return this.wrapWorkerdCode(code, options);
    }

    // Node.js / Bun wrapper
    return `
// Auto-generated execution wrapper
import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname } from 'path';

// Provide require() for CommonJS compatibility in ES modules
const __filename = __fileURLToPath(import.meta.url);
const __dirnameVal = __dirname(__filename);
const require = __createRequire(import.meta.url);

// Make __dirname and __filename available (CommonJS compatibility)
globalThis.__filename = __filename;
globalThis.__dirname = __dirnameVal;

const __startTime = Date.now();
const __consoleLogs = [];
const __originalConsole = { ...console };

// Capture console output
['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
  console[level] = (...args) => {
    __consoleLogs.push({
      level,
      args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)),
      timestamp: Date.now()
    });
    __originalConsole[level](...args);
  };
});

// Module restriction (basic)
${permissions.denyModules?.length ? `
const __deniedModules = ${JSON.stringify(permissions.denyModules)};
const __originalRequire = require;
globalThis.require = (id) => {
  if (__deniedModules.some(m => id === m || id.startsWith(m + '/'))) {
    throw new Error('Module not allowed: ' + id);
  }
  return __originalRequire(id);
};
` : ''}

// User code execution
let __result;
let __error;

try {
  __result = await (async () => {
${code}
  })();
} catch (e) {
  __error = { name: e.name, message: e.message, stack: e.stack };
}

// Output results
const __output = {
  execution: {
    duration: Date.now() - __startTime,
    timedOut: false
  },
  output: {
    console: __consoleLogs,
    returnValue: __error ? undefined : __result
  },
  error: __error
};

console.log('\\n__EXEC_RESULT__' + JSON.stringify(__output) + '__END_EXEC_RESULT__');
`;
  }

  /**
   * Wrap code for Workerd/Cloudflare Workers
   * @param {string} code
   * @param {Object} options
   * @returns {string}
   */
  wrapWorkerdCode(code, options) {
    return `
export default {
  async fetch(request) {
    const __startTime = Date.now();
    const __consoleLogs = [];

    // Capture console
    const __origConsole = { ...console };
    ['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
      console[level] = (...args) => {
        __consoleLogs.push({
          level,
          args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)),
          timestamp: Date.now()
        });
      };
    });

    let __result;
    let __error;

    try {
      __result = await (async () => {
${code}
      })();
    } catch (e) {
      __error = { name: e.name, message: e.message, stack: e.stack };
    }

    const __output = {
      execution: {
        duration: Date.now() - __startTime,
        timedOut: false
      },
      output: {
        console: __consoleLogs,
        returnValue: __error ? undefined : __result
      },
      error: __error
    };

    return new Response(JSON.stringify(__output), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
`;
  }

  /**
   * Create wrapper for entry point file
   * @param {string} entryPath
   * @param {Object} options
   * @returns {string}
   */
  createEntryWrapper(entryPath, options) {
    const { runtime } = options;

    if (runtime === 'workerd') {
      return `export { default } from '${entryPath}';`;
    }

    return `
import('${entryPath}')
  .then(mod => {
    console.log('__EXEC_RESULT__' + JSON.stringify({
      execution: { duration: 0, timedOut: false },
      output: { returnValue: mod.default || mod }
    }) + '__END_EXEC_RESULT__');
  })
  .catch(e => {
    console.log('__EXEC_RESULT__' + JSON.stringify({
      error: { name: e.name, message: e.message, stack: e.stack }
    }) + '__END_EXEC_RESULT__');
  });
`;
  }

  /**
   * Execute with Node.js
   * @param {string} scriptPath
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async executeNode(scriptPath, options) {
    const { args, env, limits, input, sandboxPath } = options;

    const nodeArgs = [
      '--experimental-vm-modules',
      `--max-old-space-size=${limits.memory}`,
      scriptPath,
      ...args
    ];

    return this.spawnAndCapture('node', nodeArgs, {
      env: { ...process.env, ...env },
      cwd: sandboxPath,
      timeout: limits.timeout,
      maxOutput: limits.outputSize,
      stdin: input.stdin
    });
  }

  /**
   * Execute with Bun
   * @param {string} scriptPath
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async executeBun(scriptPath, options) {
    const { args, env, limits, input, sandboxPath } = options;

    const bunArgs = [
      'run',
      scriptPath,
      ...args
    ];

    return this.spawnAndCapture('bun', bunArgs, {
      env: { ...process.env, ...env },
      cwd: sandboxPath,
      timeout: limits.timeout,
      maxOutput: limits.outputSize,
      stdin: input.stdin
    });
  }

  /**
   * Execute with Workerd/Miniflare
   * @param {string} scriptPath
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async executeWorkerd(scriptPath, options) {
    const { env, limits, sandboxPath, execDir } = options;

    // Create miniflare config
    const configPath = join(execDir, 'wrangler.toml');
    await writeFile(configPath, `
name = "sandbox-worker"
main = "${scriptPath}"
compatibility_date = "2024-01-01"
`, 'utf-8');

    // Use miniflare to run the worker and make a request to it
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          execution: { exitCode: -1, duration: limits.timeout, timedOut: true },
          output: { stdout: '', stderr: 'Execution timed out' }
        });
      }, limits.timeout);

      // Start miniflare
      const proc = spawn('npx', ['miniflare', '--script', scriptPath, '--port', '0'], {
        cwd: execDir,
        env: { ...process.env, ...env }
      });

      let stdout = '';
      let stderr = '';
      let port = null;

      proc.stdout.on('data', data => {
        stdout += data.toString();
        // Look for port in output
        const match = stdout.match(/Ready on http:\/\/[^:]+:(\d+)/);
        if (match && !port) {
          port = match[1];
          // Make request to worker
          fetch(`http://localhost:${port}`)
            .then(res => res.json())
            .then(result => {
              clearTimeout(timeout);
              proc.kill();
              resolve({
                execution: {
                  exitCode: 0,
                  duration: result.execution?.duration || 0,
                  timedOut: false
                },
                output: result.output || {},
                error: result.error
              });
            })
            .catch(err => {
              clearTimeout(timeout);
              proc.kill();
              reject(err);
            });
        }
      });

      proc.stderr.on('data', data => {
        stderr += data.toString();
      });

      proc.on('error', err => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.on('close', code => {
        clearTimeout(timeout);
        if (!port) {
          resolve({
            execution: { exitCode: code, duration: 0, timedOut: false },
            output: { stdout, stderr },
            error: stderr ? { message: stderr } : undefined
          });
        }
      });
    });
  }

  /**
   * Spawn process and capture output
   * @param {string} cmd
   * @param {string[]} args
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  spawnAndCapture(cmd, args, options) {
    const { env, cwd, timeout, maxOutput, stdin } = options;

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(cmd, args, {
        env,
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      // Write stdin if provided
      if (stdin) {
        proc.stdin.write(stdin);
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }

      proc.stdout.on('data', data => {
        if (stdout.length < maxOutput) {
          stdout += data.toString();
        }
      });

      proc.stderr.on('data', data => {
        if (stderr.length < maxOutput) {
          stderr += data.toString();
        }
      });

      proc.on('error', err => {
        clearTimeout(timeoutId);
        resolve({
          execution: {
            exitCode: -1,
            duration: Date.now() - startTime,
            timedOut: false
          },
          output: { stdout, stderr: err.message },
          error: { name: 'SpawnError', message: err.message }
        });
      });

      proc.on('close', code => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        // Parse result from output
        const resultMatch = stdout.match(/__EXEC_RESULT__(.+)__END_EXEC_RESULT__/s);

        if (resultMatch) {
          try {
            const parsed = JSON.parse(resultMatch[1]);
            resolve({
              execution: {
                exitCode: code,
                duration: parsed.execution?.duration || duration,
                timedOut
              },
              output: {
                stdout: stdout.replace(/__EXEC_RESULT__.+__END_EXEC_RESULT__/s, '').trim(),
                stderr,
                console: parsed.output?.console || [],
                returnValue: parsed.output?.returnValue
              },
              error: parsed.error
            });
            return;
          } catch (e) {
            // Fall through to default handling
          }
        }

        resolve({
          execution: {
            exitCode: code,
            duration,
            timedOut
          },
          output: { stdout, stderr },
          error: code !== 0 ? { message: stderr || `Process exited with code ${code}` } : undefined
        });
      });
    });
  }

  /**
   * Format response in MCP-compatible format
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
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'javascript_execute',
      this.execute.bind(this),
      {
        name: 'javascript_execute',
        description: 'Execute JavaScript code in a sandboxed environment. Supports Node.js, Bun, and Workerd (Cloudflare Workers) runtimes.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional)'
            },
            runtime: {
              type: 'string',
              enum: ['node', 'bun', 'workerd'],
              default: 'node',
              description: 'JavaScript runtime to use'
            },
            code: {
              type: 'string',
              description: 'JavaScript code to execute (alternative to entryPoint)'
            },
            entryPoint: {
              type: 'string',
              description: 'Path to entry file in sandbox (alternative to code)'
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Command-line arguments passed to script'
            },
            env: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Environment variables'
            },
            permissions: {
              type: 'object',
              description: 'Security permissions',
              properties: {
                network: {
                  type: 'boolean',
                  default: false,
                  description: 'Allow network access'
                },
                fileSystem: {
                  type: 'string',
                  enum: ['none', 'read', 'write'],
                  default: 'read',
                  description: 'File system access level (within sandbox)'
                },
                allowedHosts: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Allowlist of network hosts'
                },
                denyModules: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Denylist of modules'
                }
              }
            },
            limits: {
              type: 'object',
              description: 'Resource limits',
              properties: {
                timeout: {
                  type: 'integer',
                  minimum: 100,
                  maximum: 300000,
                  default: 30000,
                  description: 'Execution timeout in milliseconds'
                },
                memory: {
                  type: 'integer',
                  minimum: 16,
                  maximum: 2048,
                  default: 512,
                  description: 'Memory limit in MB'
                },
                outputSize: {
                  type: 'integer',
                  default: 1048576,
                  description: 'Maximum output size in bytes'
                }
              }
            },
            input: {
              type: 'object',
              properties: {
                stdin: {
                  type: 'string',
                  description: 'Data provided via stdin'
                },
                globals: {
                  type: 'object',
                  description: 'Global variables (not yet implemented)'
                }
              }
            },
            options: {
              type: 'object',
              properties: {
                typescript: {
                  type: 'boolean',
                  default: false,
                  description: 'Enable TypeScript (Bun native)'
                },
                captureConsole: {
                  type: 'boolean',
                  default: true,
                  description: 'Capture console output'
                }
              }
            }
          },
          required: []
        }
      }
    );
  }
}

/**
 * Create a JavaScriptExecuteTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {JavaScriptExecuteTool}
 */
export function createJavaScriptExecuteTool(sandboxManager, config) {
  return new JavaScriptExecuteTool(sandboxManager, config);
}

export default JavaScriptExecuteTool;
