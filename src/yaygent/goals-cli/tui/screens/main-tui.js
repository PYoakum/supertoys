/**
 * @fileoverview Main TUI Screen - Tabbed container
 * @module tui/screens/main-tui
 */

import { TabBar } from '../components/tab-bar.js';
import { StatusBar } from '../components/status-bar.js';
import { Modal } from '../components/modal.js';

/**
 * Main tabbed TUI container
 */
export class MainTuiScreen {
  /**
   * @param {Object} options
   * @param {string} [options.goalsPath='./goals.json'] - Goals file path
   * @param {string} [options.contextPath] - Context directory path
   * @param {string} [options.serverUrl='http://localhost:3000'] - Session server URL
   * @param {string} [options.outputDir='./output'] - Output directory
   * @param {Object} [options.tabScreens] - Tab screen instances
   */
  constructor(options = {}) {
    this.goalsPath = options.goalsPath || './goals.json';
    this.contextPath = options.contextPath;
    this.serverUrl = options.serverUrl || 'http://localhost:3000';
    this.outputDir = options.outputDir || './output';

    // Create tab bar
    this.tabBar = new TabBar({
      tabs: [
        { id: 'goals', label: 'Goals', shortcut: '1' },
        { id: 'context', label: 'Context', shortcut: '2' },
        { id: 'execute', label: 'Execute', shortcut: '3' },
        { id: 'output', label: 'Output', shortcut: '4' }
      ],
      active: 0,
      onTabChange: (index, tab) => this._onTabChange(index, tab)
    });

    // Create status bar
    this.statusBar = new StatusBar({
      left: 'Ready',
      center: '',
      right: '[1-4] Tabs  [Tab] Next  [Ctrl+Q] Quit'
    });

    // Tab screens (lazy loaded or passed in)
    this.tabScreens = options.tabScreens || {};

    // Shared state across tabs
    this.state = {
      goals: null,
      goalsPath: this.goalsPath,
      context: null,
      contextPath: this.contextPath,
      sessionId: null,
      serverUrl: this.serverUrl,
      serverConnected: false,
      outputDir: this.outputDir,
      dirty: false  // Unsaved changes
    };

    // Modal overlay
    this.modal = null;
  }

  /**
   * Get active tab screen
   * @returns {Object|null}
   */
  getActiveTabScreen() {
    const tab = this.tabBar.getActiveTab();
    return tab ? this.tabScreens[tab.id] : null;
  }

  /**
   * Set a tab screen
   * @param {string} id - Tab id
   * @param {Object} screen - Screen instance
   */
  setTabScreen(id, screen) {
    this.tabScreens[id] = screen;
    // Pass shared state reference
    if (screen.setState) {
      screen.setState(this.state);
    }
  }

  /**
   * Handle tab change
   * @param {number} index
   * @param {Object} tab
   * @private
   */
  _onTabChange(index, tab) {
    // Blur previous, focus new
    const prevScreen = this.getActiveTabScreen();
    if (prevScreen?.blur) {
      prevScreen.blur();
    }

    // Update status bar
    this._updateStatusBar();

    // Focus new tab
    const newScreen = this.tabScreens[tab.id];
    if (newScreen?.focus) {
      newScreen.focus();
    }
  }

  /**
   * Update status bar based on current state
   * @private
   */
  _updateStatusBar() {
    const tab = this.tabBar.getActiveTab();

    // Left: current mode/status
    let left = tab ? tab.label : '';
    if (this.state.dirty) {
      left += ' *';
    }
    if (this.state.sessionId) {
      left += ` [Session: ${this.state.sessionId.slice(0, 8)}...]`;
    }

    // Center: server status
    const center = this.state.serverConnected ? 'Connected' : '';

    // Right: context-sensitive help
    let right = '[1-4] Tabs  [Ctrl+Q] Quit';
    const activeScreen = this.getActiveTabScreen();
    if (activeScreen?.getHelpText) {
      right = activeScreen.getHelpText();
    }

    this.statusBar.set({ left, center, right });
  }

  /**
   * Show a modal
   * @param {Modal} modal
   */
  showModal(modal) {
    this.modal = modal;
  }

  /**
   * Hide the modal
   */
  hideModal() {
    if (this.modal) {
      this.modal.hide();
      this.modal = null;
    }
  }

  /**
   * Show a confirmation dialog
   * @param {string} title
   * @param {string} message
   * @param {Function} onConfirm
   * @param {Function} [onCancel]
   */
  confirm(title, message, onConfirm, onCancel) {
    this.showModal(new Modal({
      title,
      content: message,
      buttons: [
        { label: 'Yes', action: () => { this.hideModal(); onConfirm(); }, isDefault: true },
        { label: 'No', action: () => { this.hideModal(); if (onCancel) onCancel(); } }
      ],
      onClose: () => { this.hideModal(); if (onCancel) onCancel(); }
    }));
  }

  /**
   * Show an alert dialog
   * @param {string} title
   * @param {string} message
   * @param {Function} [onClose]
   */
  alert(title, message, onClose) {
    this.showModal(new Modal({
      title,
      content: message,
      buttons: [
        { label: 'OK', action: () => { this.hideModal(); if (onClose) onClose(); }, isDefault: true }
      ],
      onClose: () => { this.hideModal(); if (onClose) onClose(); }
    }));
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    // Modal takes priority
    if (this.modal?.visible) {
      this.modal.onEvent(ctx, evt);
      return;
    }

    // Global quit handler is in App
    // Handle tab navigation first
    if (evt.type === 'key') {
      // Tab/Shift+Tab for cycling
      if (evt.key === 'tab' || evt.key === 'shift+tab') {
        this.tabBar.onKey(evt.key);
        return;
      }
    }

    // Number keys for direct tab access
    if (evt.type === 'text') {
      if (this.tabBar.onText(evt.text)) {
        return;
      }
    }

    // Delegate to active tab screen
    const activeScreen = this.getActiveTabScreen();
    if (activeScreen?.onEvent) {
      activeScreen.onEvent(ctx, evt);
    }

    // Update status bar after event
    this._updateStatusBar();
  }

  /**
   * Render the screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    const { x, y, w, h } = rect;

    // Layout: TabBar (2 lines) + Content + StatusBar (2 lines)
    const tabBarHeight = 2;
    const statusBarHeight = 2;
    const contentHeight = h - tabBarHeight - statusBarHeight;

    // Draw tab bar at top
    const tabBarRect = { x, y, w, h: tabBarHeight };
    this.tabBar.render(ctx, tabBarRect);

    // Draw active tab content
    const contentRect = { x, y: y + tabBarHeight, w, h: contentHeight };
    const activeScreen = this.getActiveTabScreen();
    if (activeScreen?.render) {
      activeScreen.render(ctx, contentRect);
    } else {
      // Placeholder for unimplemented tabs
      this._renderPlaceholder(ctx, contentRect);
    }

    // Draw status bar at bottom
    const statusBarRect = { x, y: y + h - statusBarHeight, w, h: statusBarHeight };
    this.statusBar.render(ctx, statusBarRect);

    // Draw modal overlay if visible
    if (this.modal?.visible) {
      this.modal.render(ctx, rect);
    }
  }

  /**
   * Render placeholder for unimplemented tabs
   * @param {Object} ctx
   * @param {Object} rect
   * @private
   */
  _renderPlaceholder(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const tab = this.tabBar.getActiveTab();
    const message = tab ? `${tab.label} tab - Coming soon` : 'Select a tab';

    // Center the message
    const msgX = x + Math.floor((w - message.length) / 2);
    const msgY = y + Math.floor(h / 2);

    screen.drawText(msgX, msgY, message, styles.dim);
  }
}

export default MainTuiScreen;
