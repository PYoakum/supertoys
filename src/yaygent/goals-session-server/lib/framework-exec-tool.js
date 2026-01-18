/**
 * @fileoverview Framework Execution Tool for Bun Runtime
 * @module framework-exec-tool
 *
 * Specialized tool for running framework commands using Bun.
 * Replaces generic bash_command for common dev operations.
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';

/**
 * Default dev server port
 */
const DEFAULT_DEV_PORT = 5173;

/**
 * Kill any process listening on the specified port
 * @param {number} port - Port number to free up
 * @returns {Object} Result with killed PIDs
 */
function killProcessOnPort(port) {
  try {
    // Use lsof to find ALL processes on the port (IPv4 and IPv6)
    const lsofOutput = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: 'utf-8' }).trim();

    if (!lsofOutput) {
      return { killed: [], message: `Port ${port} is free` };
    }

    // Get unique PIDs
    const pids = [...new Set(lsofOutput.split('\n').filter(p => p.trim()))];
    const killed = [];

    for (const pid of pids) {
      try {
        // Kill the process group to ensure child processes are also killed
        execSync(`kill -9 -${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`);
        killed.push(parseInt(pid, 10));
      } catch (e) {
        // Try regular kill if process group kill fails
        try {
          execSync(`kill -9 ${pid} 2>/dev/null || true`);
          killed.push(parseInt(pid, 10));
        } catch (e2) {
          // Ignore - process may have already exited
        }
      }
    }

    // Double-check and force kill any remaining
    try {
      const remaining = execSync(`lsof -i :${port} -t 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
      if (remaining) {
        const remainingPids = remaining.split('\n').filter(p => p.trim());
        for (const pid of remainingPids) {
          execSync(`kill -9 ${pid} 2>/dev/null || true`);
          if (!killed.includes(parseInt(pid, 10))) {
            killed.push(parseInt(pid, 10));
          }
        }
      }
    } catch (e) {
      // Ignore
    }

    return { killed, message: `Killed ${killed.length} process(es) on port ${port}` };
  } catch (err) {
    return { killed: [], error: err.message };
  }
}

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
  },
  'validate-structure': {
    description: 'Validate framework directory structure',
    commands: null,  // Handled specially, not a shell command
    internal: true
  },
  'reconcile-structure': {
    description: 'Fix framework directory structure issues',
    commands: null,  // Handled specially, not a shell command
    internal: true
  }
};

/**
 * Expected directory structures for framework validation
 * @type {Object.<string, Object>}
 */
const FRAMEWORK_STRUCTURES = {
  svelte: {
    requiredDirs: ['src', 'src/routes'],
    optionalDirs: ['src/lib', 'static'],
    requiredFiles: ['package.json', 'svelte.config.js'],
    optionalFiles: ['vite.config.js', 'vite.config.ts', 'tsconfig.json'],
    entryPoints: ['src/routes/+page.svelte', 'src/routes/+layout.svelte'],
    configFiles: ['svelte.config.js', 'svelte.config.ts'],
    // Common misplacements from scaffolding tools
    misplacements: {
      // Files that might end up in root instead of src/routes
      '+page.svelte': 'src/routes/+page.svelte',
      '+layout.svelte': 'src/routes/+layout.svelte',
      '+error.svelte': 'src/routes/+error.svelte',
      // Files that might end up in src instead of src/routes
      'src/+page.svelte': 'src/routes/+page.svelte',
      'src/+layout.svelte': 'src/routes/+layout.svelte',
      // Config files that might be nested incorrectly
      'src/svelte.config.js': 'svelte.config.js',
      'src/vite.config.js': 'vite.config.js'
    }
  },
  next: {
    requiredDirs: [],  // Either app/ or pages/ is valid
    optionalDirs: ['app', 'pages', 'public', 'src/app', 'src/pages'],
    requiredFiles: ['package.json'],
    optionalFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts', 'tsconfig.json'],
    entryPoints: ['app/page.tsx', 'app/page.jsx', 'pages/index.tsx', 'pages/index.jsx', 'src/app/page.tsx', 'src/pages/index.tsx'],
    configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    misplacements: {
      'page.tsx': 'app/page.tsx',
      'page.jsx': 'app/page.jsx',
      'layout.tsx': 'app/layout.tsx',
      'layout.jsx': 'app/layout.jsx',
      'src/next.config.js': 'next.config.js',
      'src/next.config.mjs': 'next.config.mjs'
    }
  },
  vite: {
    requiredDirs: ['src'],
    optionalDirs: ['public'],
    requiredFiles: ['package.json', 'index.html'],
    optionalFiles: ['vite.config.js', 'vite.config.ts', 'tsconfig.json'],
    entryPoints: ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts'],
    configFiles: ['vite.config.js', 'vite.config.ts'],
    misplacements: {
      'main.jsx': 'src/main.jsx',
      'main.tsx': 'src/main.tsx',
      'main.js': 'src/main.js',
      'App.jsx': 'src/App.jsx',
      'App.tsx': 'src/App.tsx',
      'src/index.html': 'index.html',
      'public/index.html': 'index.html'
    }
  },
  react: {
    requiredDirs: ['src', 'public'],
    optionalDirs: [],
    requiredFiles: ['package.json', 'public/index.html'],
    optionalFiles: ['tsconfig.json'],
    entryPoints: ['src/index.js', 'src/index.jsx', 'src/index.tsx'],
    configFiles: [],  // CRA hides config
    misplacements: {
      'index.js': 'src/index.js',
      'index.jsx': 'src/index.jsx',
      'index.tsx': 'src/index.tsx',
      'App.js': 'src/App.js',
      'App.jsx': 'src/App.jsx',
      'App.tsx': 'src/App.tsx',
      'index.html': 'public/index.html'
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
      background: requestedBackground = false
    } = args;

    // Auto-enable background mode for long-running server actions
    const longRunningActions = ['dev', 'start'];
    const background = longRunningActions.includes(action) ? true : requestedBackground;

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

    // Handle internal actions (validate-structure, reconcile-structure)
    if (actionConfig.internal) {
      return this.handleInternalAction(action, cwd, detectedFramework, sandboxPath);
    }

    // Build command
    const command = this.buildCommand(action, detectedFramework, {
      scriptName,
      packages,
      extraArgs
    });

    if (!command) {
      return this.formatError(`Cannot build command for action: ${action}`);
    }

    // For dev/start actions, kill any existing process on the dev port first
    let portCleanupResult = null;
    if (longRunningActions.includes(action)) {
      portCleanupResult = killProcessOnPort(DEFAULT_DEV_PORT);
      if (portCleanupResult.killed.length > 0) {
        // Give the port a moment to be released
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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

      // For 'create' action, auto-validate and reconcile structure
      let structureInfo = null;
      if (action === 'create' && result.exitCode === 0) {
        const createdFramework = detectedFramework || framework;
        if (createdFramework && FRAMEWORK_STRUCTURES[createdFramework]) {
          // Find the created project directory
          const createdDir = await this.findCreatedProject(cwd, extraArgs);

          if (createdDir) {
            // Run validation
            const validation = await this.validateStructure(createdDir, createdFramework);

            if (!validation.valid && validation.canReconcile) {
              // Auto-reconcile if possible
              const reconciliation = await this.reconcileStructure(createdDir, createdFramework);
              structureInfo = {
                validated: true,
                reconciled: true,
                reconciliation,
                projectDir: createdDir
              };
            } else {
              structureInfo = {
                validated: true,
                reconciled: false,
                validation,
                projectDir: createdDir
              };
            }

            // List key files to help LLM understand the structure
            structureInfo.keyFiles = await this.listKeyFiles(createdDir);
            structureInfo.relativePath = createdDir.replace(sandboxPath, '').replace(/^\//, '');
          }
        }
      }

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
        background,
        backgroundAutoEnabled: longRunningActions.includes(action) && !requestedBackground,
        pid: result.pid,
        sandboxPath,
        projectDir: cwd,
        ...(structureInfo && { structureInfo }),
        ...(portCleanupResult?.killed?.length > 0 && {
          portCleanup: {
            port: DEFAULT_DEV_PORT,
            killedPids: portCleanupResult.killed
          }
        })
      });
    } catch (err) {
      return this.formatError(`Execution failed: ${err.message}`);
    }
  }

  /**
   * Handle internal actions (validate-structure, reconcile-structure)
   * @param {string} action
   * @param {string} cwd
   * @param {string|null} framework
   * @param {string} sandboxPath
   * @returns {Promise<Object>}
   */
  async handleInternalAction(action, cwd, framework, sandboxPath) {
    if (!framework) {
      return this.formatError('framework is required for structure validation. Auto-detection requires package.json.');
    }

    if (!FRAMEWORK_STRUCTURES[framework]) {
      return this.formatError(`No structure definition for framework: ${framework}. Supported: ${Object.keys(FRAMEWORK_STRUCTURES).join(', ')}`);
    }

    if (action === 'validate-structure') {
      const validation = await this.validateStructure(cwd, framework);
      const scan = await this.scanForMisplacements(cwd, framework);

      return this.formatResponse({
        success: validation.valid,
        action,
        framework,
        validation,
        deepScan: scan,
        sandboxPath,
        projectDir: cwd
      });
    }

    if (action === 'reconcile-structure') {
      const reconciliation = await this.reconcileStructure(cwd, framework);

      return this.formatResponse({
        success: reconciliation.success,
        action,
        framework,
        reconciliation,
        sandboxPath,
        projectDir: cwd
      });
    }

    return this.formatError(`Unknown internal action: ${action}`);
  }

  /**
   * Find created project directory after 'create' action
   * @param {string} parentDir
   * @param {string[]} extraArgs - Command args that may contain project name
   * @returns {Promise<string|null>}
   */
  async findCreatedProject(parentDir, extraArgs) {
    // Check if a project name was passed in extraArgs
    // Common patterns: 'my-project', '.', etc.
    for (const arg of extraArgs) {
      if (!arg.startsWith('-') && !arg.startsWith('.')) {
        const potentialDir = join(parentDir, arg);
        if (existsSync(potentialDir) && existsSync(join(potentialDir, 'package.json'))) {
          return potentialDir;
        }
      }
    }

    // If no name found, check if project was created in current dir
    if (existsSync(join(parentDir, 'package.json'))) {
      return parentDir;
    }

    // Look for recently created directories with package.json
    try {
      const entries = await readdir(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subDir = join(parentDir, entry.name);
          if (existsSync(join(subDir, 'package.json'))) {
            return subDir;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return null;
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

      // Check for known frameworks (order matters - more specific first)
      // SvelteKit has @sveltejs/kit, Vite+Svelte has svelte+vite without kit
      if (deps['@sveltejs/kit']) return 'svelte';
      if (deps['next']) return 'next';
      if (deps['react-scripts']) return 'react';
      // Vite check - includes Vite+Svelte, Vite+React, Vite+Vue etc.
      if (deps['vite']) return 'vite';
      // Standalone svelte (rare, usually with vite or kit)
      if (deps['svelte']) return 'vite';  // Assume Vite structure for standalone svelte
      if (deps['vitest']) return 'vitest';
      if (deps['jest']) return 'jest';

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate directory structure for a framework
   * @param {string} dir - Project directory
   * @param {string} framework - Framework name
   * @returns {Promise<Object>} Validation result
   */
  async validateStructure(dir, framework) {
    const structure = FRAMEWORK_STRUCTURES[framework];
    if (!structure) {
      return { valid: true, framework, message: 'No structure definition for framework' };
    }

    const issues = [];
    const suggestions = [];

    // Check required directories
    for (const reqDir of structure.requiredDirs) {
      const fullPath = join(dir, reqDir);
      if (!existsSync(fullPath)) {
        issues.push({ type: 'missing_dir', path: reqDir });
        suggestions.push(`Create directory: ${reqDir}`);
      }
    }

    // Check required files
    for (const reqFile of structure.requiredFiles) {
      const fullPath = join(dir, reqFile);
      if (!existsSync(fullPath)) {
        issues.push({ type: 'missing_file', path: reqFile });
        suggestions.push(`Missing required file: ${reqFile}`);
      }
    }

    // Check for entry points (at least one should exist)
    const hasEntryPoint = structure.entryPoints.some(ep => existsSync(join(dir, ep)));
    if (!hasEntryPoint && structure.entryPoints.length > 0) {
      issues.push({ type: 'missing_entry', paths: structure.entryPoints });
      suggestions.push(`Missing entry point. Expected one of: ${structure.entryPoints.join(', ')}`);
    }

    // Check for misplaced files
    const misplacedFiles = [];
    for (const [wrongPath, correctPath] of Object.entries(structure.misplacements)) {
      const wrongFullPath = join(dir, wrongPath);
      const correctFullPath = join(dir, correctPath);
      if (existsSync(wrongFullPath) && !existsSync(correctFullPath)) {
        misplacedFiles.push({ from: wrongPath, to: correctPath });
        issues.push({ type: 'misplaced_file', from: wrongPath, to: correctPath });
        suggestions.push(`Move ${wrongPath} to ${correctPath}`);
      }
    }

    // Check for config files (at least one should exist)
    const hasConfig = structure.configFiles.length === 0 ||
      structure.configFiles.some(cf => existsSync(join(dir, cf)));
    if (!hasConfig) {
      issues.push({ type: 'missing_config', paths: structure.configFiles });
      suggestions.push(`Missing config file. Expected one of: ${structure.configFiles.join(', ')}`);
    }

    return {
      valid: issues.length === 0,
      framework,
      issues,
      suggestions,
      misplacedFiles,
      canReconcile: misplacedFiles.length > 0 || issues.some(i => i.type === 'missing_dir')
    };
  }

  /**
   * Reconcile directory structure by fixing common issues
   * @param {string} dir - Project directory
   * @param {string} framework - Framework name
   * @returns {Promise<Object>} Reconciliation result
   */
  async reconcileStructure(dir, framework) {
    const validation = await this.validateStructure(dir, framework);

    if (validation.valid) {
      return {
        success: true,
        framework,
        message: 'Structure is already valid',
        actions: []
      };
    }

    const structure = FRAMEWORK_STRUCTURES[framework];
    if (!structure) {
      return {
        success: false,
        framework,
        message: 'No structure definition for framework',
        actions: []
      };
    }

    const actions = [];
    const errors = [];

    // Create missing required directories
    for (const issue of validation.issues) {
      if (issue.type === 'missing_dir') {
        try {
          await mkdir(join(dir, issue.path), { recursive: true });
          actions.push({ type: 'created_dir', path: issue.path });
        } catch (err) {
          errors.push({ type: 'create_dir_failed', path: issue.path, error: err.message });
        }
      }
    }

    // Move misplaced files
    for (const { from, to } of validation.misplacedFiles) {
      try {
        // Ensure target directory exists
        const targetDir = dirname(join(dir, to));
        if (!existsSync(targetDir)) {
          await mkdir(targetDir, { recursive: true });
        }

        // Move the file
        await rename(join(dir, from), join(dir, to));
        actions.push({ type: 'moved_file', from, to });
      } catch (err) {
        errors.push({ type: 'move_failed', from, to, error: err.message });
      }
    }

    // Re-validate after reconciliation
    const postValidation = await this.validateStructure(dir, framework);

    return {
      success: errors.length === 0 && postValidation.valid,
      framework,
      actions,
      errors,
      remainingIssues: postValidation.issues,
      message: errors.length > 0
        ? `Reconciliation completed with ${errors.length} error(s)`
        : postValidation.valid
          ? 'Structure successfully reconciled'
          : `Reconciliation completed but ${postValidation.issues.length} issue(s) remain`
    };
  }

  /**
   * Scan directory recursively for files matching known patterns
   * Useful for finding deeply nested misplacements
   * @param {string} dir - Directory to scan
   * @param {string} framework - Framework name
   * @returns {Promise<Object>} Scan result with found files and suggestions
   */
  async scanForMisplacements(dir, framework) {
    const structure = FRAMEWORK_STRUCTURES[framework];
    if (!structure) {
      return { files: [], suggestions: [] };
    }

    const knownPatterns = Object.keys(structure.misplacements).map(p => basename(p));
    const foundFiles = [];

    const scan = async (currentDir, relativePath = '') => {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scan(join(currentDir, entry.name), entryRelPath);
          } else if (entry.isFile() && knownPatterns.includes(entry.name)) {
            // Check if this file is in the wrong location
            const expectedPath = structure.misplacements[entry.name];
            if (expectedPath && entryRelPath !== expectedPath && !existsSync(join(dir, expectedPath))) {
              foundFiles.push({
                found: entryRelPath,
                expected: expectedPath,
                filename: entry.name
              });
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    };

    await scan(dir);

    return {
      framework,
      files: foundFiles,
      suggestions: foundFiles.map(f => `Move ${f.found} to ${f.expected}`)
    };
  }

  /**
   * List key files in a project directory (for LLM context)
   * @param {string} dir - Project directory
   * @param {number} [maxDepth=3] - Maximum directory depth
   * @returns {Promise<string[]>} Array of relative file paths
   */
  async listKeyFiles(dir, maxDepth = 3) {
    const files = [];
    const importantExtensions = ['.svelte', '.tsx', '.jsx', '.ts', '.js', '.vue', '.json', '.html', '.css'];
    const importantFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
                           'svelte.config.js', 'svelte.config.ts', 'next.config.js', 'next.config.mjs'];

    const scan = async (currentDir, relativePath = '', depth = 0) => {
      if (depth > maxDepth) return;

      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          // Skip node_modules and hidden directories
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

          const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await scan(join(currentDir, entry.name), entryRelPath, depth + 1);
          } else if (entry.isFile()) {
            // Include important files or files with important extensions
            const isImportant = importantFiles.includes(entry.name) ||
                               importantExtensions.some(ext => entry.name.endsWith(ext));
            if (isImportant) {
              files.push(entryRelPath);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    };

    await scan(dir);
    return files.sort();
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
        description: `Execute framework commands using Bun runtime. Supports common development operations like dev server, build, test, install dependencies. Auto-detects framework from package.json. After 'create' action, automatically validates and reconciles directory structure. Actions: ${Object.keys(FRAMEWORK_ACTIONS).join(', ')}`,
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
              description: 'Action to perform: dev (start dev server), build (production build), test (run tests), install (install deps), add/remove (manage deps), lint, format, typecheck, create (new project), run-script (custom script), validate-structure (check directory layout), reconcile-structure (fix directory issues)'
            },
            framework: {
              type: 'string',
              enum: ['svelte', 'next', 'vite', 'react', 'vitest', 'jest'],
              description: 'Framework type (auto-detected if not specified). Required for validate-structure and reconcile-structure actions.'
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
              description: 'Run process in background. Auto-enabled for dev/start actions since they run indefinitely'
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
