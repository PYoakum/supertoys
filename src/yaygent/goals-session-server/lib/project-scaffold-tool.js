/**
 * @fileoverview Project Scaffold Tool - Create project templates reliably
 * @module project-scaffold-tool
 */

import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  timeout: 300000,  // 5 minutes for project creation
  outputSize: 1024 * 1024
};

/**
 * Supported project types and their configurations
 */
const PROJECT_TYPES = {
  // ============ Frontend Frameworks ============

  react: {
    name: 'React (Vite)',
    description: 'React application with Vite bundler - fast HMR, modern tooling',
    createCommand: (name, opts) => {
      let template = 'react';
      if (opts.typescript && opts.swc) template = 'react-swc-ts';
      else if (opts.typescript) template = 'react-ts';
      else if (opts.swc) template = 'react-swc';
      return {
        runtime: 'bun',
        args: ['create', 'vite@latest', name, '--template', template]
      };
    },
    postCreate: ['bun install']
  },

  next: {
    name: 'Next.js',
    description: 'Next.js React framework - SSR, API routes, App Router',
    createCommand: (name, opts) => {
      // Use bun create (not bunx) for next-app
      const args = ['create', 'next-app@latest', name];
      args.push('--use-bun');
      if (opts.typescript !== false) args.push('--typescript');
      else args.push('--javascript');
      if (opts.tailwind) args.push('--tailwind');
      else args.push('--no-tailwind');
      if (opts.eslint !== false) args.push('--eslint');
      else args.push('--no-eslint');
      if (opts.srcDir) args.push('--src-dir');
      else args.push('--no-src-dir');
      if (opts.appRouter !== false) args.push('--app');
      args.push('--import-alias', opts.importAlias || '@/*');
      return { runtime: 'bun', args };
    },
    postCreate: []
  },

  tanstack: {
    name: 'TanStack Start',
    description: 'TanStack Start - full-stack React framework with TanStack Router',
    createCommand: (name, opts) => ({
      runtime: 'bunx',
      args: ['gitpick', 'TanStack/router/examples/react/start-basic', name]
    }),
    postCreate: ['bun install']
  },

  remix: {
    name: 'Remix',
    description: 'Remix - full-stack React framework with nested routing and data loading',
    createCommand: (name, opts) => {
      const args = ['create-remix@latest', name];
      args.push('--no-git-init');
      args.push('--no-install');
      // Template options: remix, remix-ts, express, express-ts, cloudflare-workers, cloudflare-pages
      if (opts.template) {
        args.push('--template', opts.template);
      }
      return { runtime: 'bunx', args };
    },
    postCreate: ['bun install']
  },

  'tanstack-router': {
    name: 'TanStack Router (Vite)',
    description: 'TanStack Router with Vite - type-safe routing for React',
    createCommand: null,
    files: (name, opts) => ({
      'package.json': JSON.stringify({
        name: name,
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        },
        dependencies: {
          'react': '^18.2.0',
          'react-dom': '^18.2.0',
          '@tanstack/react-router': '^1.0.0',
          '@tanstack/router-devtools': '^1.0.0'
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.2.0',
          'vite': '^5.0.0',
          ...(opts.typescript ? { 'typescript': '^5.0.0', '@types/react': '^18.2.0', '@types/react-dom': '^18.2.0' } : {})
        }
      }, null, 2),
      'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.${opts.typescript ? 'tsx' : 'jsx'}"></script>
  </body>
</html>
`,
      [`src/main.${opts.typescript ? 'tsx' : 'jsx'}`]: `import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree'

const router = createRouter({ routeTree })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
`,
      [`src/routeTree.${opts.typescript ? 'tsx' : 'jsx'}`]: `import { createRootRoute, createRoute } from '@tanstack/react-router'

const rootRoute = createRootRoute({
  component: () => (
    <div>
      <h1>Welcome to TanStack Router</h1>
    </div>
  ),
})

export const routeTree = rootRoute
`,
      '.gitignore': 'node_modules/\ndist/\n.env\n'
    }),
    postCreate: ['bun install']
  },

  astro: {
    name: 'Astro',
    description: 'Astro - content-focused static site builder with islands architecture',
    createCommand: (name, opts) => {
      // Astro templates: basics, blog, docs, minimal, starlight
      const template = opts.template || 'basics';
      return {
        runtime: 'bun',
        args: ['create', 'astro@latest', name, '--', '--template', template, '--no-git', '--no-install', '-y']
      };
    },
    postCreate: ['bun install']
  },

  svelte: {
    name: 'SvelteKit',
    description: 'SvelteKit web application - fast, compiled framework',
    createCommand: (name, opts) => {
      // New sv CLI: bunx sv create <name> --template <type> [options]
      // Templates: minimal, demo, library
      // Map old template names to new ones for compatibility
      const templateMap = { 'skeleton': 'minimal', 'default': 'minimal' };
      const template = templateMap[opts.template] || opts.template || 'minimal';

      const args = ['sv', 'create', name];
      args.push('--template', template);
      // Type checking
      if (opts.typescript) args.push('--types', 'ts');
      else args.push('--no-types');
      // Skip interactive prompts
      args.push('--no-add-ons');
      args.push('--no-install');
      return { runtime: 'bunx', args };
    },
    postCreate: ['bun install']
  },

  vue: {
    name: 'Vue (Vite)',
    description: 'Vue.js application with Vite bundler',
    createCommand: (name, opts) => {
      const template = opts.typescript ? 'vue-ts' : 'vue';
      return {
        runtime: 'bun',
        args: ['create', 'vite@latest', name, '--template', template]
      };
    },
    postCreate: ['bun install']
  },

  // ============ Backend Frameworks ============

  hono: {
    name: 'Hono',
    description: 'Hono - ultrafast web framework for the edge, Cloudflare Workers, Bun',
    createCommand: (name, opts) => {
      // Templates: bun, cloudflare-workers, cloudflare-pages, deno, fastly, lambda, netlify, nodejs, vercel
      // Use bun --bun x to force Bun runtime (avoids Node.js compatibility issues)
      // Send "n" to stdin to skip interactive install prompt
      const template = opts.template || 'bun';
      return {
        runtime: 'bun',
        args: ['--bun', 'x', 'create-hono', name, '--template', template],
        stdinInput: 'n\n'
      };
    },
    postCreate: ['bun install']
  },

  'hono-api': {
    name: 'Hono API',
    description: 'Hono REST API starter with routing and middleware',
    createCommand: null,
    files: (name, opts) => ({
      'package.json': JSON.stringify({
        name: name,
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'bun run --watch src/index.ts',
          start: 'bun run src/index.ts'
        },
        dependencies: {
          'hono': '^4.0.0'
        },
        devDependencies: opts.typescript ? { 'typescript': '^5.0.0', '@types/bun': 'latest' } : {}
      }, null, 2),
      [`src/index.${opts.typescript ? 'ts' : 'js'}`]: `import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())

// Routes
app.get('/', (c) => c.json({ message: 'Hello from Hono!' }))

app.get('/health', (c) => c.json({
  status: 'healthy',
  timestamp: new Date().toISOString()
}))

app.get('/api/users', (c) => c.json({
  users: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' }
  ]
}))

app.post('/api/users', async (c) => {
  const body = await c.req.json()
  return c.json({ created: body }, 201)
})

// 404 handler
app.notFound((c) => c.json({ error: 'Not Found' }, 404))

// Error handler
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch
}
`,
      '.gitignore': 'node_modules/\n.env\n'
    }),
    postCreate: ['bun install']
  },

  express: {
    name: 'Express.js',
    description: 'Express.js web server - minimal, flexible Node.js framework',
    createCommand: null,
    files: (name, opts) => ({
      'package.json': JSON.stringify({
        name: name,
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        scripts: {
          start: 'node index.js',
          dev: 'node --watch index.js'
        },
        dependencies: {
          express: '^4.18.0'
        },
        devDependencies: {}
      }, null, 2),
      'index.js': `import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});
`,
      '.gitignore': 'node_modules/\n.env\n'
    }),
    postCreate: ['bun install']
  },

  // ============ Basic Templates ============

  vanilla: {
    name: 'Vanilla (Vite)',
    description: 'Vanilla JavaScript/TypeScript with Vite',
    createCommand: (name, opts) => {
      const template = opts.typescript ? 'vanilla-ts' : 'vanilla';
      return {
        runtime: 'bun',
        args: ['create', 'vite@latest', name, '--template', template]
      };
    },
    postCreate: ['bun install']
  },

  node: {
    name: 'Node.js',
    description: 'Basic Node.js project with package.json',
    createCommand: null,
    files: (name, opts) => ({
      'package.json': JSON.stringify({
        name: name,
        version: '1.0.0',
        type: 'module',
        main: opts.typescript ? 'dist/index.js' : 'index.js',
        scripts: {
          start: opts.typescript ? 'node dist/index.js' : 'node index.js',
          dev: opts.typescript ? 'tsc --watch' : 'node --watch index.js',
          ...(opts.typescript ? { build: 'tsc' } : {})
        },
        dependencies: {},
        devDependencies: opts.typescript ? { typescript: '^5.0.0', '@types/node': '^20.0.0' } : {}
      }, null, 2),
      [opts.typescript ? 'src/index.ts' : 'index.js']: opts.typescript
        ? 'console.log("Hello from TypeScript!");\n'
        : 'console.log("Hello from Node.js!");\n',
      ...(opts.typescript ? {
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            outDir: './dist',
            rootDir: './src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true
          },
          include: ['src/**/*']
        }, null, 2)
      } : {}),
      '.gitignore': 'node_modules/\ndist/\n.env\n'
    }),
    postCreate: ['bun install']
  },

  bun: {
    name: 'Bun',
    description: 'Bun project with TypeScript',
    createCommand: (name) => ({
      runtime: 'bun',
      args: ['init', '-y']
    }),
    workInDir: true,
    postCreate: []
  }
};

/**
 * Project Scaffold Tool
 */
export class ProjectScaffoldTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for ProjectScaffoldTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {number} */
    this.timeout = config.timeout || DEFAULT_LIMITS.timeout;

    /** @type {string} */
    this.preferredRuntime = config.preferredRuntime || 'bun';
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      projectType,
      name,
      options = {},
      installDependencies = true
    } = args;

    // Validate inputs
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!projectType) {
      return this.formatError(`projectType is required. Available types: ${Object.keys(PROJECT_TYPES).join(', ')}`);
    }

    if (!name) {
      return this.formatError('name is required');
    }

    // Validate project type
    const typeConfig = PROJECT_TYPES[projectType.toLowerCase()];
    if (!typeConfig) {
      return this.formatError(
        `Unknown project type: ${projectType}. Available types: ${Object.keys(PROJECT_TYPES).join(', ')}`
      );
    }

    // Validate project name (safe characters only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return this.formatError('Project name must contain only letters, numbers, hyphens, and underscores');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const projectPath = join(sandboxPath, name);

    // Check if project already exists
    if (existsSync(projectPath)) {
      return this.formatError(`Project directory already exists: ${name}`);
    }

    const startTime = Date.now();
    const logs = [];

    try {
      // Create project directory
      await mkdir(projectPath, { recursive: true, mode: 0o755 });
      logs.push(`Created directory: ${name}`);

      // Method 1: Use create command
      if (typeConfig.createCommand) {
        const cmdConfig = typeConfig.createCommand(name, options);
        const cwd = typeConfig.workInDir ? projectPath : sandboxPath;

        logs.push(`Running: ${cmdConfig.runtime} ${cmdConfig.args.join(' ')}`);

        const result = await this.runCommand(
          cmdConfig.runtime,
          cmdConfig.args,
          cwd,
          cmdConfig.stdinInput || null
        );

        // Check if package.json was created - some tools (like create-next-app) return
        // non-zero exit codes for warnings/post-processing errors while still successfully
        // creating the project
        const packageJsonPath = join(projectPath, 'package.json');
        const hasPackageJson = existsSync(packageJsonPath);

        if (result.exitCode !== 0 && !hasPackageJson) {
          return this.formatError(
            `Project creation failed (exit code ${result.exitCode}): ${result.stderr || result.stdout}`
          );
        }

        if (result.exitCode !== 0 && hasPackageJson) {
          logs.push(`Warning: Command exited with code ${result.exitCode} but project was created`);
          if (result.stderr) {
            logs.push(`stderr: ${result.stderr.slice(0, 300)}`);
          }
        }

        logs.push(`Create command completed (${result.duration}ms)`);
        if (result.stdout) {
          logs.push(`stdout: ${result.stdout.slice(0, 500)}`);
        }
      }
      // Method 2: Manual file creation
      else if (typeConfig.files) {
        const files = typeConfig.files(name, options);

        for (const [filePath, content] of Object.entries(files)) {
          const fullPath = join(projectPath, filePath);
          const dir = join(fullPath, '..');

          if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true, mode: 0o755 });
          }

          await writeFile(fullPath, content);
          logs.push(`Created: ${filePath}`);
        }
      }

      // Patch Vite scripts to use bun runtime (avoids Node.js version issues)
      if (typeConfig.usesVite !== false) {
        const patchResult = await this._patchViteScripts(projectPath);
        if (patchResult.patched) {
          logs.push(`Patched Vite scripts to use bun runtime`);
          patchResult.changes.forEach(change => logs.push(`  ${change}`));
        }
      }

      // Run post-create commands (like bun install)
      if (installDependencies && typeConfig.postCreate && typeConfig.postCreate.length > 0) {
        for (const cmd of typeConfig.postCreate) {
          const [runtime, ...cmdArgs] = cmd.split(' ');
          logs.push(`Running: ${cmd}`);

          const result = await this.runCommand(runtime, cmdArgs, projectPath);

          if (result.exitCode !== 0) {
            logs.push(`Warning: ${cmd} failed (exit code ${result.exitCode})`);
            if (result.stderr) {
              logs.push(`stderr: ${result.stderr.slice(0, 300)}`);
            }
          } else {
            logs.push(`${cmd} completed (${result.duration}ms)`);
          }
        }
      }

      // List created files
      const createdFiles = await this.listFiles(projectPath);
      const duration = Date.now() - startTime;

      return this.formatResponse({
        success: true,
        projectType: typeConfig.name,
        projectPath: name,
        absolutePath: projectPath,
        filesCreated: createdFiles.length,
        files: createdFiles.slice(0, 20),  // First 20 files
        duration,
        logs,
        nextSteps: this.getNextSteps(projectType, name)
      });

    } catch (err) {
      return this.formatError(`Project creation failed: ${err.message}`);
    }
  }

  /**
   * Run a command
   * @param {string} command
   * @param {string[]} args
   * @param {string} cwd
   * @param {string} [inputData] - Optional data to send to stdin
   * @returns {Promise<Object>}
   */
  async runCommand(command, args, cwd, inputData = null) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const env = {
        ...process.env,
        PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
        HOME: process.env.HOME || '/tmp',
        CI: 'true',
        NPM_CONFIG_YES: 'true',
        FORCE_COLOR: '0',
        NO_COLOR: '1'
      };

      const proc = spawn(command, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, this.timeout);

      // Send stdin input if provided, then close stdin
      if (inputData) {
        proc.stdin.write(inputData);
      }
      proc.stdin.end();

      proc.stdout.on('data', (data) => {
        if (stdout.length < DEFAULT_LIMITS.outputSize) {
          stdout += data.toString();
        }
      });

      proc.stderr.on('data', (data) => {
        if (stderr.length < DEFAULT_LIMITS.outputSize) {
          stderr += data.toString();
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: code ?? (timedOut ? 137 : 1),
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration: Date.now() - startTime,
          timedOut
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          duration: Date.now() - startTime,
          timedOut: false
        });
      });
    });
  }

  /**
   * Patch Vite scripts in package.json to use bun runtime
   * This avoids Node.js version compatibility issues
   * @param {string} projectPath
   * @returns {Promise<{patched: boolean, changes: string[]}>}
   */
  async _patchViteScripts(projectPath) {
    const packageJsonPath = join(projectPath, 'package.json');
    const changes = [];

    if (!existsSync(packageJsonPath)) {
      return { patched: false, changes };
    }

    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (!pkg.scripts) {
        return { patched: false, changes };
      }

      let modified = false;

      // Scripts that should use bunx --bun vite
      const viteScriptPatterns = [
        { match: /^vite\s*$/, replace: 'bunx --bun vite', name: 'vite' },
        { match: /^vite dev/, replace: 'bunx --bun vite dev', name: 'vite dev' },
        { match: /^vite build/, replace: 'bunx --bun vite build', name: 'vite build' },
        { match: /^vite preview/, replace: 'bunx --bun vite preview', name: 'vite preview' },
      ];

      for (const [scriptName, scriptValue] of Object.entries(pkg.scripts)) {
        if (typeof scriptValue !== 'string') continue;

        for (const pattern of viteScriptPatterns) {
          if (pattern.match.test(scriptValue)) {
            const newValue = scriptValue.replace(pattern.match, pattern.replace);
            if (newValue !== scriptValue) {
              pkg.scripts[scriptName] = newValue;
              changes.push(`${scriptName}: "${scriptValue}" → "${newValue}"`);
              modified = true;
            }
            break;
          }
        }
      }

      if (modified) {
        await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
      }

      return { patched: modified, changes };
    } catch (err) {
      // Ignore errors - non-critical
      return { patched: false, changes };
    }
  }

  /**
   * List files in a directory recursively
   * @param {string} dir
   * @param {string} [prefix='']
   * @returns {Promise<string[]>}
   */
  async listFiles(dir, prefix = '') {
    const files = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
            files.push(`${relativePath}/`);
          } else {
            const subFiles = await this.listFiles(join(dir, entry.name), relativePath);
            files.push(...subFiles);
          }
        } else {
          files.push(relativePath);
        }
      }
    } catch (err) {
      // Ignore errors
    }
    return files.sort();
  }

  /**
   * Get next steps for a project type
   * @param {string} projectType
   * @param {string} name
   * @returns {string[]}
   */
  getNextSteps(projectType, name) {
    const steps = [`cd ${name}`];

    switch (projectType.toLowerCase()) {
      case 'svelte':
      case 'react':
      case 'vue':
      case 'vanilla':
      case 'astro':
      case 'next':
      case 'tanstack':
      case 'tanstack-router':
      case 'remix':
        steps.push('bun run dev');
        break;
      case 'hono':
      case 'hono-api':
        steps.push('bun run dev');
        break;
      case 'node':
      case 'express':
        steps.push('bun run start');
        break;
      case 'bun':
        steps.push('bun run index.ts');
        break;
      default:
        steps.push('bun run dev');
    }

    return steps;
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
      'create_project_scaffold',
      this.execute.bind(this),
      {
        name: 'create_project_scaffold',
        description: `Create a new project from a template. Supports: ${Object.entries(PROJECT_TYPES).map(([k, v]) => `${k} (${v.description})`).join(', ')}. This tool handles all the scaffolding non-interactively and reliably.`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            projectType: {
              type: 'string',
              enum: Object.keys(PROJECT_TYPES),
              description: `Type of project to create: ${Object.keys(PROJECT_TYPES).join(', ')}`
            },
            name: {
              type: 'string',
              pattern: '^[a-zA-Z0-9_-]+$',
              description: 'Project name (letters, numbers, hyphens, underscores only)'
            },
            options: {
              type: 'object',
              properties: {
                typescript: {
                  type: 'boolean',
                  default: false,
                  description: 'Use TypeScript (where applicable)'
                },
                template: {
                  type: 'string',
                  description: 'Template variant (e.g., "minimal"/"demo"/"library" for Svelte, "basics"/"blog"/"docs" for Astro, "bun"/"cloudflare-workers" for Hono)'
                },
                tailwind: {
                  type: 'boolean',
                  default: false,
                  description: 'Include Tailwind CSS (Next.js)'
                },
                eslint: {
                  type: 'boolean',
                  default: true,
                  description: 'Include ESLint'
                },
                prettier: {
                  type: 'boolean',
                  default: true,
                  description: 'Include Prettier'
                },
                swc: {
                  type: 'boolean',
                  default: false,
                  description: 'Use SWC compiler (React - faster builds)'
                },
                srcDir: {
                  type: 'boolean',
                  default: false,
                  description: 'Use src/ directory (Next.js)'
                },
                appRouter: {
                  type: 'boolean',
                  default: true,
                  description: 'Use App Router (Next.js)'
                },
                importAlias: {
                  type: 'string',
                  default: '@/*',
                  description: 'Import alias pattern (Next.js)'
                }
              },
              description: 'Project-type specific options'
            },
            installDependencies: {
              type: 'boolean',
              default: true,
              description: 'Run dependency installation after scaffolding'
            }
          },
          required: ['sessionId', 'projectType', 'name']
        }
      }
    );
  }
}

/**
 * Create a ProjectScaffoldTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {ProjectScaffoldTool}
 */
export function createProjectScaffoldTool(sandboxManager, config) {
  return new ProjectScaffoldTool(sandboxManager, config);
}

export default ProjectScaffoldTool;
