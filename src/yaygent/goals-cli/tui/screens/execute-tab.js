/**
 * @fileoverview Execute Tab Screen
 * @module tui/screens/execute-tab
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFile, readFile } from 'fs/promises';
import { Menu } from '../components/menu.js';
import { LogViewer } from '../components/log-viewer.js';
import { ProgressBar } from '../components/progress-bar.js';
import { SplitPane } from '../components/split-pane.js';
import { SessionServerClient } from '../services/session-server-client.js';
import { ActionPlanRunner } from '../services/action-plan-runner.js';
import { OutputEvalRunner } from '../services/output-eval-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Word wrap text to fit within a given width
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum width in characters
 * @returns {string[]} Array of wrapped lines
 */
function wordWrap(text, maxWidth) {
  if (!text || maxWidth <= 0) return [''];

  const lines = [];
  const paragraphs = String(text).split('\n');

  for (const para of paragraphs) {
    if (para.length <= maxWidth) {
      lines.push(para);
      continue;
    }

    const words = para.split(' ');
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        // Handle words longer than maxWidth
        if (word.length > maxWidth) {
          let remaining = word;
          while (remaining.length > maxWidth) {
            lines.push(remaining.slice(0, maxWidth));
            remaining = remaining.slice(maxWidth);
          }
          currentLine = remaining;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

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
    this.taskFields = ['title', 'description', 'tool', 'priority', 'sequenceNumber', 'scheduledAt', 'dependencies'];

    // Import mode state
    this.importMode = false;          // Currently entering import filename
    this.importFilename = '';         // Import filename buffer

    // Status message for edit-tasks mode feedback
    this.statusMessage = '';          // Current status message
    this.statusType = 'info';         // 'success', 'error', 'info'
    this.statusExpiry = 0;            // Timestamp when message expires

    // Services
    this.sessionClient = new SessionServerClient({
      baseUrl: this.state.serverUrl || 'http://localhost:3000'
    });
    this.actionRunner = new ActionPlanRunner({
      outputDir: this.state.outputDir || './output'
    });
    this.outputEvalRunner = new OutputEvalRunner({
      outputDir: this.state.outputDir || './evaluation-output'
    });

    // Server management
    this.serverProcess = null;
    this.serverRunning = false;
    this.serverPath = resolve(__dirname, '../../../goals-session-server/server.js');

    // Components
    this.dashboardMenu = new Menu({
      title: 'Actions',
      items: [
        '☆ Run All ☆',
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

    // Run All state
    this.runAllActive = false;
    this.runAllPhase = null;  // 'server' | 'session' | 'prepare' | 'execute' | 'eval'

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
    this.outputEvalRunner = new OutputEvalRunner({
      outputDir: state.outputDir || './evaluation-output'
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
   * Used to prevent tab switching via number keys during text input or selection
   * @returns {boolean}
   */
  isInputMode() {
    return this.editingEnvVar ||
           this.importMode ||
           this.editDepMode ||
           this.editToolMode ||
           (this.mode === 'edit-tasks' && this.editingField);
  }

  /**
   * Get help text
   * @returns {string}
   */
  getHelpText() {
    switch (this.mode) {
      case 'dashboard':
        return '[S] Server  [K] Kill Session  [D] Dry-run  [V] Verbose  [X] Clean Sandbox  [+/-] Scroll  [Enter] Select';
      case 'sessions':
        return '[Enter] View  [K] Kill  [R] Refresh  [Esc] Back';
      case 'session-detail':
        return '[E] Execute  [I] Import Tasks  [T] Edit Tasks  [C] Clean  [G] Graph  [K] Kill  [Esc] Back';
      case 'edit-tasks':
        return '[N] New  [X] Delete  [E] Export  [I] Import  [↑↓] Task  [←→] Field  [Enter] Edit  [T] Tool  [D] Deps  [Ctrl+S] Save  [Esc] Back';
      case 'running':
        return '[+/-] Scroll Log  [Esc] Abort';
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
    items[1] = this.serverRunning ? 'Stop Server' : 'Start Server';
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
   * Run All - Sequential workflow: server → session → prepare → execute → eval
   * @private
   */
  async _runAll() {
    if (this.runAllActive) {
      this.logViewer.addLine('warn', 'Run All is already in progress');
      return;
    }

    // Validate prerequisites
    if (!this.state.goals) {
      this.logViewer.addLine('error', 'No goals loaded. Load goals first.');
      return;
    }

    if (!this.envVars.LLM_API_KEY) {
      this.logViewer.addLine('error', 'No API key configured!');
      this.logViewer.addLine('warn', 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.');
      return;
    }

    this.runAllActive = true;
    this.logViewer.clear();
    this.logViewer.addLine('info', '════════════════════════════════════════');
    this.logViewer.addLine('info', '      ☆ RUN ALL - Starting Workflow ☆');
    this.logViewer.addLine('info', '════════════════════════════════════════');

    try {
      // Phase 1: Start Server (if not already running)
      this.runAllPhase = 'server';
      if (!this.serverStatus.connected) {
        this.logViewer.addLine('info', '');
        this.logViewer.addLine('info', '▶ Phase 1/5: Starting Server...');

        if (!this.serverRunning) {
          this._startServer();
        }

        // Wait for server to be ready (poll up to 30 seconds)
        let serverReady = false;
        for (let i = 0; i < 30; i++) {
          await this._sleep(1000);
          try {
            await this.sessionClient.healthCheck();
            serverReady = true;
            break;
          } catch (e) {
            // Keep waiting
          }
        }

        if (!serverReady) {
          throw new Error('Server failed to start within 30 seconds');
        }
        this.logViewer.addLine('success', '✓ Server is running');
      } else {
        this.logViewer.addLine('info', '');
        this.logViewer.addLine('info', '▶ Phase 1/5: Server already running');
        this.logViewer.addLine('success', '✓ Server is connected');
      }

      // Phase 2: Create Session
      this.runAllPhase = 'session';
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '▶ Phase 2/5: Creating Session...');

      const context = this.state.context || {
        files: [],
        metadata: { source: 'tui-runall', createdAt: new Date().toISOString() }
      };

      const createResponse = await this.sessionClient.createSession(this.state.goals, context);
      const createResult = createResponse.data || createResponse;

      if (!createResult.sessionId) {
        throw new Error('Failed to create session - no sessionId returned');
      }

      this.state.sessionId = createResult.sessionId;
      const sessionId = createResult.sessionId;
      this.logViewer.addLine('success', `✓ Session created: ${sessionId.slice(0, 8)}...`);

      // Phase 3: Prepare Session (Evaluate + Generate Tasks)
      this.runAllPhase = 'prepare';
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '▶ Phase 3/5: Preparing Session...');
      this.logViewer.addLine('info', '  → Evaluating dependencies...');

      const evalResponse = await this.sessionClient.evaluate(sessionId);
      const evalResult = evalResponse.data || evalResponse;
      this.logViewer.addLine('info', `  → Evaluation complete: ${evalResult.state}`);

      this.logViewer.addLine('info', '  → Generating task list...');
      const taskResponse = await this.sessionClient.generateTaskList(sessionId);
      const taskResult = taskResponse.data || taskResponse;
      const taskCount = taskResult.taskList?.tasks?.length || 0;
      this.logViewer.addLine('success', `✓ Prepared ${taskCount} tasks`);

      // Phase 4: Execute Action Plan
      this.runAllPhase = 'execute';
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '▶ Phase 4/5: Executing Action Plan...');

      // Clean sandbox if enabled
      if (this.cleanSandbox && !this.dryRun) {
        try {
          const infoResponse = await this.sessionClient.getSandboxInfo(sessionId);
          const info = infoResponse.data || infoResponse;
          if (info.exists && info.size > 0) {
            await this.sessionClient.cleanupSandbox(sessionId);
            this.logViewer.addLine('info', '  → Sandbox cleaned');
          }
        } catch (e) {
          // Non-fatal
        }
      }

      this.mode = 'running';
      this.executionProgress = { current: 0, total: taskCount };

      const execResult = await this.actionRunner.run(sessionId, {
        dryRun: this.dryRun,
        verbose: this.verbose,
        env: this.envVars,
        onLog: (level, message) => {
          this.logViewer.addLine(level, message);
        },
        onProgress: (current, total) => {
          this.executionProgress = { current, total };
          this.progressBar.setValue(current, total);
        }
      });

      if (!execResult.success) {
        this.logViewer.addLine('warn', `  → Execution completed with exit code: ${execResult.exitCode}`);
      } else {
        this.logViewer.addLine('success', '✓ All tasks completed');
      }

      // Phase 5: Run Output Eval
      this.runAllPhase = 'eval';
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '▶ Phase 5/5: Running Output Evaluation...');

      // Find the bundle path - it should be in the output directory
      const outputDir = this.envVars.OUTPUT_DIR || './output';
      const bundlePath = resolve(process.cwd(), outputDir, sessionId);

      const evalRunResult = await this.outputEvalRunner.run(bundlePath, {
        format: 'all',
        verbose: this.verbose,
        onLog: (level, message) => {
          this.logViewer.addLine(level, message);
        }
      });

      if (evalRunResult.scores) {
        this.logViewer.addLine('success', `✓ Evaluation complete: ${evalRunResult.scores.overall}/100 (${evalRunResult.scores.grade})`);
      } else {
        this.logViewer.addLine('success', '✓ Evaluation complete');
      }

      // Complete!
      this.logViewer.addLine('info', '');
      this.logViewer.addLine('info', '════════════════════════════════════════');
      this.logViewer.addLine('success', '   ☆ RUN ALL COMPLETE ☆');
      this.logViewer.addLine('info', '════════════════════════════════════════');
      this._setStatus('☆ Run All complete!', 'success', 10000);

    } catch (err) {
      this.logViewer.addLine('error', `Run All failed in phase "${this.runAllPhase}": ${err.message}`);
      this._setStatus(`Run All failed: ${err.message}`, 'error', 10000);
    } finally {
      this.runAllActive = false;
      this.runAllPhase = null;
      this.mode = 'dashboard';
      await this._loadSessions();
    }
  }

  /**
   * Sleep helper for async delays
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
        metadata: {
          source: 'tui',
          createdAt: new Date().toISOString()
        }
      };

      // Log context info
      const fileCount = context.files?.length || 0;
      const totalSize = context.metadata?.totalSize || 0;
      if (fileCount > 0) {
        this.logViewer.addLine('info', `Context: ${fileCount} files, ${Math.round(totalSize / 1024)}KB`);
      } else {
        this.logViewer.addLine('warn', 'No context files loaded! LLM will have limited information.');
        this.logViewer.addLine('info', 'Tip: Switch to Context tab and load files first.');
      }

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
      // Get session info for context details
      const sessionInfo = await this.sessionClient.getSession(sessionId);
      const sessionData = sessionInfo.data || sessionInfo;
      const contextFiles = sessionData.context?.files?.length || sessionData.context?.fileCount || 0;
      const goalsCount = sessionData.goals?.items?.length || 0;

      // Step 1: Evaluate the session
      this.logViewer.addLine('info', '── Step 1/2: Evaluating dependencies ──');
      this.logViewer.addLine('info', `[LLM] → Sending evaluation request...`);
      this.logViewer.addLine('debug', `[LLM]   Goals: ${goalsCount}, Context files: ${contextFiles}`);

      const evalStartTime = Date.now();
      const evalResponse = await this.sessionClient.evaluate(sessionId);
      const evalDuration = Date.now() - evalStartTime;
      const evalResult = evalResponse.data || evalResponse;

      this.logViewer.addLine('info', `[LLM] ← Response received (${evalDuration}ms)`);

      // Show token usage if available
      if (evalResult.evaluation?.tokenUsage) {
        const usage = evalResult.evaluation.tokenUsage;
        this.logViewer.addLine('debug', `[LLM]   Tokens: ${usage.inputTokens || 0} in / ${usage.outputTokens || 0} out`);
      }

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
      this.logViewer.addLine('info', `[LLM] → Sending task generation request...`);
      this.logViewer.addLine('debug', `[LLM]   Processing ${goalsCount} goals (batched per goal)`);

      const taskStartTime = Date.now();
      const taskResponse = await this.sessionClient.generateTaskList(sessionId);
      const taskDuration = Date.now() - taskStartTime;
      const taskResult = taskResponse.data || taskResponse;

      this.logViewer.addLine('info', `[LLM] ← Response received (${taskDuration}ms)`);

      // Show token usage if available
      if (taskResult.taskList?.tokenUsage) {
        const usage = taskResult.taskList.tokenUsage;
        this.logViewer.addLine('debug', `[LLM]   Tokens: ${usage.inputTokens || 0} in / ${usage.outputTokens || 0} out`);
      }

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
            this.logViewer.addLine('success', '════════════════════════════════════════');
            this.logViewer.addLine('success', '✓ ALL TASKS COMPLETED SUCCESSFULLY');
            this.logViewer.addLine('success', '════════════════════════════════════════');
          } else if (result.aborted) {
            this.logViewer.addLine('warn', 'Execution aborted by user');
          } else {
            this.logViewer.addLine('error', `Execution failed with exit code: ${result.exitCode}`);
          }
        }
      });

      // Refresh session data after execution
      try {
        const sessionData = await this.sessionClient.getSession(sessionId);
        this.selectedSession = sessionData.data || sessionData;
      } catch (e) {
        // Session may have been deleted - ignore
      }

      this.mode = 'dashboard';
      this._setStatus(result.success ? '✓ Execution complete' : '✗ Execution failed', result.success ? 'success' : 'error', 5000);
    } catch (err) {
      this.logViewer.addLine('error', `Execution error: ${err.message}`);
      this.mode = 'dashboard';
      this._setStatus(`Execution error: ${err.message}`, 'error', 5000);
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
        },
        onComplete: (success, res) => {
          if (success) {
            this.logViewer.addLine('success', '════════════════════════════════════════');
            this.logViewer.addLine('success', '✓ ALL TASKS COMPLETED SUCCESSFULLY');
            this.logViewer.addLine('success', '════════════════════════════════════════');
          } else if (res.aborted) {
            this.logViewer.addLine('warn', 'Execution aborted by user');
          } else if (res.exitCode !== 0) {
            this.logViewer.addLine('error', `Execution failed with exit code: ${res.exitCode}`);
          }
        }
      });

      if (result.sessionId) {
        this.logViewer.addLine('info', `Session: ${result.sessionId}`);
        this._setStatus(result.success ? '✓ Execution complete' : '✗ Execution failed', result.success ? 'success' : 'error', 5000);
      } else if (result.exitCode === 0 && !result.sessionId) {
        this.logViewer.addLine('info', 'No sessions ready for execution');
      }

      this.mode = 'dashboard';
    } catch (err) {
      this.logViewer.addLine('error', `Error: ${err.message}`);
      this.mode = 'dashboard';
      this._setStatus(`Error: ${err.message}`, 'error', 5000);
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
    // Pass scroll events (+/-) to log viewer first
    if (this.logViewer.onEvent(ctx, evt)) {
      return;
    }

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
      case 0: // ☆ Run All ☆
        this._runAll();
        break;
      case 1: // Start/Stop Server
        this._toggleServer();
        break;
      case 2: // Create Session
        this._createSession();
        break;
      case 3: // Prepare Session (Evaluate + Generate Tasks)
        this._prepareSession();
        break;
      case 4: // List Sessions
        this._loadSessions();
        this.mode = 'sessions';
        break;
      case 5: // Run Next Session
        this._runNextSession();
        break;
      case 6: // Kill Session
        this._killCurrentSession();
        break;
      case 7: // Environment Config
        this.mode = 'config';
        break;
      case 8: // Refresh Status
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
          if (this.selectedSession) {
            this._startEditTasks();
          }
          break;
        case 'g':
          this._showDependencyGraph();
          break;
        case 'i':
          // Import tasks directly (skip prepare step)
          if (this.selectedSession) {
            this._startImportFromSessionDetail();
          }
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
   * Start import mode from session-detail view
   * Allows importing tasks without running "Prepare Session" first
   * @private
   */
  _startImportFromSessionDetail() {
    // Initialize taskList if it doesn't exist
    if (!this.selectedSession.taskList) {
      this.selectedSession.taskList = { tasks: [] };
    }

    // Enter edit-tasks mode with import mode active
    this.mode = 'edit-tasks';
    this.editTaskIndex = 0;
    this.editFieldIndex = 0;
    this.editingField = false;
    this.importMode = true;
    this.importFilename = '';
    this.logViewer.addLine('info', 'Enter filename to import (or Esc to cancel)');
  }

  /**
   * Start editing tasks in form mode
   * @private
   */
  async _startEditTasks() {
    if (!this.selectedSession) return;

    // Initialize taskList if it doesn't exist
    if (!this.selectedSession.taskList) {
      this.selectedSession.taskList = { tasks: [] };
    }

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

    // Handle import filename input mode
    if (this.importMode) {
      this._handleImportEvent(ctx, evt);
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
          if (tasks.length > 0) {
            this.editTaskIndex = Math.max(0, this.editTaskIndex - 1);
          }
          return;
        case 'down':
          if (tasks.length > 0) {
            this.editTaskIndex = Math.min(tasks.length - 1, this.editTaskIndex + 1);
          }
          return;
        case 'left':
          this.editFieldIndex = Math.max(0, this.editFieldIndex - 1);
          return;
        case 'right':
          this.editFieldIndex = Math.min(this.taskFields.length - 1, this.editFieldIndex + 1);
          return;
        case 'enter':
          if (tasks.length > 0) {
            this._startFieldEdit(tasks);
          }
          return;
        case 'delete':
          if (tasks.length > 0) {
            this._deleteCurrentTask(tasks);
          }
          return;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'n':
          // Create new task
          this._createNewTask();
          return;
        case 'd':
          // Quick toggle dependency mode
          if (tasks.length > 0) {
            this._startDepEdit(tasks);
          }
          return;
        case 't':
          // Quick toggle tool selection mode
          if (tasks.length > 0) {
            this._startToolEdit(tasks);
          }
          return;
        case 'x':
          // Delete current task
          if (tasks.length > 0) {
            this._deleteCurrentTask(tasks);
          }
          return;
        case 'e':
          // Export tasks to file
          this._exportTasks();
          return;
        case 'i':
          // Import tasks from file
          this._startImport();
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
    // Handle object values (e.g., description: { text: '...' })
    if (value === undefined || value === null) {
      this.editFieldValue = '';
    } else if (typeof value === 'object') {
      this.editFieldValue = value.text || value.description || '';
    } else {
      this.editFieldValue = String(value);
    }
  }

  /**
   * Create a new task with default values
   * @private
   */
  _createNewTask() {
    if (!this.selectedSession?.taskList) {
      // Initialize task list if it doesn't exist
      this.selectedSession.taskList = { tasks: [] };
    }

    const tasks = this.selectedSession.taskList.tasks;

    // Generate a unique ID for the new task
    const newTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create new task with default values
    const newTask = {
      id: newTaskId,
      title: 'New Task',
      description: '',
      tool: {
        toolName: '',
        command: { action: 'execute', parameters: {}, expectedOutput: '' }
      },
      priority: 5,
      sequenceNumber: tasks.length + 1,
      scheduledAt: null,
      dependencies: [],
      state: 'pending',
      goalId: this.selectedSession.goals?.items?.[0]?.id || null,
      createdAt: new Date().toISOString()
    };

    // Add the new task to the list
    tasks.push(newTask);

    // Select the new task for editing
    this.editTaskIndex = tasks.length - 1;
    this.editFieldIndex = 0; // Start at title field

    this.logViewer.addLine('info', `Created new task: ${newTaskId.slice(0, 12)}...`);
    this.logViewer.addLine('info', 'Edit the task fields, then press [Ctrl+S] to save');
  }

  /**
   * Delete the currently selected task
   * @param {Object[]} tasks
   * @private
   */
  _deleteCurrentTask(tasks) {
    if (tasks.length === 0) return;

    const taskToDelete = tasks[this.editTaskIndex];
    const taskId = taskToDelete.id;
    const taskTitle = taskToDelete.title || '(untitled)';

    // Remove the task
    tasks.splice(this.editTaskIndex, 1);

    // Adjust selection index if needed
    if (this.editTaskIndex >= tasks.length) {
      this.editTaskIndex = Math.max(0, tasks.length - 1);
    }

    // Remove any dependencies pointing to this task
    for (const task of tasks) {
      if (task.dependencies && task.dependencies.length > 0) {
        task.dependencies = task.dependencies.filter(dep => {
          const depId = typeof dep === 'string' ? dep : (dep.taskId || dep.id);
          return depId !== taskId;
        });
      }
    }

    this.logViewer.addLine('warn', `Deleted task: ${taskTitle}`);
    this.logViewer.addLine('info', 'Press [Ctrl+S] to save changes');
  }

  /**
   * Set a temporary status message for edit-tasks mode
   * @param {string} message
   * @param {string} type - 'success', 'error', 'info'
   * @param {number} [durationMs=3000] - How long to show the message
   * @private
   */
  _setStatus(message, type = 'info', durationMs = 3000) {
    this.statusMessage = message;
    this.statusType = type;
    this.statusExpiry = Date.now() + durationMs;
  }

  /**
   * Export tasks to a JSON file
   * @private
   */
  async _exportTasks() {
    const tasks = this.selectedSession?.taskList?.tasks || [];
    if (tasks.length === 0) {
      this._setStatus('No tasks to export', 'error');
      return;
    }

    try {
      // Build ID to title map for dependency resolution
      const idToTitle = new Map();
      for (const task of tasks) {
        idToTitle.set(task.id, task.title || '(untitled)');
      }

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const sessionId = (this.selectedSession.id || 'unknown').slice(0, 8);
      const filename = `tasks-${sessionId}-${timestamp}.json`;
      const exportPath = resolve(process.cwd(), filename);

      // Build export data with portable format (titles for dependencies)
      const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        tasks: tasks.map(t => {
          // Extract tool info - preserve full structure for reimport
          let toolExport;
          if (typeof t.tool === 'object' && t.tool) {
            toolExport = {
              toolName: t.tool.toolName || '',
              command: t.tool.command || { action: 'execute', parameters: {}, expectedOutput: '' }
            };
          } else {
            toolExport = {
              toolName: t.tool || '',
              command: { action: 'execute', parameters: {}, expectedOutput: '' }
            };
          }

          return {
            title: t.title || '',
            description: typeof t.description === 'object' ? (t.description.text || t.description.description || '') : (t.description || ''),
            tool: toolExport,
            priority: t.priority || 5,
            dependencies: (t.dependencies || []).map(dep => {
              const depId = typeof dep === 'string' ? dep : (dep.taskId || dep.id);
              return idToTitle.get(depId) || depId;
            }),
            scheduledAt: t.scheduledAt || null
          };
        })
      };

      await writeFile(exportPath, JSON.stringify(exportData, null, 2));
      this._setStatus(`✓ Exported ${tasks.length} tasks to ${filename}`, 'success', 4000);
      this.logViewer.addLine('success', `Exported ${tasks.length} tasks to ${filename}`);
    } catch (err) {
      this._setStatus(`Export failed: ${err.message}`, 'error', 4000);
      this.logViewer.addLine('error', `Export failed: ${err.message}`);
    }
  }

  /**
   * Start import mode - prompt for filename
   * @private
   */
  _startImport() {
    this.importMode = true;
    this.importFilename = '';
    this.logViewer.addLine('info', 'Enter filename to import (or Esc to cancel)');
  }

  /**
   * Handle import filename input events
   * @param {Object} ctx
   * @param {Object} evt
   * @private
   */
  _handleImportEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'enter':
          if (this.importFilename.trim()) {
            this._importTasks(this.importFilename.trim());
          }
          this.importMode = false;
          this.importFilename = '';
          return;
        case 'esc':
          this.importMode = false;
          this.importFilename = '';
          this.logViewer.addLine('info', 'Import cancelled');
          return;
        case 'backspace':
          this.importFilename = this.importFilename.slice(0, -1);
          return;
        case 'space':
          this.importFilename += ' ';
          return;
      }
    }

    if (evt.type === 'text') {
      this.importFilename += evt.text;
    }
  }

  /**
   * Import tasks from a JSON file
   * @param {string} filename
   * @private
   */
  async _importTasks(filename) {
    try {
      const filepath = resolve(process.cwd(), filename);
      const content = await readFile(filepath, 'utf-8');
      const data = JSON.parse(content);

      if (!data.tasks || !Array.isArray(data.tasks)) {
        throw new Error('Invalid task file format: missing tasks array');
      }

      // Initialize taskList if needed
      if (!this.selectedSession.taskList) {
        this.selectedSession.taskList = { tasks: [] };
      }

      const existingTasks = this.selectedSession.taskList.tasks;
      let imported = 0;

      for (const task of data.tasks) {
        // Handle tool - can be string (legacy) or object (full structure)
        let toolObj;
        if (typeof task.tool === 'object' && task.tool) {
          toolObj = {
            toolName: task.tool.toolName || '',
            command: task.tool.command || { action: 'execute', parameters: {}, expectedOutput: '' }
          };
        } else if (typeof task.tool === 'string' && task.tool) {
          toolObj = {
            toolName: task.tool,
            command: { action: 'execute', parameters: {}, expectedOutput: '' }
          };
        } else {
          toolObj = {
            toolName: '',
            command: { action: 'execute', parameters: {}, expectedOutput: '' }
          };
        }

        const newTask = {
          id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: task.title || 'Imported Task',
          description: task.description || '',
          tool: toolObj,
          priority: task.priority || 5,
          sequenceNumber: existingTasks.length + imported + 1,
          dependencies: [], // Resolve after all imported
          state: 'pending',
          scheduledAt: task.scheduledAt || null,
          goalId: this.selectedSession.goals?.items?.[0]?.id || null,
          createdAt: new Date().toISOString(),
          _importedDeps: task.dependencies || [] // Store for resolution
        };
        existingTasks.push(newTask);
        imported++;
      }

      // Resolve dependencies by title matching
      this._resolveImportedDependencies(existingTasks);

      this._setStatus(`✓ Imported ${imported} tasks from ${filename}`, 'success', 4000);
      this.logViewer.addLine('success', `Imported ${imported} tasks from ${filename}`);
      this.logViewer.addLine('info', 'Press [Ctrl+S] to save changes');
    } catch (err) {
      this._setStatus(`Import failed: ${err.message}`, 'error', 4000);
      this.logViewer.addLine('error', `Import failed: ${err.message}`);
    }
  }

  /**
   * Resolve imported dependencies by matching task titles to IDs
   * @param {Object[]} tasks
   * @private
   */
  _resolveImportedDependencies(tasks) {
    // Build title to ID map
    const titleToId = new Map();
    for (const task of tasks) {
      if (task.title) {
        titleToId.set(task.title, task.id);
      }
    }

    // Resolve _importedDeps to actual task IDs
    for (const task of tasks) {
      if (task._importedDeps && task._importedDeps.length > 0) {
        task.dependencies = task._importedDeps
          .map(depTitle => titleToId.get(depTitle))
          .filter(id => id != null);
        delete task._importedDeps;
      }
    }
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
        case 'space':
          // Space key
          this.editFieldValue += ' ';
          return;
        case 'delete':
          // Delete key - remove character at cursor (for now, same as backspace)
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
      // Preserve object structure if original was an object
      const originalValue = task[field];
      if (typeof originalValue === 'object' && originalValue !== null) {
        if ('text' in originalValue) {
          task[field] = { ...originalValue, text: this.editFieldValue };
        } else if ('description' in originalValue) {
          task[field] = { ...originalValue, description: this.editFieldValue };
        } else {
          task[field] = this.editFieldValue;
        }
      } else {
        task[field] = this.editFieldValue;
      }
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
        case 'space':
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

    // Update task.tool - ensure full structure for execution
    if (typeof task.tool === 'object' && task.tool !== null) {
      task.tool.toolName = selectedTool.name;
      task.tool.name = selectedTool.name;
      // Ensure command structure exists
      if (!task.tool.command) {
        task.tool.command = { action: 'execute', parameters: {}, expectedOutput: '' };
      }
    } else {
      task.tool = {
        toolName: selectedTool.name,
        name: selectedTool.name,
        command: { action: 'execute', parameters: {}, expectedOutput: '' }
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

      // Use importTaskList which bypasses state checks and sets state to GENERATED
      const response = await this.sessionClient.importTaskList(
        this.selectedSession.id,
        taskList
      );

      const result = response.data || response;
      this.selectedSession.taskList = result.taskList || taskList;
      // Update local session state to match server
      this.selectedSession.state = result.state || 'GENERATED';

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

    // Status message (execution completion feedback)
    let menuStartY = optionsY + 2;
    if (this.statusMessage && Date.now() < this.statusExpiry) {
      const statusStyle = this.statusType === 'success' ? styles.success
        : this.statusType === 'error' ? styles.error
        : styles.highlight;
      const statusBg = this.statusType === 'success' ? '  ' : this.statusType === 'error' ? '  ' : '  ';
      screen.drawText(x + 2, optionsY + 2, `${statusBg}${this.statusMessage}${statusBg}`.padEnd(w - 4), statusStyle);
      menuStartY = optionsY + 3;
    }

    // Menu on left
    const menuRect = { x: x + 1, y: menuStartY, w: Math.floor(w / 2) - 2, h: h - (menuStartY - y) - 1 };
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
    line += 1;

    // Status message (execution completion feedback)
    if (this.statusMessage && Date.now() < this.statusExpiry) {
      const statusStyle = this.statusType === 'success' ? styles.success
        : this.statusType === 'error' ? styles.error
        : styles.highlight;
      screen.drawText(x + 2, line, this.statusMessage.padEnd(w - 4), statusStyle);
      line += 1;
    }
    line += 1;

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

    // Import mode - show filename input (check BEFORE empty tasks check)
    if (this.importMode) {
      // Show import prompt even if no tasks yet
      screen.drawText(x + 2, y + 2, 'Import tasks from file:', styles.accent);
      screen.drawText(x + 2, y + 4, 'Filename: ' + this.importFilename + '█', styles.highlight);
      screen.drawText(x + 2, y + 6, '[Enter] Import  [Esc] Cancel', styles.dim);
      return;
    }

    if (tasks.length === 0) {
      screen.drawText(x + 2, y + 2, 'No tasks yet. Press [N] to create first task, or [I] to import.', styles.dim);
      screen.drawText(x + 2, y + 4, '[Esc] Back', styles.dim);
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

    // Show status message if active
    if (this.statusMessage && Date.now() < this.statusExpiry) {
      const statusStyle = this.statusType === 'success' ? styles.success :
                          this.statusType === 'error' ? styles.error : styles.accent;
      // Draw status bar at bottom
      const statusText = ` ${this.statusMessage} `.slice(0, w - 4);
      screen.drawText(x + 2, y + h - 1, statusText, statusStyle);
    }
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
      } else if (field === 'description') {
        // Word wrap description across multiple lines
        const value = task[field];
        let textVal = '';
        if (value === undefined || value === null || value === '') {
          textVal = '(empty)';
        } else if (typeof value === 'object') {
          textVal = value.text || value.description || JSON.stringify(value);
        } else {
          textVal = String(value);
        }

        const maxWidth = w - 22;
        const maxDescLines = 4; // Limit to 4 lines for description
        const wrappedLines = wordWrap(textVal, maxWidth);
        const displayLines = wrappedLines.slice(0, maxDescLines);

        // Show first line on same line as label
        screen.drawText(x + 20, line, displayLines[0] || '(empty)', isSelected ? styles.normal : styles.dim);

        // Show additional wrapped lines below
        for (let j = 1; j < displayLines.length && line + j < y + h - 3; j++) {
          screen.drawText(x + 20, line + j, displayLines[j], styles.dim);
        }

        // If there are more lines, show ellipsis
        if (wrappedLines.length > maxDescLines) {
          const lastLineIdx = Math.min(displayLines.length, maxDescLines);
          if (line + lastLineIdx < y + h - 3) {
            screen.drawText(x + 20, line + lastLineIdx, '...', styles.dim);
          }
        }

        // Advance line by number of wrapped lines displayed
        line += Math.max(0, displayLines.length - 1);
      } else {
        // Show current value (non-description fields)
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
      scheduledAt: 'Schedule',
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
