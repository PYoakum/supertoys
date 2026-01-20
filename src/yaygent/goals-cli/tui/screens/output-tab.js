/**
 * @fileoverview Output Tab Screen
 * @module tui/screens/output-tab
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { resolve, join, basename } from 'path';
import { Menu } from '../components/menu.js';
import { TextArea } from '../components/text-area.js';
import { ProgressBar, scoreBar } from '../components/progress-bar.js';
import { OutputEvalRunner } from '../services/output-eval-runner.js';

/**
 * Output Tab Screen - View bundles, reports, and scores
 */
export class OutputTabScreen {
  /**
   * @param {Object} options
   * @param {Object} [options.state] - Shared state reference
   */
  constructor(options = {}) {
    this.state = options.state || {};

    // Mode: 'list' | 'bundle' | 'report' | 'scores'
    this.mode = 'list';

    // Paths
    this.outputDir = this.state.outputDir || './output';
    this.evalOutputDir = './evaluation-output';

    // Services
    this.evalRunner = new OutputEvalRunner({
      outputDir: this.evalOutputDir
    });

    // Components
    this.bundleMenu = new Menu({ title: 'Output Bundles', items: [] });
    this.reportViewer = new TextArea({ readOnly: true });
    this.scoreBar = new ProgressBar({ width: 30 });

    // State
    this.bundles = [];
    this.selectedBundle = null;
    this.bundleData = null;
    this.reportContent = '';
    this.scores = null;
    this.focused = false;
  }

  /**
   * Set shared state reference
   * @param {Object} state
   */
  setState(state) {
    this.state = state;
    this.outputDir = state.outputDir || this.outputDir;
  }

  /**
   * Focus the screen
   */
  focus() {
    this.focused = true;
    this._loadBundles();
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
      case 'list':
        return '[Enter] View  [E] Evaluate  [R] Refresh';
      case 'bundle':
        return '[S] Scores  [R] Report  [Esc] Back';
      case 'report':
        return '[Up/Down] Scroll  [Esc] Back';
      case 'scores':
        return '[Esc] Back';
      default:
        return '';
    }
  }

  /**
   * Load bundles from output directory
   * @private
   */
  _loadBundles() {
    this.bundles = [];

    try {
      const absPath = resolve(this.outputDir);
      if (!existsSync(absPath)) {
        this.bundleMenu.setItems(['(Output directory not found)']);
        return;
      }

      const entries = readdirSync(absPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('bundle-')) {
          const bundlePath = join(absPath, entry.name);
          const manifestPath = join(bundlePath, 'manifest.json');

          if (existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
              const stats = statSync(bundlePath);

              this.bundles.push({
                name: entry.name,
                path: bundlePath,
                sessionId: manifest.sessionId || entry.name.replace('bundle-', ''),
                createdAt: manifest.createdAt || stats.mtime.toISOString(),
                status: manifest.finalStatus || 'unknown',
                taskCount: manifest.metrics?.totalTasks || 0,
                completedCount: manifest.metrics?.completedCount || 0
              });
            } catch (err) {
              // Skip invalid bundles
            }
          }
        }
      }

      // Sort by creation date (newest first)
      this.bundles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      this._updateBundleMenu();

    } catch (err) {
      this.bundleMenu.setItems([`(Error: ${err.message})`]);
    }
  }

  /**
   * Update bundle menu
   * @private
   */
  _updateBundleMenu() {
    if (this.bundles.length === 0) {
      this.bundleMenu.setItems(['(No bundles found)']);
      return;
    }

    const items = this.bundles.map(b => {
      const date = new Date(b.createdAt).toLocaleDateString();
      const tasks = `${b.completedCount}/${b.taskCount}`;
      const status = b.status === 'success' ? '+' : b.status === 'failed' ? 'x' : '?';
      return `${status} ${b.sessionId.slice(0, 8)}... ${tasks} tasks (${date})`;
    });

    this.bundleMenu.setItems(items);
  }

  /**
   * Load bundle details
   * @param {number} index
   * @private
   */
  _loadBundle(index) {
    if (index < 0 || index >= this.bundles.length) return;

    const bundle = this.bundles[index];
    this.selectedBundle = bundle;

    try {
      // Load manifest
      const manifestPath = join(bundle.path, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

      // Load summary if exists
      let summary = null;
      const summaryPath = join(bundle.path, 'summary.json');
      if (existsSync(summaryPath)) {
        summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
      }

      // Load execution log if exists
      let executionLog = null;
      const logPath = join(bundle.path, 'execution-log.json');
      if (existsSync(logPath)) {
        executionLog = JSON.parse(readFileSync(logPath, 'utf-8'));
      }

      this.bundleData = {
        manifest,
        summary,
        executionLog,
        bundle
      };

      this.mode = 'bundle';

    } catch (err) {
      this.bundleData = null;
    }
  }

  /**
   * Load evaluation report
   * @private
   */
  _loadReport() {
    if (!this.selectedBundle) return;

    try {
      // Look for report in evaluation-output directory
      const evalPath = resolve(this.evalOutputDir, this.selectedBundle.sessionId);
      const reportPath = join(evalPath, 'evaluation-report.md');

      if (existsSync(reportPath)) {
        this.reportContent = readFileSync(reportPath, 'utf-8');
        this.reportViewer.setValue(this.reportContent);
        this.mode = 'report';
      } else {
        // Check for inline report in bundle
        const bundleReportPath = join(this.selectedBundle.path, 'evaluation-report.md');
        if (existsSync(bundleReportPath)) {
          this.reportContent = readFileSync(bundleReportPath, 'utf-8');
          this.reportViewer.setValue(this.reportContent);
          this.mode = 'report';
        } else {
          this.reportContent = 'No evaluation report found. Press [E] to evaluate.';
          this.reportViewer.setValue(this.reportContent);
          this.mode = 'report';
        }
      }
    } catch (err) {
      this.reportContent = `Error loading report: ${err.message}`;
      this.reportViewer.setValue(this.reportContent);
      this.mode = 'report';
    }
  }

  /**
   * Load scores from evaluation
   * @private
   */
  _loadScores() {
    if (!this.selectedBundle) return;

    try {
      // Look for JSON report
      const evalPath = resolve(this.evalOutputDir, this.selectedBundle.sessionId);
      const jsonPath = join(evalPath, 'evaluation-report.json');

      if (existsSync(jsonPath)) {
        const report = JSON.parse(readFileSync(jsonPath, 'utf-8'));
        this.scores = report.qualityScore || null;
        this.mode = 'scores';
      } else {
        this.scores = null;
        this.mode = 'scores';
      }
    } catch (err) {
      this.scores = null;
      this.mode = 'scores';
    }
  }

  /**
   * Run evaluation on bundle
   * @private
   */
  async _evaluateBundle() {
    if (!this.selectedBundle || this.evalRunner.isRunning()) return;

    // Run evaluation (this blocks but shows progress in terminal)
    try {
      const result = await this.evalRunner.run(this.selectedBundle.path, {
        format: 'all',
        verbose: false
      });

      if (result.success) {
        this.scores = result.scores;
        this._loadScores();
      }
    } catch (err) {
      // Error running evaluation
    }
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    switch (this.mode) {
      case 'list':
        this._handleListEvent(ctx, evt);
        break;
      case 'bundle':
        this._handleBundleEvent(ctx, evt);
        break;
      case 'report':
        this._handleReportEvent(ctx, evt);
        break;
      case 'scores':
        this._handleScoresEvent(ctx, evt);
        break;
    }
  }

  /**
   * Handle list mode events
   * @private
   */
  _handleListEvent(ctx, evt) {
    if (evt.type === 'key') {
      const result = this.bundleMenu.onKey(evt.key);
      if (result?.action === 'select') {
        this._loadBundle(result.index);
        return;
      }

      if (evt.key === 'enter') {
        this._loadBundle(this.bundleMenu.selected);
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'r':
          this._loadBundles();
          break;
        case 'e':
          if (this.bundles.length > 0 && this.bundleMenu.selected < this.bundles.length) {
            this._loadBundle(this.bundleMenu.selected);
            this._evaluateBundle();
          }
          break;
      }
    }
  }

  /**
   * Handle bundle view events
   * @private
   */
  _handleBundleEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'list';
          this.bundleData = null;
          break;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 's':
          this._loadScores();
          break;
        case 'r':
          this._loadReport();
          break;
        case 'e':
          this._evaluateBundle();
          break;
      }
    }
  }

  /**
   * Handle report view events
   * @private
   */
  _handleReportEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'bundle';
          break;
      }
    }

    this.reportViewer.onEvent(ctx, evt);
  }

  /**
   * Handle scores view events
   * @private
   */
  _handleScoresEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'bundle';
          break;
      }
    }
  }

  /**
   * Render the screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    switch (this.mode) {
      case 'list':
        this._renderList(ctx, rect);
        break;
      case 'bundle':
        this._renderBundle(ctx, rect);
        break;
      case 'report':
        this._renderReport(ctx, rect);
        break;
      case 'scores':
        this._renderScores(ctx, rect);
        break;
    }
  }

  /**
   * Render list mode
   * @private
   */
  _renderList(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ` Output Bundles (${this.bundles.length}) `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    const menuRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    this.bundleMenu.render(ctx, menuRect);
  }

  /**
   * Render bundle view
   * @private
   */
  _renderBundle(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const bundle = this.selectedBundle;
    const title = ` Bundle: ${bundle?.sessionId?.slice(0, 8) || 'Unknown'}... `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    if (!this.bundleData) {
      screen.drawText(x + 2, y + 2, 'No bundle data', styles.dim);
      return;
    }

    const { manifest, summary } = this.bundleData;
    let line = y + 1;

    // Session info
    screen.drawText(x + 2, line++, `Session: ${manifest.sessionId}`, styles.normal);
    screen.drawText(x + 2, line++, `Status: ${manifest.finalStatus || 'unknown'}`,
      manifest.finalStatus === 'success' ? styles.success : styles.error);
    screen.drawText(x + 2, line++, `Created: ${new Date(manifest.createdAt).toLocaleString()}`, styles.dim);
    line++;

    // Metrics
    if (manifest.metrics) {
      const m = manifest.metrics;
      screen.drawText(x + 2, line++, `Tasks: ${m.completedCount || 0}/${m.totalTasks || 0} completed`, styles.normal);
      if (m.failedCount > 0) {
        screen.drawText(x + 2, line++, `Failed: ${m.failedCount}`, styles.error);
      }
      if (m.totalExecutionTimeMs) {
        screen.drawText(x + 2, line++, `Duration: ${(m.totalExecutionTimeMs / 1000).toFixed(1)}s`, styles.dim);
      }
    }
    line++;

    // Summary info
    if (summary) {
      screen.drawText(x + 2, line++, `Total tokens: ${summary.totalTokens || 'N/A'}`, styles.dim);
    }
    line++;

    // Actions
    screen.drawText(x + 2, line++, '[S] View Scores  [R] View Report  [E] Evaluate', styles.dim);
    screen.drawText(x + 2, line++, '[Esc] Back to list', styles.dim);
  }

  /**
   * Render report view
   * @private
   */
  _renderReport(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ' Evaluation Report ';
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    const viewerRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    this.reportViewer.render(ctx, viewerRect);
  }

  /**
   * Render scores view
   * @private
   */
  _renderScores(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ' Quality Scores ';
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    if (!this.scores) {
      const msg = 'No evaluation scores available. Press [E] to evaluate.';
      const msgX = x + Math.floor((w - msg.length) / 2);
      screen.drawText(msgX, y + Math.floor(h / 2), msg, styles.dim);
      return;
    }

    let line = y + 2;
    const barWidth = Math.min(30, w - 40);

    // Overall score
    const overall = this.scores.overall || 0;
    const grade = this.scores.grade || 'N/A';
    screen.drawText(x + 4, line++, `Overall Score: ${overall}/100 (${grade})`, styles.highlight);
    line++;

    // Score breakdown
    const breakdown = this.scores.breakdown || {};
    const categories = [
      { key: 'taskCompletion', label: 'Task Completion' },
      { key: 'outputQuality', label: 'Output Quality' },
      { key: 'toolUtilization', label: 'Tool Utilization' },
      { key: 'goalAlignment', label: 'Goal Alignment' },
      { key: 'processEfficiency', label: 'Process Efficiency' }
    ];

    for (const cat of categories) {
      const score = breakdown[cat.key]?.score || 0;
      const weighted = breakdown[cat.key]?.weighted || 0;
      const bar = scoreBar(score, barWidth);

      screen.drawText(x + 4, line, `${cat.label.padEnd(20)}`, styles.normal);
      screen.drawText(x + 25, line, bar, score >= 70 ? styles.success : score >= 40 ? styles.highlight : styles.error);
      screen.drawText(x + 25 + barWidth + 2, line, `${score.toString().padStart(3)}/100 (${weighted.toFixed(1)})`, styles.dim);
      line++;
    }

    line += 2;
    screen.drawText(x + 4, line, '[Esc] Back', styles.dim);
  }
}

export default OutputTabScreen;
