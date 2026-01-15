/**
 * @fileoverview Execute Tab Screen
 * @module tui/screens/execute-tab
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Menu } from '../components/menu.js';
import { LogViewer } from '../components/log-viewer.js';
import { ProgressBar } from '../components/progress-bar.js';
import { SplitPane } from '../components/split-pane.js';
import { SessionServerClient } from '../services/session-server-client.js';
import { ActionPlanRunner } from '../services/action-plan-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Execute Tab Screen - Session management and workflow execution
 */
export class ExecuteTabScreen {
  /**
   * @param {Object} options
   * @param {Object} [options.state] - Shared state reference
   */
  constructor(options = {}) {
    this.state = options.state || {};

    // Mode: 'dashboard' | 'sessions' | 'session-detail' | 'edit-tasks' | 'running' | 'config'
    this.mode = 'dashboard';

    // Task form editor state
    this.taskScrollOffset = 0;
    this.editTaskIndex = 0;           // Which task is selected
    this.editFieldIndex = 0;          // Which field is selected (0=title, 1=priority, 2=deps, etc.)
    this.editingField = false;        // Currently editing a field value
    this.editFieldValue = '';         // Current edit buffer
    this.editDepMode = false;         // Editing dependencies (multi-select mode)
    this.editDepSelected = new Set(); // Selected dependency task IDs
    this.editToolMode = false;        // Editing tool selection
    this.availableTools = [];         // Cached list of available tools from server
    this.toolNavIndex = 0;            // Navigation index in tool selector
    this.taskFields = ['title', 'description', 'tool', 'priority', 'sequenceNumber', 'dependencies'];

    // Services
    this.sessionClient = new SessionServerClient({
      baseUrl: this.state.serverUrl || 'http://localhost:3000'
    });
    this.actionRunner = new ActionPlanRunner({
      outputDir: this.state.outputDir || './output'
    });

    // Server management
    this.serverProcess = null;
    this.serverRunning = false;
    this.serverPath = resolve(__dirname, '../../../goals-session-server/server.js');

    // Components
    this.dashboardMenu = new Menu({
      title: 'Actions',
      items: [
        'Start Server',
        'Create Session',
        'Prepare Session',
        'List Sessions',
        'Run Next Session',
        'Kill Session',
        'Environment Config',
        'Refresh Status'
      ]
    });

    this.sessionsMenu = new Menu({ title: 'Sessions', items: [] });
    this.logViewer = new LogViewer({ maxLines: 500 });  // Increased for verbose dependency output
    this.progressBar = new ProgressBar({ width: 40 });

    // State
    this.sessions = [];
    this.selectedSession = null;
    this.serverStatus = { connected: false, uptime: 0 };
    this.executionProgress = { current: 0, total: 0 };
    this.focused = false;

    // Provider configurations
    this.providers = {
      anthropic: {
        endpoint: 'https://api.anthropic.com/v1/messages',
        defaultModel: 'claude-sonnet-4-20250514',
        keyEnvVar: 'ANTHROPIC_API_KEY'
      },
      openai: {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        defaultModel: 'gpt-4o',
        keyEnvVar: 'OPENAI_API_KEY'
      },
      custom: {
        endpoint: '',
        defaultModel: '',
        keyEnvVar: 'LLM_API_KEY'
      }
    };
    this.providerList = ['anthropic', 'openai', 'custom'];
    this.selectedProvider = 0; // Index into providerList

    // Detect provider from env
    const detectedProvider = process.env.LLM_PROVIDER || 'anthropic';
    this.selectedProvider = Math.max(0, this.providerList.indexOf(detectedProvider));

    // Environment variables for execution
    // Select API key based on provider (prefer provider-specific key)
    const currentProvider = this.providerList[this.selectedProvider];
    const apiKey = this._getApiKeyForProvider(currentProvider);
    this.envVars = {
      // Server settings
      SERVER_PORT: process.env.PORT || '3000',
      SERVER_HOST: process.env.HOST || '0.0.0.0',
      SESSION_SERVER_URL: this.state.serverUrl || 'http://localhost:3000',
      // LLM settings
      LLM_PROVIDER: currentProvider,
      LLM_API_KEY: apiKey,
      LLM_ENDPOINT: process.env.LLM_ENDPOINT || this.providers[currentProvider].endpoint,
      LLM_MODEL: process.env.LLM_MODEL || this.providers[currentProvider].defaultModel,
      ANTHROPIC_VERSION: process.env.ANTHROPIC_VERSION || '2023-06-01',
      // Output settings
      OUTPUT_DIR: this.state.outputDir || './output'
    };
    this.envVarKeys = Object.keys(this.envVars);
    this.selectedEnvVar = 0;
    this.editingEnvVar = false;
    this.envVarInput = '';

    // Execution options
    this.dryRun = false;
    this.verbose = false;
    this.cleanSandbox = true;  // Default to cleaning sandbox before execution

    // Sandbox info cache
    this.sandboxInfo = null;
  }

  /**
   * Set shared state reference
   * @param {Object} state
   */
  setState(state) {
    this.state = state;
    this.sessionClient = new SessionServerClient({
      baseUrl: state.serverUrl || 'http://localhost:3000'
    });
    this.actionRunner = new ActionPlanRunner({
      outputDir: state.outputDir || './output'
    });
    this.envVars.SESSION_SERVER_URL = state.serverUrl || 'http://localhost:3000';
    this.envVars.OUTPUT_DIR = state.outputDir || './output';
  }

  /**
   * Focus the screen
   */
  focus() {
    this.focused = true;
    this._checkServerStatus();

    // Show API key status
    const provider = this.envVars.LLM_PROVIDER;
    const hasKey = !!this.envVars.LLM_API_KEY;
    if (!hasKey) {
      this.logViewer.addLine('warn', `No API key for ${provider}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.`);
    } else {
      const keyPrefix = this.envVars.LLM_API_KEY.slice(0, 7);
      this.logViewer.addLine('info', `Provider: ${provider}, Key: ${keyPrefix}...`);
    }
  }

  /**
   * Blur the screen
   */
  blur() {
    this.focused = false;
  }

  /**
   * Check if screen is in input/editing mode
   * @returns {boolean}
   */
  isInputMode() {
    return this.editingEnvVar || (this.mode === 'edit-tasks' && this.editingField);
  }

  /**
   * Get help text
   * @returns {string}
   */
  getHelpText() {
    switch (this.mode) {
      case 'dashboard':
        return '[S] Server  [K] Kill Session  [D] Dry-run  [V] Verbose  [X] Clean Sandbox  [Enter] Select';
      case 'sessions':
        return '[Enter] View  [K] Kill  [R] Refresh  [Esc] Back';
      case 'session-detail':
        return '[E] Execute  [C] Clean Sandbox  [T] Edit Tasks  [G] Dep Graph  [K] Kill  [Esc] Back';
      case 'edit-tasks':
        return '[↑↓] Task  [←→] Field  [Enter] Edit  [T] Tool  [D] Deps  [Ctrl+S] Save  [Esc] Back';
      case 'running':
        return '[Esc] Abort';
      case 'config':
        return '[P] Provider  [Enter] Edit  [Esc] Back';
      default:
        return '';
    }
  }

  /**
   * Check server status
   * @private
   */
  async _checkServerStatus() {
    try {
      const health = await this.sessionClient.healthCheck();
      this.serverStatus = {
        connected: true,
        uptime: health.uptime || 0
      };
      if (this.state) {
        this.state.serverConnected = true;
      }
      this._updateServerMenuItem();
    } catch (err) {
      this.serverStatus = { connected: false, uptime: 0 };
      if (this.state) {
        this.state.serverConnected = false;
      }
      this._updateServerMenuItem();
    }
  }

  /**
   * Update the server menu item based on server state
   * @private
   */
  _updateServerMenuItem() {
    const items = this.dashboardMenu.items.slice();
    items[0] = this.serverRunning ? 'Stop Server' : 'Start Server';
    this.dashboardMenu.setItems(items);
  }

  /**
   * Toggle server on/off
   * @private
   */
  _toggleServer() {
    if (this.serverRunning) {
      this._stopServer();
    } else {
      this._startServer();
    }
  }

  /**
   * Start the session server
   * @private
   */
  _startServer() {
    if (this.serverRunning) {
      this.logViewer.addLine('warn', 'Server is already running');
      return;
    }

    // Warn if no API key
    if (!this.envVars.LLM_API_KEY) {
      this.logViewer.addLine('warn', 'Starting server WITHOUT API key - LLM features will be unavailable!');
      this.logViewer.addLine('info', 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY, then restart server.');
    }

    this.logViewer.addLine('info', 'Starting session server...');

    // Build environment for server
    const env = {
      ...process.env,
      PORT: this.envVars.SERVER_PORT,
      HOST: this.envVars.SERVER_HOST,
      LLM_PROVIDER: this.envVars.LLM_PROVIDER,
      LLM_API_KEY: this.envVars.LLM_API_KEY,
      LLM_ENDPOINT: this.envVars.LLM_ENDPOINT,
      LLM_MODEL: this.envVars.LLM_MODEL,
      ANTHROPIC_VERSION: this.envVars.ANTHROPIC_VERSION
    };

    // Use bun if available, otherwise node
    const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';

    try {
      this.serverProcess = spawn(runtime, [this.serverPath], {
        env,
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.serverRunning = true;
      this._updateServerMenuItem();

      // Handle stdout
      this.serverProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
          // Parse log level from server output
          if (line.includes('[ERROR]')) {
            this.logViewer.addLine('error', line);
          } else if (line.includes('[INFO]')) {
            this.logViewer.addLine('info', line);
          } else if (line.includes('[DEBUG]')) {
            this.logViewer.addLine('debug', line);
          } else {
            this.logViewer.addLine('info', line);
          }
        });
      });

      // Handle stderr
      this.serverProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
          this.logViewer.addLine('error', line);
        });
      });

      // Handle process exit
      this.serverProcess.on('close', (code) => {
        this.serverRunning = false;
        this.serverProcess = null;
        this._updateServerMenuItem();
        if (code === 0) {
          this.logViewer.addLine('info', 'Server stopped');
        } else {
          this.logViewer.addLine('error', `Server exited with code: ${code}`);
        }
        this._checkServerStatus();
      });

      this.serverProcess.on('error', (err) => {
        this.serverRunning = false;
        this.serverProcess = null;
        this._updateServerMenuItem();
        this.logViewer.addLine('error', `Server error: ${err.message}`);
      });

      // Update SESSION_SERVER_URL based on port
      const port = this.envVars.SERVER_PORT;
      this.envVars.SESSION_SERVER_URL = `http://localhost:${port}`;
      this.sessionClient = new SessionServerClient({
        baseUrl: this.envVars.SESSION_SERVER_URL
      });

      this.logViewer.addLine('success', `Server starting on port ${port}...`);

      // Check status after a short delay
      setTimeout(() => this._checkServerStatus(), 2000);

    } catch (err) {
      this.logViewer.addLine('error', `Failed to start server: ${err.message}`);
    }
  }

  /**
   * Stop the session server
   * @private
   */
  _stopServer() {
    if (!this.serverRunning || !this.serverProcess) {
      this.logViewer.addLine('warn', 'Server is not running');
      return;
    }

    this.logViewer.addLine('info', 'Stopping server...');
    this.serverProcess.kill('SIGTERM');
  }

  /**
   * Load sessions list
   * @private
   */
  async _loadSessions() {
    try {
      const response = await this.sessionClient.listSessions();
      // Server returns { success: true, data: { sessions: [...], pagination: {...} } }
      const data = response.data || response;
      this.sessions = Array.isArray(data) ? data : (data.sessions || []);
      this._updateSessionsMenu();
    } catch (err) {
      this.sessions = [];
      this.sessionsMenu.setItems(['(Error loading sessions)']);
    }
  }

  /**
   * Update sessions menu
   * @private
   */
  _updateSessionsMenu() {
    if (this.sessions.length === 0) {
      this.sessionsMenu.setItems(['(No sessions)']);
      return;
    }

    const items = this.sessions.map(s => {
      const status = s.state || s.status || 'unknown';
      const id = s.id.slice(0, 8);
      return `${id}... [${status}]`;
    });

    this.sessionsMenu.setItems(items);
  }

  /**
   * Create a new session from current goals
   * @private
   */
  async _createSession() {
    if (!this.state.goals) {
      this.logViewer.addLine('error', 'No goals loaded. Load goals first.');
      return;
    }

    try {
      this.logViewer.addLine('info', 'Creating session...');

      // Provide default context if none exists
      const context = this.state.context || {
        files: [],
        formattedContent: '',
        metadata: {
          source: 'tui',
          createdAt: new Date().toISOString()
        }
      };

      const response = await this.sessionClient.createSession(
        this.state.goals,
        context
      );

      // Server returns { success: true, data: { sessionId: "...", ... } }
      const result = response.data || response;

      if (result.sessionId) {
        this.state.sessionId = result.sessionId;
        this.logViewer.addLine('success', `Session created: ${result.sessionId}`);
        await this._loadSessions();
      }
    } catch (err) {
      this.logViewer.addLine('error', `Failed to create session: ${err.message}`);
    }
  }

  /**
   * Prepare a session for execution (evaluate + generate task list)
   * @private
   */
  async _prepareSession() {
    // Check for API key first
    if (!this.envVars.LLM_API_KEY) {
      this.logViewer.addLine('error', 'No API key configured!');
      this.logViewer.addLine('warn', `Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment, then restart.`);
      this.logViewer.addLine('info', 'Or configure in Environment Config menu.');
      return;
    }

    if (!this.state.sessionId) {
      this.logViewer.addLine('error', 'No session selected. Create a session first.');
      return;
    }

    const sessionId = this.state.sessionId;
    this.logViewer.addLine('info', `Preparing session: ${sessionId.slice(0, 8)}...`);

    try {
      // Step 1: Evaluate the session
      this.logViewer.addLine('info', '── Step 1/2: Evaluating dependencies ──');
      const evalResponse = await this.sessionClient.evaluate(sessionId);
      const evalResult = evalResponse.data || evalResponse;

      if (evalResult.evaluation) {
        this.logViewer.addLine('success', `Evaluation complete. State: ${evalResult.state}`);

        // Show execution order
        const order = evalResult.evaluation.executionOrder || [];
        if (order.length > 0) {
          this.logViewer.addLine('info', `Execution order (${order.length} goals):`);
          order.forEach((goalId, idx) => {
            this.logViewer.addLine('debug', `  ${idx + 1}. ${goalId.slice(0, 8)}...`);
          });
        }

        // Show inferred dependencies
        const deps = evalResult.evaluation.inferredDependencies || [];
        if (deps.length > 0) {
          this.logViewer.addLine('info', `Inferred dependencies (${deps.length}):`);
          deps.forEach(dep => {
            const type = dep.type || 'unknown';
            this.logViewer.addLine('debug', `  ${dep.goalId.slice(0, 8)} → ${dep.dependsOn.slice(0, 8)} [${type}]`);
          });
        }

        // Show warnings (including circular dependencies)
        const warnings = evalResult.evaluation.warnings || [];
        if (warnings.length > 0) {
          this.logViewer.addLine('warn', `Warnings (${warnings.length}):`);
          warnings.forEach(w => {
            const goalInfo = w.goalId ? ` (${w.goalId.slice(0, 8)})` : '';
            this.logViewer.addLine('warn', `  [${w.code}]${goalInfo}: ${w.message}`);
          });
        }

        // Show reasoning
        if (evalResult.evaluation.reasoning) {
          this.logViewer.addLine('info', `Reasoning: ${evalResult.evaluation.reasoning.slice(0, 200)}...`);
        }
      } else {
        this.logViewer.addLine('warn', 'Evaluation returned no data');
      }

      // Step 2: Generate task list
      this.logViewer.addLine('info', '── Step 2/2: Generating tasks ──');
      const taskResponse = await this.sessionClient.generateTaskList(sessionId);
      const taskResult = taskResponse.data || taskResponse;

      if (taskResult.taskList) {
        const tasks = taskResult.taskList.tasks || [];
        this.logViewer.addLine('success', `Generated ${tasks.length} tasks. State: ${taskResult.state}`);

        // Show task summary with dependencies
        if (tasks.length > 0) {
          this.logViewer.addLine('info', 'Task breakdown:');
          tasks.forEach((task, idx) => {
            const toolStr = typeof task.tool === 'string' ? task.tool :
                           (task.tool?.toolName || task.tool?.name || '?');
            const deps = task.dependencies || [];
            const depStr = deps.length > 0
              ? ` ← depends on: ${deps.map(d => String(d.taskId || d).slice(0, 8)).join(', ')}`
              : '';
            this.logViewer.addLine('debug', `  ${idx + 1}. [${toolStr}] ${(task.title || '').slice(0, 40)}${depStr}`);
          });

          // Check for potential circular dependencies in tasks
          const depGraph = this._buildTaskDepGraph(tasks);
          const cycles = this._detectCycles(depGraph);
          if (cycles.length > 0) {
            this.logViewer.addLine('error', `⚠ Circular dependencies detected!`);
            cycles.forEach(cycle => {
              this.logViewer.addLine('error', `  Cycle: ${cycle.map(id => String(id).slice(0, 8)).join(' → ')}`);
            });
          }
        }

        // Show unbound tasks (tasks that couldn't be mapped to tools)
        const unbound = taskResult.taskList.unboundTasks || [];
        if (unbound.length > 0) {
          this.logViewer.addLine('warn', `Unbound tasks (${unbound.length}):`);
          unbound.forEach(ut => {
            this.logViewer.addLine('warn', `  ${ut.taskTitle}: ${ut.reason}`);
          });
        }

        this.logViewer.addLine('success', 'Session is ready for execution');
      } else {
        this.logViewer.addLine('warn', 'Task generation returned no data');
      }

      // Refresh sessions list
      await this._loadSessions();

    } catch (err) {
      this.logViewer.addLine('error', `Preparation failed: ${err.message}`);
      // Show more details if available
      if (err.message.includes('LLM') || err.message.includes('API')) {
        this.logViewer.addLine('info', 'Hint: Is LLM_API_KEY set on the server?');
      }
      if (err.message.includes('circular') || err.message.includes('blocked')) {
        this.logViewer.addLine('info', 'Hint: Check goal dependencies for cycles');
      }
    }
  }

  /**
   * Build a dependency graph from tasks
   * @param {Object[]} tasks
   * @returns {Map<string, string[]>}
   * @private
   */
  _buildTaskDepGraph(tasks) {
    const graph = new Map();
    for (const task of tasks) {
      const deps = (task.dependencies || []).map(d => d.taskId || d);
      graph.set(task.id, deps);
    }
    return graph;
  }

  /**
   * Detect cycles in a dependency graph using DFS
   * @param {Map<string, string[]>} graph
   * @returns {string[][]} Array of cycles found
   * @private
   */
  _detectCycles(graph) {
    const cycles = [];
    const visited = new Set();
    const recStack = new Set();
    const path = [];

    const dfs = (node) => {
      if (recStack.has(node)) {
        // Found a cycle - extract it from path
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      recStack.add(node);
      path.push(node);

      const deps = graph.get(node) || [];
      for (const dep of deps) {
        dfs(dep);
      }

      path.pop();
      recStack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Show dependency graph in the log viewer
   * @private
   */
  _showDependencyGraph() {
    if (!this.selectedSession) {
      this.logViewer.addLine('warn', 'No session selected');
      return;
    }

    this.logViewer.clear();
    this.logViewer.addLine('info', '═══ Dependency Graph ═══');

    // Show goal dependencies
    const goals = this.selectedSession.goals?.items || [];
    if (goals.length > 0) {
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '── Goals ──');
      goals.forEach((goal, idx) => {
        const state = goal.status?.state || 'pending';
        const stateIcon = state === 'completed' ? '✓' :
                         state === 'blocked' ? '⊘' :
                         state === 'in_progress' ? '▶' : '○';
        this.logViewer.addLine('info', `${stateIcon} ${idx + 1}. ${goal.id.slice(0, 8)}... [${state}]`);
        this.logViewer.addLine('debug', `   ${(goal.objective || '').slice(0, 60)}`);

        // Show dependencies
        const allDeps = goal.dependencies?.allDependencies || [];
        if (allDeps.length > 0) {
          allDeps.forEach(depId => {
            const depGoal = goals.find(g => g.id === depId);
            const depState = depGoal?.status?.state || 'unknown';
            const satisfied = depState === 'completed';
            const arrow = satisfied ? '✓→' : '⊘→';
            this.logViewer.addLine('debug', `   ${arrow} ${String(depId).slice(0, 8)}... (${depState})`);
          });
        }
      });
    }

    // Show task dependencies
    const tasks = this.selectedSession.taskList?.tasks || [];
    if (tasks.length > 0) {
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '── Tasks ──');

      // Build dependency graph and detect cycles
      const depGraph = this._buildTaskDepGraph(tasks);
      const cycles = this._detectCycles(depGraph);

      if (cycles.length > 0) {
        this.logViewer.addLine('error', `⚠ CIRCULAR DEPENDENCIES DETECTED:`);
        cycles.forEach(cycle => {
          this.logViewer.addLine('error', `  ${cycle.map(id => String(id).slice(0, 8)).join(' → ')}`);
        });
        this.logViewer.addLine('info', '');
      }

      // Show each task with its dependencies
      tasks.forEach((task, idx) => {
        const state = task.state || 'pending';
        const stateIcon = state === 'completed' ? '✓' :
                         state === 'running' ? '▶' :
                         state === 'failed' ? '✗' : '○';
        const toolStr = typeof task.tool === 'string' ? task.tool :
                       (task.tool?.toolName || task.tool?.name || '?');

        this.logViewer.addLine('info', `${stateIcon} ${idx + 1}. ${task.id.slice(0, 12)}... [${toolStr}]`);

        const deps = task.dependencies || [];
        if (deps.length > 0) {
          deps.forEach(dep => {
            const depId = dep.taskId || dep;
            const depTask = tasks.find(t => t.id === depId);
            const depState = depTask?.state || 'unknown';
            const satisfied = depState === 'completed';
            const arrow = satisfied ? '✓→' : '⊘→';
            const depType = dep.type || 'completion';
            this.logViewer.addLine('debug', `   ${arrow} ${String(depId).slice(0, 12)}... [${depType}] (${depState})`);
          });
        }
      });

      // Show blocked tasks summary
      const blockedTasks = tasks.filter(t => {
        const deps = t.dependencies || [];
        return deps.some(d => {
          const depId = d.taskId || d;
          const depTask = tasks.find(t2 => t2.id === depId);
          return !depTask || depTask.state !== 'completed';
        }) && t.state !== 'completed';
      });

      if (blockedTasks.length > 0) {
        this.logViewer.addLine('info', '');
        this.logViewer.addLine('warn', `Blocked tasks: ${blockedTasks.length}`);
        blockedTasks.forEach(t => {
          const waitingOn = (t.dependencies || [])
            .filter(d => {
              const depId = d.taskId || d;
              const depTask = tasks.find(t2 => t2.id === depId);
              return !depTask || depTask.state !== 'completed';
            })
            .map(d => String(d.taskId || d).slice(0, 8));
          this.logViewer.addLine('warn', `  ${t.id.slice(0, 8)}... waiting on: ${waitingOn.join(', ')}`);
        });
      }
    }

    this.logViewer.addLine('info', '');
    this.logViewer.addLine('info', 'Legend: ✓=completed ○=pending ▶=running ⊘=blocked ✗=failed');
  }

  /**
   * Clean sandbox for a session
   * @param {string} sessionId
   * @private
   */
  async _cleanSandbox(sessionId) {
    try {
      // First check if sandbox exists
      const infoResponse = await this.sessionClient.getSandboxInfo(sessionId);
      const info = infoResponse.data || infoResponse;

      if (!info.exists || info.size === 0) {
        this.logViewer.addLine('info', 'Sandbox is already clean (no files)');
        this.sandboxInfo = info;
        return;
      }

      this.logViewer.addLine('info', `Cleaning sandbox (${this._formatBytes(info.size)})...`);

      const response = await this.sessionClient.cleanupSandbox(sessionId);
      const result = response.data || response;

      this.logViewer.addLine('success', 'Sandbox cleaned successfully');
      this.sandboxInfo = { exists: false, size: 0 };
    } catch (err) {
      this.logViewer.addLine('error', `Failed to clean sandbox: ${err.message}`);
    }
  }

  /**
   * Load sandbox info for selected session
   * @param {string} sessionId
   * @private
   */
  async _loadSandboxInfo(sessionId) {
    try {
      const response = await this.sessionClient.getSandboxInfo(sessionId);
      this.sandboxInfo = response.data || response;
    } catch (err) {
      this.sandboxInfo = null;
    }
  }

  /**
   * Format bytes to human readable
   * @param {number} bytes
   * @returns {string}
   * @private
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Execute a session
   * @param {string} sessionId
   * @private
   */
  async _executeSession(sessionId) {
    if (this.actionRunner.isRunning()) {
      this.logViewer.addLine('warn', 'Execution already in progress');
      return;
    }

    this.mode = 'running';
    this.executionProgress = { current: 0, total: 0 };
    this.logViewer.clear();
    this.logViewer.addLine('info', `Starting execution for session: ${sessionId}`);

    if (this.dryRun) {
      this.logViewer.addLine('warn', 'DRY-RUN MODE - No changes will be made');
    }

    // Clean sandbox before execution if enabled
    if (this.cleanSandbox && !this.dryRun) {
      try {
        const infoResponse = await this.sessionClient.getSandboxInfo(sessionId);
        const info = infoResponse.data || infoResponse;

        if (info.exists && info.size > 0) {
          this.logViewer.addLine('info', `Cleaning sandbox (${this._formatBytes(info.size)})...`);
          await this.sessionClient.cleanupSandbox(sessionId);
          this.logViewer.addLine('success', 'Sandbox cleaned');
        }
      } catch (err) {
        this.logViewer.addLine('warn', `Could not clean sandbox: ${err.message}`);
        // Continue anyway - not fatal
      }
    }

    try {
      const result = await this.actionRunner.run(sessionId, {
        dryRun: this.dryRun,
        verbose: this.verbose,
        env: this.envVars,
        onLog: (level, message) => {
          this.logViewer.addLine(level, message);
        },
        onProgress: (current, total) => {
          this.executionProgress = { current, total };
          this.progressBar.setValue(current, total);
        },
        onComplete: (success, result) => {
          if (success) {
            this.logViewer.addLine('success', 'Execution completed successfully!');
          } else if (result.aborted) {
            this.logViewer.addLine('warn', 'Execution aborted by user');
          } else {
            this.logViewer.addLine('error', `Execution failed with exit code: ${result.exitCode}`);
          }
        }
      });

      this.mode = 'dashboard';
    } catch (err) {
      this.logViewer.addLine('error', `Execution error: ${err.message}`);
      this.mode = 'dashboard';
    }
  }

  /**
   * Run next available session
   * @private
   */
  async _runNextSession() {
    // Check for API key first
    if (!this.envVars.LLM_API_KEY) {
      this.logViewer.addLine('error', 'No API key configured!');
      this.logViewer.addLine('warn', 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment, then restart.');
      return;
    }

    if (this.actionRunner.isRunning()) {
      this.logViewer.addLine('warn', 'Execution already in progress');
      return;
    }

    this.mode = 'running';
    this.executionProgress = { current: 0, total: 0 };
    this.logViewer.clear();
    this.logViewer.addLine('info', 'Looking for next ready session...');

    try {
      const result = await this.actionRunner.runNext({
        dryRun: this.dryRun,
        verbose: this.verbose,
        env: this.envVars,
        onLog: (level, message) => {
          this.logViewer.addLine(level, message);
        },
        onProgress: (current, total) => {
          this.executionProgress = { current, total };
        }
      });

      if (result.sessionId) {
        this.logViewer.addLine('success', `Executed session: ${result.sessionId}`);
      } else if (result.exitCode === 0) {
        this.logViewer.addLine('info', 'No sessions ready for execution');
      }

      this.mode = 'dashboard';
    } catch (err) {
      this.logViewer.addLine('error', `Error: ${err.message}`);
      this.mode = 'dashboard';
    }
  }

  /**
   * Delete a session
   * @param {string} sessionId
   * @private
   */
  async _deleteSession(sessionId) {
    try {
      await this.sessionClient.deleteSession(sessionId);
      this.logViewer.addLine('success', `Session deleted: ${sessionId}`);
      await this._loadSessions();
    } catch (err) {
      this.logViewer.addLine('error', `Failed to delete: ${err.message}`);
    }
  }

  /**
   * Kill the current or selected session
   * @private
   */
  async _killCurrentSession() {
    // First, check if we have a current session in state
    if (this.state.sessionId) {
      const sessionId = this.state.sessionId;
      this.logViewer.addLine('info', `Killing session: ${sessionId.slice(0, 8)}...`);
      try {
        await this.sessionClient.deleteSession(sessionId);
        this.logViewer.addLine('success', `Session killed: ${sessionId.slice(0, 8)}...`);
        this.state.sessionId = null;
        await this._loadSessions();
      } catch (err) {
        this.logViewer.addLine('error', `Failed to kill session: ${err.message}`);
      }
      return;
    }

    // No current session, check if we have a selected session from the list
    if (this.selectedSession) {
      const sessionId = this.selectedSession.id;
      this.logViewer.addLine('info', `Killing selected session: ${sessionId.slice(0, 8)}...`);
      try {
        await this.sessionClient.deleteSession(sessionId);
        this.logViewer.addLine('success', `Session killed: ${sessionId.slice(0, 8)}...`);
        this.selectedSession = null;
        await this._loadSessions();
      } catch (err) {
        this.logViewer.addLine('error', `Failed to kill session: ${err.message}`);
      }
      return;
    }

    // No session selected, prompt user to select one
    this.logViewer.addLine('warn', 'No session selected. Use "List Sessions" to select one, or press [K] in sessions list.');
    this.logViewer.addLine('info', 'Loading sessions list...');
    await this._loadSessions();
    if (this.sessions.length > 0) {
      this.mode = 'sessions';
    } else {
      this.logViewer.addLine('info', 'No sessions found on server');
    }
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    switch (this.mode) {
      case 'dashboard':
        this._handleDashboardEvent(ctx, evt);
        break;
      case 'sessions':
        this._handleSessionsEvent(ctx, evt);
        break;
      case 'session-detail':
        this._handleSessionDetailEvent(ctx, evt);
        break;
      case 'edit-tasks':
        this._handleEditTasksEvent(ctx, evt);
        break;
      case 'running':
        this._handleRunningEvent(ctx, evt);
        break;
      case 'config':
        this._handleConfigEvent(ctx, evt);
        break;
    }
  }

  /**
   * Handle dashboard mode events
   * @private
   */
  _handleDashboardEvent(ctx, evt) {
    if (evt.type === 'key') {
      const result = this.dashboardMenu.onKey(evt.key);
      if (result?.action === 'select') {
        this._handleDashboardAction(result.index);
        return;
      }

      if (evt.key === 'enter') {
        this._handleDashboardAction(this.dashboardMenu.selected);
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 's':
          this._toggleServer();
          break;
        case 'd':
          this.dryRun = !this.dryRun;
          this.logViewer.addLine('info', `Dry-run: ${this.dryRun ? 'ON' : 'OFF'}`);
          break;
        case 'v':
          this.verbose = !this.verbose;
          this.logViewer.addLine('info', `Verbose: ${this.verbose ? 'ON' : 'OFF'}`);
          break;
        case 'x':
          this.cleanSandbox = !this.cleanSandbox;
          this.logViewer.addLine('info', `Clean Sandbox: ${this.cleanSandbox ? 'ON' : 'OFF'}`);
          break;
        case 'k':
          this._killCurrentSession();
          break;
      }
    }
  }

  /**
   * Handle dashboard menu action
   * @param {number} index
   * @private
   */
  _handleDashboardAction(index) {
    switch (index) {
      case 0: // Start/Stop Server
        this._toggleServer();
        break;
      case 1: // Create Session
        this._createSession();
        break;
      case 2: // Prepare Session (Evaluate + Generate Tasks)
        this._prepareSession();
        break;
      case 3: // List Sessions
        this._loadSessions();
        this.mode = 'sessions';
        break;
      case 4: // Run Next Session
        this._runNextSession();
        break;
      case 5: // Kill Session
        this._killCurrentSession();
        break;
      case 6: // Environment Config
        this.mode = 'config';
        break;
      case 7: // Refresh Status
        this._checkServerStatus();
        this.logViewer.addLine('info', 'Status refreshed');
        break;
    }
  }

  /**
   * Handle sessions list events
   * @private
   */
  _handleSessionsEvent(ctx, evt) {
    if (evt.type === 'key') {
      const result = this.sessionsMenu.onKey(evt.key);
      if (result?.action === 'select') {
        this._selectSession(result.index);
        return;
      }

      switch (evt.key) {
        case 'esc':
          this.mode = 'dashboard';
          break;
        case 'enter':
          this._selectSession(this.sessionsMenu.selected);
          break;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'r':
          this._loadSessions();
          break;
        case 'x':
        case 'k':
          if (this.sessions.length > 0 && this.sessionsMenu.selected < this.sessions.length) {
            const session = this.sessions[this.sessionsMenu.selected];
            this.logViewer.addLine('info', `Killing session: ${session.id.slice(0, 8)}...`);
            this._deleteSession(session.id);
          }
          break;
      }
    }
  }

  /**
   * Select a session to view details
   * @param {number} index
   * @private
   */
  async _selectSession(index) {
    if (index >= 0 && index < this.sessions.length) {
      try {
        const sessionId = this.sessions[index].id;
        const response = await this.sessionClient.getSession(sessionId);
        // Server returns { success: true, data: { id: "...", state: "...", ... } }
        this.selectedSession = response.data || response;
        this.mode = 'session-detail';

        // Load sandbox info in background
        this._loadSandboxInfo(sessionId);
      } catch (err) {
        this.logViewer.addLine('error', `Failed to load session: ${err.message}`);
      }
    }
  }

  /**
   * Handle session detail events
   * @private
   */
  _handleSessionDetailEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'sessions';
          this.taskScrollOffset = 0;
          break;
        case 'up':
          this.taskScrollOffset = Math.max(0, this.taskScrollOffset - 1);
          break;
        case 'down':
          this.taskScrollOffset++;
          break;
        case 'pageup':
          this.taskScrollOffset = Math.max(0, this.taskScrollOffset - 10);
          break;
        case 'pagedown':
          this.taskScrollOffset += 10;
          break;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'e':
          if (this.selectedSession) {
            this._executeSession(this.selectedSession.id);
          }
          break;
        case 'c':
          if (this.selectedSession) {
            this._cleanSandbox(this.selectedSession.id);
          }
          break;
        case 't':
          if (this.selectedSession?.taskList) {
            this._startEditTasks();
          } else {
            this.logViewer.addLine('warn', 'No tasks to edit. Run "Prepare Session" first.');
          }
          break;
        case 'g':
          this._showDependencyGraph();
          break;
        case 'k':
          if (this.selectedSession) {
            const sessionId = this.selectedSession.id;
            this.logViewer.addLine('info', `Killing session: ${sessionId.slice(0, 8)}...`);
            this._deleteSession(sessionId);
            this.selectedSession = null;
            this.mode = 'sessions';
          }
          break;
      }
    }
  }

  /**
   * Start editing tasks in form mode
   * @private
   */
  async _startEditTasks() {
    if (!this.selectedSession?.taskList) return;

    this.mode = 'edit-tasks';
    this.editTaskIndex = 0;
    this.editFieldIndex = 0;
    this.editingField = false;
    this.editFieldValue = '';
    this.editDepMode = false;
    this.editDepSelected = new Set();
    this.editToolMode = false;
    this.toolNavIndex = 0;

    // Fetch available tools if not cached
    if (this.availableTools.length === 0) {
      try {
        const response = await this.sessionClient.getTools();
        const data = response.data || response;
        this.availableTools = data.tools || [];
        this.logViewer.addLine('info', `Loaded ${this.availableTools.length} available tools`);
      } catch (err) {
        this.logViewer.addLine('warn', `Could not load tools: ${err.message}`);
        this.availableTools = [];
      }
    }
  }

  /**
   * Handle edit-tasks mode events
   * @private
   */
  _handleEditTasksEvent(ctx, evt) {
    const tasks = this.selectedSession?.taskList?.tasks || [];
    if (tasks.length === 0) return;

    // Handle dependency selection mode
    if (this.editDepMode) {
      this._handleDepSelectEvent(ctx, evt, tasks);
      return;
    }

    // Handle tool selection mode
    if (this.editToolMode) {
      this._handleToolSelectEvent(ctx, evt, tasks);
      return;
    }

    // Handle field editing mode
    if (this.editingField) {
      this._handleFieldEditEvent(ctx, evt, tasks);
      return;
    }

    // Navigation mode
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'ctrl+s':
          this._saveEditedTasks();
          return;
        case 'esc':
          this.mode = 'session-detail';
          return;
        case 'up':
          this.editTaskIndex = Math.max(0, this.editTaskIndex - 1);
          return;
        case 'down':
          this.editTaskIndex = Math.min(tasks.length - 1, this.editTaskIndex + 1);
          return;
        case 'left':
          this.editFieldIndex = Math.max(0, this.editFieldIndex - 1);
          return;
        case 'right':
          this.editFieldIndex = Math.min(this.taskFields.length - 1, this.editFieldIndex + 1);
          return;
        case 'enter':
          this._startFieldEdit(tasks);
          return;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'd':
          // Quick toggle dependency mode
          this._startDepEdit(tasks);
          return;
        case 't':
          // Quick toggle tool selection mode
          this._startToolEdit(tasks);
          return;
      }
    }
  }

  /**
   * Start editing a field
   * @param {Object[]} tasks
   * @private
   */
  _startFieldEdit(tasks) {
    const task = tasks[this.editTaskIndex];
    const field = this.taskFields[this.editFieldIndex];

    if (field === 'dependencies') {
      this._startDepEdit(tasks);
      return;
    }

    if (field === 'tool') {
      this._startToolEdit(tasks);
      return;
    }

    this.editingField = true;
    const value = task[field];
    this.editFieldValue = value !== undefined ? String(value) : '';
  }

  /**
   * Start editing dependencies
   * @param {Object[]} tasks
   * @private
   */
  _startDepEdit(tasks) {
    const task = tasks[this.editTaskIndex];
    this.editDepMode = true;
    this.editDepSelected = new Set();

    // Pre-select current dependencies
    const deps = task.dependencies || [];
    for (const dep of deps) {
      const depId = typeof dep === 'string' ? dep :
                   (dep.taskId || dep.id || String(dep));
      this.editDepSelected.add(depId);
    }
  }

  /**
   * Handle field editing events
   * @param {Object} ctx
   * @param {Object} evt
   * @param {Object[]} tasks
   * @private
   */
  _handleFieldEditEvent(ctx, evt, tasks) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'enter':
          // Save the field value
          this._applyFieldEdit(tasks);
          this.editingField = false;
          return;
        case 'esc':
          this.editingField = false;
          return;
        case 'backspace':
          this.editFieldValue = this.editFieldValue.slice(0, -1);
          return;
      }
    }

    if (evt.type === 'text') {
      this.editFieldValue += evt.text;
    }
  }

  /**
   * Apply field edit to task
   * @param {Object[]} tasks
   * @private
   */
  _applyFieldEdit(tasks) {
    const task = tasks[this.editTaskIndex];
    const field = this.taskFields[this.editFieldIndex];

    if (field === 'priority' || field === 'sequenceNumber') {
      const num = parseInt(this.editFieldValue, 10);
      if (!isNaN(num)) {
        task[field] = num;
      }
    } else {
      task[field] = this.editFieldValue;
    }
  }

  /**
   * Handle dependency selection events
   * @param {Object} ctx
   * @param {Object} evt
   * @param {Object[]} tasks
   * @private
   */
  _handleDepSelectEvent(ctx, evt, tasks) {
    const currentTask = tasks[this.editTaskIndex];
    const otherTasks = tasks.filter((_, idx) => idx !== this.editTaskIndex);

    if (evt.type === 'key') {
      switch (evt.key) {
        case 'enter':
        case 'esc':
          // Save dependencies and exit
          this._applyDepEdit(currentTask);
          this.editDepMode = false;
          return;
        case 'up':
          // Navigate through other tasks
          if (!this._depNavIndex) this._depNavIndex = 0;
          this._depNavIndex = Math.max(0, this._depNavIndex - 1);
          return;
        case 'down':
          if (!this._depNavIndex) this._depNavIndex = 0;
          this._depNavIndex = Math.min(otherTasks.length - 1, this._depNavIndex + 1);
          return;
        case ' ':
          // Toggle selection
          if (otherTasks.length > 0 && this._depNavIndex !== undefined) {
            const depTask = otherTasks[this._depNavIndex];
            if (this.editDepSelected.has(depTask.id)) {
              this.editDepSelected.delete(depTask.id);
            } else {
              this.editDepSelected.add(depTask.id);
            }
          }
          return;
      }
    }

    // Number keys for quick toggle (1-9)
    if (evt.type === 'text' && /^[1-9]$/.test(evt.text)) {
      const idx = parseInt(evt.text, 10) - 1;
      if (idx < otherTasks.length) {
        const depTask = otherTasks[idx];
        if (this.editDepSelected.has(depTask.id)) {
          this.editDepSelected.delete(depTask.id);
        } else {
          this.editDepSelected.add(depTask.id);
        }
      }
    }
  }

  /**
   * Apply dependency selection to task
   * @param {Object} task
   * @private
   */
  _applyDepEdit(task) {
    task.dependencies = Array.from(this.editDepSelected).map(taskId => ({
      taskId,
      type: 'completion'
    }));
  }

  /**
   * Start editing tool selection
   * @param {Object[]} tasks
   * @private
   */
  _startToolEdit(tasks) {
    if (this.availableTools.length === 0) {
      this.logViewer.addLine('warn', 'No tools available. Is the server running?');
      return;
    }

    const task = tasks[this.editTaskIndex];
    this.editToolMode = true;

    // Find current tool index in available tools list
    const currentToolName = this._getToolName(task.tool);
    this.toolNavIndex = Math.max(0,
      this.availableTools.findIndex(t => t.name === currentToolName)
    );
  }

  /**
   * Get tool name from task.tool (handles string or object)
   * @param {string|Object} tool
   * @returns {string}
   * @private
   */
  _getToolName(tool) {
    if (typeof tool === 'string') return tool;
    return tool?.toolName || tool?.name || tool?.tool || '';
  }

  /**
   * Handle tool selection events
   * @param {Object} ctx
   * @param {Object} evt
   * @param {Object[]} tasks
   * @private
   */
  _handleToolSelectEvent(ctx, evt, tasks) {
    const currentTask = tasks[this.editTaskIndex];

    if (evt.type === 'key') {
      switch (evt.key) {
        case 'enter':
          // Apply selected tool and exit
          this._applyToolEdit(currentTask);
          this.editToolMode = false;
          return;
        case 'esc':
          // Cancel without applying
          this.editToolMode = false;
          return;
        case 'up':
          this.toolNavIndex = Math.max(0, this.toolNavIndex - 1);
          return;
        case 'down':
          this.toolNavIndex = Math.min(this.availableTools.length - 1, this.toolNavIndex + 1);
          return;
        case 'pageup':
          this.toolNavIndex = Math.max(0, this.toolNavIndex - 10);
          return;
        case 'pagedown':
          this.toolNavIndex = Math.min(this.availableTools.length - 1, this.toolNavIndex + 10);
          return;
        case 'home':
          this.toolNavIndex = 0;
          return;
        case 'end':
          this.toolNavIndex = this.availableTools.length - 1;
          return;
      }
    }

    // Number keys for quick selection (1-9)
    if (evt.type === 'text' && /^[1-9]$/.test(evt.text)) {
      const idx = parseInt(evt.text, 10) - 1;
      if (idx < this.availableTools.length) {
        this.toolNavIndex = idx;
        this._applyToolEdit(currentTask);
        this.editToolMode = false;
      }
    }
  }

  /**
   * Apply tool selection to task
   * @param {Object} task
   * @private
   */
  _applyToolEdit(task) {
    const selectedTool = this.availableTools[this.toolNavIndex];
    if (!selectedTool) return;

    // Update task.tool - maintain object structure if it was an object
    if (typeof task.tool === 'object' && task.tool !== null) {
      task.tool.toolName = selectedTool.name;
      task.tool.name = selectedTool.name;
    } else {
      task.tool = {
        toolName: selectedTool.name,
        name: selectedTool.name
      };
    }

    this.logViewer.addLine('info', `Task ${this.editTaskIndex + 1} tool changed to: ${selectedTool.name}`);
  }

  /**
   * Save edited tasks to server
   * @private
   */
  async _saveEditedTasks() {
    if (!this.selectedSession?.taskList) return;

    try {
      const taskList = this.selectedSession.taskList;

      // Re-sequence tasks based on priority and dependencies
      this._resequenceTasks(taskList.tasks);

      this.logViewer.addLine('info', `Saving ${taskList.tasks.length} tasks...`);

      const response = await this.sessionClient.updateTaskList(
        this.selectedSession.id,
        taskList
      );

      const result = response.data || response;
      this.selectedSession.taskList = result.taskList || taskList;

      this.logViewer.addLine('success', `Tasks saved successfully`);
      this.mode = 'session-detail';
    } catch (err) {
      this.logViewer.addLine('error', `Failed to save tasks: ${err.message}`);
    }
  }

  /**
   * Re-sequence tasks based on dependencies and priority
   * Ensures proper execution order and adds buffer for dependent tasks
   * @param {Object[]} tasks
   * @private
   */
  _resequenceTasks(tasks) {
    // Build dependency graph
    const depGraph = new Map();
    const taskById = new Map();

    for (const task of tasks) {
      taskById.set(task.id, task);
      const deps = (task.dependencies || []).map(d =>
        typeof d === 'string' ? d : (d.taskId || d.id || String(d))
      );
      depGraph.set(task.id, deps);
    }

    // Topological sort with priority consideration
    const visited = new Set();
    const result = [];

    const visit = (taskId, depth = 0) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      // Visit dependencies first
      const deps = depGraph.get(taskId) || [];
      for (const depId of deps) {
        if (taskById.has(depId)) {
          visit(depId, depth + 1);
        }
      }

      result.push(taskId);
    };

    // Sort by priority first, then visit
    const sortedByPriority = [...tasks].sort((a, b) =>
      (a.priority || 5) - (b.priority || 5)
    );

    for (const task of sortedByPriority) {
      visit(task.id);
    }

    // Assign sequence numbers
    result.forEach((taskId, idx) => {
      const task = taskById.get(taskId);
      if (task) {
        task.sequenceNumber = idx + 1;
      }
    });
  }

  /**
   * Handle running mode events
   * @private
   */
  _handleRunningEvent(ctx, evt) {
    if (evt.type === 'key') {
      if (evt.key === 'esc') {
        this.actionRunner.abort();
        this.logViewer.addLine('warn', 'Aborting execution...');
      }
    }

    // Pass scroll events to log viewer
    this.logViewer.onEvent(ctx, evt);
  }

  /**
   * Handle config mode events
   * @private
   */
  _handleConfigEvent(ctx, evt) {
    if (this.editingEnvVar) {
      this._handleEnvVarEdit(ctx, evt);
      return;
    }

    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'dashboard';
          break;
        case 'up':
          this.selectedEnvVar = Math.max(0, this.selectedEnvVar - 1);
          break;
        case 'down':
          this.selectedEnvVar = Math.min(this.envVarKeys.length - 1, this.selectedEnvVar + 1);
          break;
        case 'enter':
          this.editingEnvVar = true;
          const key = this.envVarKeys[this.selectedEnvVar];
          this.envVarInput = this.envVars[key] || '';
          break;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'p':
          // Cycle through providers
          this._cycleProvider();
          break;
      }
    }
  }

  /**
   * Get the appropriate API key for a provider
   * @param {string} provider - Provider name
   * @returns {string} API key
   * @private
   */
  _getApiKeyForProvider(provider) {
    switch (provider) {
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || '';
      case 'openai':
        return process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
      case 'custom':
      default:
        return process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';
    }
  }

  /**
   * Cycle through LLM providers and update related settings
   * @private
   */
  _cycleProvider() {
    this.selectedProvider = (this.selectedProvider + 1) % this.providerList.length;
    const providerName = this.providerList[this.selectedProvider];
    const providerConfig = this.providers[providerName];

    // Update env vars with new provider defaults
    this.envVars.LLM_PROVIDER = providerName;
    this.envVars.LLM_ENDPOINT = providerConfig.endpoint;
    this.envVars.LLM_MODEL = providerConfig.defaultModel;
    this.envVars.LLM_API_KEY = this._getApiKeyForProvider(providerName);

    this.logViewer.addLine('info', `Switched to provider: ${providerName}`);
    this.logViewer.addLine('info', `Endpoint: ${providerConfig.endpoint || '(custom)'}`);
    this.logViewer.addLine('info', `Model: ${providerConfig.defaultModel || '(custom)'}`);
  }

  /**
   * Handle env var editing
   * @private
   */
  _handleEnvVarEdit(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.editingEnvVar = false;
          break;
        case 'enter':
          const key = this.envVarKeys[this.selectedEnvVar];
          this.envVars[key] = this.envVarInput;
          this.editingEnvVar = false;
          this.logViewer.addLine('info', `Set ${key}=${this.envVarInput ? '***' : '(empty)'}`);
          break;
        case 'backspace':
          this.envVarInput = this.envVarInput.slice(0, -1);
          break;
      }
    }

    if (evt.type === 'text') {
      this.envVarInput += evt.text;
    }
  }

  /**
   * Render the screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    switch (this.mode) {
      case 'dashboard':
        this._renderDashboard(ctx, rect);
        break;
      case 'sessions':
        this._renderSessions(ctx, rect);
        break;
      case 'session-detail':
        this._renderSessionDetail(ctx, rect);
        break;
      case 'edit-tasks':
        this._renderEditTasks(ctx, rect);
        break;
      case 'running':
        this._renderRunning(ctx, rect);
        break;
      case 'config':
        this._renderConfig(ctx, rect);
        break;
    }
  }

  /**
   * Render dashboard mode
   * @private
   */
  _renderDashboard(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    // Draw border
    const title = ' Execute Dashboard ';
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    // Status section
    const statusY = y + 1;
    const connIcon = this.serverStatus.connected ? '●' : '○';
    const connText = this.serverStatus.connected ? 'Connected' : 'Disconnected';
    const connStyle = this.serverStatus.connected ? styles.success : styles.error;

    // Show both connection status and local process status
    const procIcon = this.serverRunning ? '▶' : '■';
    const procText = this.serverRunning ? 'Running' : 'Stopped';
    const procStyle = this.serverRunning ? styles.success : styles.dim;

    screen.drawText(x + 2, statusY, `Server: ${connIcon} ${connText}`, connStyle);
    screen.drawText(x + 28, statusY, `[S] ${procIcon} ${procText}`, procStyle);

    // Options section
    const optionsY = statusY + 1;
    const dryRunText = `[D] Dry-run: ${this.dryRun ? 'ON ' : 'OFF'}`;
    const verboseText = `[V] Verbose: ${this.verbose ? 'ON ' : 'OFF'}`;
    const cleanText = `[X] Clean: ${this.cleanSandbox ? 'ON ' : 'OFF'}`;
    screen.drawText(x + 2, optionsY, dryRunText, this.dryRun ? styles.highlight : styles.dim);
    screen.drawText(x + 20, optionsY, verboseText, this.verbose ? styles.highlight : styles.dim);
    screen.drawText(x + 38, optionsY, cleanText, this.cleanSandbox ? styles.success : styles.dim);

    // Menu on left
    const menuRect = { x: x + 1, y: optionsY + 2, w: Math.floor(w / 2) - 2, h: h - 5 };
    this.dashboardMenu.render(ctx, menuRect);

    // Log viewer on right
    const logRect = { x: x + Math.floor(w / 2), y: y + 1, w: Math.floor(w / 2) - 1, h: h - 2 };
    this.logViewer.render(ctx, logRect);
  }

  /**
   * Render sessions list
   * @private
   */
  _renderSessions(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ` Sessions (${this.sessions.length}) `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    const menuRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    this.sessionsMenu.render(ctx, menuRect);
  }

  /**
   * Render session detail with task preview
   * @private
   */
  _renderSessionDetail(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const session = this.selectedSession;
    const title = ` Session: ${session?.id?.slice(0, 8) || 'Unknown'}... `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    if (!session) {
      screen.drawText(x + 2, y + 2, 'No session data', styles.dim);
      return;
    }

    // Header section
    let line = y + 1;
    screen.drawText(x + 2, line, `ID: ${session.id}`, styles.normal);
    screen.drawText(x + 45, line++, `State: ${session.state || 'unknown'}`, styles.accent);

    const goalsCount = session.goals?.items?.length || 0;
    const tasksCount = session.taskList?.tasks?.length || 0;
    screen.drawText(x + 2, line, `Goals: ${goalsCount}  |  Tasks: ${tasksCount}`, styles.dim);

    // Sandbox info
    if (this.sandboxInfo) {
      const sandboxStr = this.sandboxInfo.exists && this.sandboxInfo.size > 0
        ? `Sandbox: ${this._formatBytes(this.sandboxInfo.size)} [C] to clean`
        : 'Sandbox: clean';
      const sandboxStyle = this.sandboxInfo.exists && this.sandboxInfo.size > 0
        ? styles.warning : styles.success;
      screen.drawText(x + 35, line, sandboxStr, sandboxStyle);
    }
    line += 2;

    // Tasks preview section
    if (session.taskList?.tasks && session.taskList.tasks.length > 0) {
      screen.drawText(x + 2, line++, '─── Tasks ───', styles.accent);

      const tasks = session.taskList.tasks;
      const availableHeight = h - line + y - 2;
      const maxTasks = Math.min(tasks.length, availableHeight);

      // Clamp scroll offset
      const maxOffset = Math.max(0, tasks.length - maxTasks);
      this.taskScrollOffset = Math.min(this.taskScrollOffset, maxOffset);

      // Show scroll indicator
      if (tasks.length > maxTasks) {
        const scrollInfo = `[${this.taskScrollOffset + 1}-${this.taskScrollOffset + maxTasks}/${tasks.length}]`;
        screen.drawText(x + w - scrollInfo.length - 2, line - 1, scrollInfo, styles.dim);
      }

      // Check for circular dependencies
      const depGraph = this._buildTaskDepGraph(tasks);
      const cycles = this._detectCycles(depGraph);
      const cycleTaskIds = new Set(cycles.flat());

      // Render visible tasks
      for (let i = 0; i < maxTasks && line < y + h - 1; i++) {
        const taskIndex = i + this.taskScrollOffset;
        if (taskIndex >= tasks.length) break;

        const task = tasks[taskIndex];

        // Check if this task is blocked
        const deps = task.dependencies || [];
        const isBlocked = deps.some(d => {
          const depId = d.taskId || d;
          const depTask = tasks.find(t => t.id === depId);
          return !depTask || depTask.state !== 'completed';
        });
        const inCycle = cycleTaskIds.has(task.id);

        const stateIcon = inCycle ? '⟳' :
                         task.state === 'completed' ? '✓' :
                         task.state === 'running' ? '▶' :
                         task.state === 'failed' ? '✗' :
                         isBlocked ? '⊘' : '○';
        const stateStyle = inCycle ? styles.error :
                          task.state === 'completed' ? styles.success :
                          task.state === 'failed' ? styles.error :
                          task.state === 'running' ? styles.accent :
                          isBlocked ? styles.warning : styles.dim;

        const taskNum = String(taskIndex + 1).padStart(2, ' ');
        // Handle tool - might be string or object with name property
        const toolStr = typeof task.tool === 'string' ? task.tool :
                       (task.tool?.toolName || task.tool?.name || task.tool?.tool || '');
        const toolName = toolStr ? `[${toolStr}]` : '';
        // Handle description - might be string or object with text/description property
        const descStr = typeof task.description === 'string' ? task.description :
                       (task.description?.text || task.description?.description ||
                        (typeof task.objective === 'string' ? task.objective :
                        (task.objective?.text || task.objective?.objective || '')));

        // Add dependency indicator
        const depIndicator = deps.length > 0 ? ` (←${deps.length})` : '';
        const maxDescLen = w - 20 - toolName.length - depIndicator.length;
        const description = (descStr || '(no description)').slice(0, maxDescLen);

        screen.drawText(x + 2, line, `${taskNum}. ${stateIcon}`, stateStyle);
        screen.drawText(x + 8, line, toolName, styles.accent);
        screen.drawText(x + 8 + toolName.length + 1, line, description, styles.normal);
        if (deps.length > 0) {
          screen.drawText(x + 8 + toolName.length + 1 + description.length, line, depIndicator, styles.dim);
        }
        line++;
      }

      // Show cycle warning at bottom if detected
      if (cycles.length > 0 && line < y + h - 1) {
        line++;
        screen.drawText(x + 2, line, `⚠ ${cycles.length} circular dep(s) - press [G] for details`, styles.error);
      }
    } else {
      screen.drawText(x + 2, line++, '(No tasks - run "Prepare Session" first)', styles.dim);
    }
  }

  /**
   * Render edit-tasks mode (form-based editor)
   * @private
   */
  _renderEditTasks(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const tasks = this.selectedSession?.taskList?.tasks || [];
    const title = ` Edit Tasks (${tasks.length}) - Ctrl+S to Save `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    if (tasks.length === 0) {
      screen.drawText(x + 2, y + 2, 'No tasks to edit', styles.dim);
      return;
    }

    // Dependency selection mode - full screen overlay
    if (this.editDepMode) {
      this._renderDepSelector(ctx, rect, tasks);
      return;
    }

    // Tool selection mode - full screen overlay
    if (this.editToolMode) {
      this._renderToolSelector(ctx, rect, tasks);
      return;
    }

    // Split: task list (left 40%) and task editor (right 60%)
    const leftWidth = Math.floor((w - 2) * 0.4);
    const rightWidth = w - 2 - leftWidth - 1;

    // Left panel: Task list
    this._renderTaskList(ctx, { x: x + 1, y: y + 1, w: leftWidth, h: h - 2 }, tasks);

    // Divider
    for (let i = 1; i < h - 1; i++) {
      screen.drawText(x + leftWidth + 1, y + i, '│', styles.border);
    }

    // Right panel: Selected task editor
    this._renderTaskEditor(ctx, { x: x + leftWidth + 2, y: y + 1, w: rightWidth, h: h - 2 }, tasks);
  }

  /**
   * Render task list for form editor
   * @private
   */
  _renderTaskList(ctx, rect, tasks) {
    const { screen, styles } = ctx;
    const { x, y, w, h } = rect;

    screen.drawText(x, y, '── Tasks ──', styles.accent);

    const availableHeight = h - 2;
    const maxVisible = Math.min(tasks.length, availableHeight);

    // Clamp scroll offset
    const maxOffset = Math.max(0, tasks.length - maxVisible);
    if (this.editTaskIndex < this.taskScrollOffset) {
      this.taskScrollOffset = this.editTaskIndex;
    } else if (this.editTaskIndex >= this.taskScrollOffset + maxVisible) {
      this.taskScrollOffset = this.editTaskIndex - maxVisible + 1;
    }
    this.taskScrollOffset = Math.min(this.taskScrollOffset, maxOffset);

    // Scroll indicator
    if (tasks.length > maxVisible) {
      const scrollInfo = `[${this.taskScrollOffset + 1}-${Math.min(this.taskScrollOffset + maxVisible, tasks.length)}/${tasks.length}]`;
      screen.drawText(x + w - scrollInfo.length, y, scrollInfo, styles.dim);
    }

    for (let i = 0; i < maxVisible; i++) {
      const taskIdx = i + this.taskScrollOffset;
      if (taskIdx >= tasks.length) break;

      const task = tasks[taskIdx];
      const isSelected = taskIdx === this.editTaskIndex;
      const line = y + 1 + i;

      const prefix = isSelected ? '►' : ' ';
      const priority = task.priority || 5;
      const num = String(taskIdx + 1).padStart(2, ' ');

      // Truncate title to fit
      const titleStr = task.title || task.description || '(untitled)';
      const maxTitleLen = w - 10;
      const title = typeof titleStr === 'string' ? titleStr.slice(0, maxTitleLen) :
                   (titleStr.text || titleStr.description || '').slice(0, maxTitleLen);

      const style = isSelected ? styles.highlight : styles.normal;
      screen.drawText(x, line, `${prefix}${num}. P${priority}`, style);
      screen.drawText(x + 9, line, title, style);
    }
  }

  /**
   * Render task editor panel for form editor
   * @private
   */
  _renderTaskEditor(ctx, rect, tasks) {
    const { screen, styles } = ctx;
    const { x, y, w, h } = rect;

    const task = tasks[this.editTaskIndex];
    if (!task) return;

    screen.drawText(x, y, '── Edit Task ──', styles.accent);

    let line = y + 2;

    // Render each field
    for (let i = 0; i < this.taskFields.length; i++) {
      const field = this.taskFields[i];
      const isSelected = i === this.editFieldIndex;
      const isEditing = isSelected && this.editingField;

      const prefix = isSelected ? '►' : ' ';
      const labelStyle = isSelected ? styles.highlight : styles.normal;

      screen.drawText(x, line, `${prefix} ${this._fieldLabel(field)}:`, labelStyle);

      if (field === 'tool') {
        // Show current tool and hint
        const toolName = this._getToolName(task.tool);
        const toolText = toolName ? `${toolName} - [T] to change` : '(none) - [T] to select';
        screen.drawText(x + 20, line, toolText, isSelected ? styles.accent : styles.dim);
      } else if (field === 'dependencies') {
        // Show dependency count and hint
        const deps = task.dependencies || [];
        const depText = deps.length > 0
          ? `${deps.length} task(s) - [D] to edit`
          : 'None - [D] to add';
        screen.drawText(x + 20, line, depText, isSelected ? styles.accent : styles.dim);

        // Show dependency IDs on next line if any
        if (deps.length > 0 && line + 1 < y + h) {
          line++;
          const depIds = deps.map(d => {
            const depId = typeof d === 'string' ? d : (d.taskId || d.id || String(d));
            const depTask = tasks.find(t => t.id === depId);
            const depNum = depTask ? tasks.indexOf(depTask) + 1 : '?';
            return `#${depNum}`;
          }).join(', ');
          screen.drawText(x + 4, line, depIds.slice(0, w - 6), styles.dim);
        }
      } else if (isEditing) {
        // Show input with cursor
        const maxLen = w - 22;
        const displayVal = this.editFieldValue.slice(0, maxLen);
        screen.drawText(x + 20, line, displayVal + '█', styles.highlight);
      } else {
        // Show current value
        const value = task[field];
        let displayVal = '';
        if (value === undefined || value === null || value === '') {
          displayVal = '(empty)';
        } else if (typeof value === 'object') {
          displayVal = value.text || value.description || JSON.stringify(value).slice(0, w - 25);
        } else {
          displayVal = String(value).slice(0, w - 25);
        }
        screen.drawText(x + 20, line, displayVal, isSelected ? styles.normal : styles.dim);
      }

      line += 2;
    }

    // Instructions at bottom
    if (line + 2 < y + h) {
      line = y + h - 2;
      screen.drawText(x, line, '[↑↓] Select Field  [Enter] Edit  [D] Dependencies', styles.dim);
    }
  }

  /**
   * Get display label for a field
   * @private
   */
  _fieldLabel(field) {
    const labels = {
      title: 'Title',
      description: 'Description',
      tool: 'Tool',
      priority: 'Priority (1-10)',
      sequenceNumber: 'Sequence #',
      dependencies: 'Dependencies'
    };
    return labels[field] || field;
  }

  /**
   * Render dependency selector overlay
   * @private
   */
  _renderDepSelector(ctx, rect, tasks) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const currentTask = tasks[this.editTaskIndex];
    const otherTasks = tasks.filter((_, idx) => idx !== this.editTaskIndex);

    screen.drawText(x + 2, y + 1, `Select Dependencies for Task #${this.editTaskIndex + 1}`, styles.accent);
    screen.drawText(x + 2, y + 2, 'Use [↑↓] to navigate, [Space] to toggle, [Enter/Esc] to confirm', styles.dim);

    let line = y + 4;

    // Initialize nav index if needed
    if (this._depNavIndex === undefined) {
      this._depNavIndex = 0;
    }

    for (let i = 0; i < otherTasks.length && line < y + h - 1; i++) {
      const task = otherTasks[i];
      const taskNum = tasks.indexOf(task) + 1;
      const isNavSelected = i === this._depNavIndex;
      const isDepSelected = this.editDepSelected.has(task.id);

      const checkbox = isDepSelected ? '[✓]' : '[ ]';
      const prefix = isNavSelected ? '►' : ' ';

      const titleStr = task.title || task.description || '(untitled)';
      const title = typeof titleStr === 'string' ? titleStr : (titleStr.text || titleStr.description || '');
      const truncTitle = title.slice(0, w - 15);

      const style = isNavSelected ? styles.highlight : (isDepSelected ? styles.accent : styles.normal);
      screen.drawText(x + 2, line, `${prefix} ${checkbox} #${taskNum}: ${truncTitle}`, style);
      line++;
    }

    if (otherTasks.length === 0) {
      screen.drawText(x + 4, line, '(No other tasks available)', styles.dim);
    }

    // Show selected count
    line = y + h - 2;
    screen.drawText(x + 2, line, `Selected: ${this.editDepSelected.size} task(s)`, styles.accent);
  }

  /**
   * Render tool selector overlay
   * @private
   */
  _renderToolSelector(ctx, rect, tasks) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const currentTask = tasks[this.editTaskIndex];
    const currentToolName = this._getToolName(currentTask.tool);

    screen.drawText(x + 2, y + 1, `Select Tool for Task #${this.editTaskIndex + 1}`, styles.accent);
    screen.drawText(x + 2, y + 2, 'Use [↑↓/PgUp/PgDn] to navigate, [Enter] to select, [Esc] to cancel', styles.dim);

    let line = y + 4;

    // Calculate visible range for scrolling
    const visibleCount = h - 7;  // Leave space for header, footer, and current tool
    let startIdx = 0;

    // Scroll to keep selected tool visible
    if (this.toolNavIndex >= visibleCount) {
      startIdx = this.toolNavIndex - visibleCount + 1;
    }

    // Show current tool
    screen.drawText(x + 2, line++, `Current: ${currentToolName || '(none)'}`, styles.warning);
    line++;

    // Render tool list
    for (let i = 0; i < visibleCount && startIdx + i < this.availableTools.length; i++) {
      const idx = startIdx + i;
      const tool = this.availableTools[idx];
      const isSelected = idx === this.toolNavIndex;
      const isCurrent = tool.name === currentToolName;

      const prefix = isSelected ? '►' : ' ';
      const marker = isCurrent ? ' ◄' : '';
      const num = String(idx + 1).padStart(2, ' ');

      // Truncate tool name and description
      const toolName = tool.name || '(unnamed)';
      const desc = tool.description ? ` - ${tool.description}` : '';
      const maxDescLen = w - toolName.length - 12;
      const truncDesc = desc.slice(0, maxDescLen);

      const style = isSelected ? styles.highlight : (isCurrent ? styles.accent : styles.normal);
      screen.drawText(x + 2, line, `${prefix}${num}. ${toolName}${truncDesc}${marker}`, style);
      line++;
    }

    // Show scroll indicator if needed
    if (this.availableTools.length > visibleCount) {
      const scrollInfo = `[${startIdx + 1}-${Math.min(startIdx + visibleCount, this.availableTools.length)}/${this.availableTools.length}]`;
      screen.drawText(x + w - scrollInfo.length - 2, y + 1, scrollInfo, styles.dim);
    }

    // Show footer
    line = y + h - 2;
    screen.drawText(x + 2, line, `Tools: ${this.availableTools.length} | Use 1-9 for quick select`, styles.dim);
  }

  /**
   * Render running mode
   * @private
   */
  _renderRunning(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ' Executing... ';
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    // Progress bar
    if (this.executionProgress.total > 0) {
      const progressY = y + 1;
      const progressText = `Task ${this.executionProgress.current}/${this.executionProgress.total}`;
      screen.drawText(x + 2, progressY, progressText, styles.normal);

      const barRect = { x: x + 20, y: progressY, w: w - 24, h: 1 };
      this.progressBar.render(ctx, barRect);
    }

    // Log viewer
    const logRect = { x: x + 1, y: y + 3, w: w - 2, h: h - 4 };
    this.logViewer.render(ctx, logRect);
  }

  /**
   * Render config mode
   * @private
   */
  _renderConfig(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ' Environment Configuration ';
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    let line = y + 1;

    // Provider selector
    const providerName = this.providerList[this.selectedProvider];
    const providerLabel = providerName.charAt(0).toUpperCase() + providerName.slice(1);
    screen.drawText(x + 2, line, '[P] Provider:', styles.normal);
    screen.drawText(x + 17, line, providerLabel, styles.highlight);
    line += 2;

    // Environment variables
    for (let i = 0; i < this.envVarKeys.length; i++) {
      const key = this.envVarKeys[i];
      const value = this.envVars[key] || '';
      const isSelected = i === this.selectedEnvVar;
      const isEditing = isSelected && this.editingEnvVar;

      const prefix = isSelected ? '>' : ' ';
      const displayValue = key.includes('KEY') ? (value ? '***' : '(not set)') : (value || '(not set)');

      const style = isSelected ? styles.highlight : styles.normal;
      screen.drawText(x + 2, line, `${prefix} ${key}:`, style);

      if (isEditing) {
        screen.drawText(x + 25, line, this.envVarInput + '_', styles.highlight);
      } else {
        screen.drawText(x + 25, line, displayValue, isSelected ? styles.highlight : styles.dim);
      }

      line++;
    }

    line++;
    screen.drawText(x + 2, line, '[P] Switch Provider  [Enter] Edit  [Esc] Back', styles.dim);
  }
}

export default ExecuteTabScreen;
