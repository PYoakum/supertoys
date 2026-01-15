/**
 * @fileoverview Execute Tab Screen
 * @module tui/screens/execute-tab
 */

import { Menu } from '../components/menu.js';
import { LogViewer } from '../components/log-viewer.js';
import { ProgressBar } from '../components/progress-bar.js';
import { SplitPane } from '../components/split-pane.js';
import { SessionServerClient } from '../services/session-server-client.js';
import { ActionPlanRunner } from '../services/action-plan-runner.js';

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

    // Mode: 'dashboard' | 'sessions' | 'session-detail' | 'running' | 'config'
    this.mode = 'dashboard';

    // Services
    this.sessionClient = new SessionServerClient({
      baseUrl: this.state.serverUrl || 'http://localhost:3000'
    });
    this.actionRunner = new ActionPlanRunner({
      outputDir: this.state.outputDir || './output'
    });

    // Components
    this.dashboardMenu = new Menu({
      title: 'Actions',
      items: [
        'Create Session',
        'List Sessions',
        'Run Next Session',
        'Environment Config',
        'Refresh Status'
      ]
    });

    this.sessionsMenu = new Menu({ title: 'Sessions', items: [] });
    this.logViewer = new LogViewer({ maxLines: 200 });
    this.progressBar = new ProgressBar({ width: 40 });

    // State
    this.sessions = [];
    this.selectedSession = null;
    this.serverStatus = { connected: false, uptime: 0 };
    this.executionProgress = { current: 0, total: 0 };
    this.focused = false;

    // Environment variables for execution
    this.envVars = {
      SESSION_SERVER_URL: this.state.serverUrl || 'http://localhost:3000',
      LLM_API_KEY: process.env.LLM_API_KEY || '',
      LLM_MODEL: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
      OUTPUT_DIR: this.state.outputDir || './output',
      LOG_LEVEL: 'info'
    };
    this.envVarKeys = Object.keys(this.envVars);
    this.selectedEnvVar = 0;
    this.editingEnvVar = false;
    this.envVarInput = '';

    // Execution options
    this.dryRun = false;
    this.verbose = false;
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
  }

  /**
   * Blur the screen
   */
  blur() {
    this.focused = false;
  }

  /**
   * Get help text
   * @returns {string}
   */
  getHelpText() {
    switch (this.mode) {
      case 'dashboard':
        return '[Enter] Select  [D] Dry-run  [V] Verbose';
      case 'sessions':
        return '[Enter] View  [X] Delete  [R] Refresh  [Esc] Back';
      case 'session-detail':
        return '[E] Execute  [D] Dry-run  [Esc] Back';
      case 'running':
        return '[Esc] Abort';
      case 'config':
        return '[Enter] Edit  [Esc] Back';
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
    } catch (err) {
      this.serverStatus = { connected: false, uptime: 0 };
      if (this.state) {
        this.state.serverConnected = false;
      }
    }
  }

  /**
   * Load sessions list
   * @private
   */
  async _loadSessions() {
    try {
      const sessions = await this.sessionClient.listSessions();
      this.sessions = Array.isArray(sessions) ? sessions : (sessions.sessions || []);
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
      const result = await this.sessionClient.createSession(
        this.state.goals,
        this.state.context
      );

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
        case 'd':
          this.dryRun = !this.dryRun;
          this.logViewer.addLine('info', `Dry-run: ${this.dryRun ? 'ON' : 'OFF'}`);
          break;
        case 'v':
          this.verbose = !this.verbose;
          this.logViewer.addLine('info', `Verbose: ${this.verbose ? 'ON' : 'OFF'}`);
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
      case 0: // Create Session
        this._createSession();
        break;
      case 1: // List Sessions
        this._loadSessions();
        this.mode = 'sessions';
        break;
      case 2: // Run Next Session
        this._runNextSession();
        break;
      case 3: // Environment Config
        this.mode = 'config';
        break;
      case 4: // Refresh Status
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
          if (this.sessions.length > 0 && this.sessionsMenu.selected < this.sessions.length) {
            const session = this.sessions[this.sessionsMenu.selected];
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
        this.selectedSession = await this.sessionClient.getSession(this.sessions[index].id);
        this.mode = 'session-detail';
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
        case 'd':
          this.dryRun = !this.dryRun;
          this.logViewer.addLine('info', `Dry-run: ${this.dryRun ? 'ON' : 'OFF'}`);
          break;
      }
    }
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
    const statusIcon = this.serverStatus.connected ? '●' : '○';
    const statusText = this.serverStatus.connected ? 'Connected' : 'Disconnected';
    const statusStyle = this.serverStatus.connected ? styles.success : styles.error;

    screen.drawText(x + 2, statusY, `Server: ${statusIcon} ${statusText}`, statusStyle);

    // Options section
    const optionsY = statusY + 1;
    const dryRunText = `[D] Dry-run: ${this.dryRun ? 'ON ' : 'OFF'}`;
    const verboseText = `[V] Verbose: ${this.verbose ? 'ON ' : 'OFF'}`;
    screen.drawText(x + 2, optionsY, dryRunText, this.dryRun ? styles.highlight : styles.dim);
    screen.drawText(x + 20, optionsY, verboseText, this.verbose ? styles.highlight : styles.dim);

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
   * Render session detail
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

    let line = y + 1;
    screen.drawText(x + 2, line++, `ID: ${session.id}`, styles.normal);
    screen.drawText(x + 2, line++, `State: ${session.state || 'unknown'}`, styles.normal);
    screen.drawText(x + 2, line++, `Created: ${session.createdAt || 'unknown'}`, styles.dim);
    line++;

    if (session.goals?.items) {
      screen.drawText(x + 2, line++, `Goals: ${session.goals.items.length}`, styles.normal);
    }

    if (session.taskList?.tasks) {
      screen.drawText(x + 2, line++, `Tasks: ${session.taskList.tasks.length}`, styles.normal);
    }

    line++;
    screen.drawText(x + 2, line++, '[E] Execute  [D] Toggle dry-run  [Esc] Back', styles.dim);
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
    screen.drawText(x + 2, line, '[Enter] Edit  [Esc] Back', styles.dim);
  }
}

export default ExecuteTabScreen;
