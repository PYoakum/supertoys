/**
 * @fileoverview TUI Application framework
 * @module tui/app
 */

import { ANSI, writeStdout, getTerminalSize } from './ansi.js';
import { Screen } from './screen.js';
import { Input, stop, isStopped } from './input.js';
import { createCharMapper } from './charset.js';
import { CGA, UI, C, STYLES, fg, bg } from './colors.js';
import { loadThemeStyles } from './theme-loader.js';

/**
 * TUI Application class
 */
export class App {
  /**
   * @param {Object} options
   * @param {Object} [options.styles] - Custom styles (deprecated, use themePath)
   * @param {string} [options.themePath] - Path to TOML theme file
   */
  constructor(options = {}) {
    const size = getTerminalSize();

    /** @type {Screen} */
    this.screen = new Screen({ width: size.width, height: size.height });

    /** @type {Input} */
    this.input = new Input();

    /** @type {Object} */
    this.charset = createCharMapper();

    /** @type {boolean} */
    this.running = false;

    /** @type {Object|null} */
    this.currentScreen = null;

    /** @type {Function|null} */
    this._renderLoop = null;

    /** @type {string|null} Theme path */
    this.themePath = options.themePath || null;

    /** @type {Object} Theme configuration */
    this.themeConfig = null;

    /** @type {Object} Registered styles */
    this.styles = this._registerStyles(options.styles || {});

    /** @type {Object} Rendering context */
    this.ctx = {
      screen: this.screen,
      styles: this.styles,
      charset: this.charset,
      app: this,
      quit: () => this.shutdown()
    };
  }

  /**
   * Register default CGA styles
   * @param {Object} customStyles
   * @returns {Object}
   * @private
   */
  _registerStyles(customStyles) {
    const screen = this.screen;

    // Load theme if path provided
    let themeStyles = {};
    if (this.themePath) {
      const themeResult = loadThemeStyles(this.themePath);
      this.themeConfig = themeResult;
      themeStyles = themeResult.styles || {};
    }

    // Default styles (used if no theme or as fallback)
    // Note: using fg() and bg() which auto-detect 16 vs 256 color mode
    const defaults = {
      // Panel styles
      panel: screen.registerStyle(themeStyles.panel || { fg: fg(UI.FG_NORMAL), bg: bg(UI.BG_PANEL) }),
      panelBg: screen.registerStyle(themeStyles.panel_bg || { bg: bg(UI.BG_PANEL) }),

      // Header/Footer
      header: screen.registerStyle(themeStyles.header || { fg: fg(UI.FG_TITLE), bg: bg(UI.BG_HEADER), bold: true }),
      footer: screen.registerStyle(themeStyles.footer || { fg: fg(UI.FG_NORMAL), bg: bg(UI.BG_FOOTER) }),

      // Selection
      selected: screen.registerStyle(themeStyles.selected || { fg: fg(UI.FG_SELECTED), bg: bg(UI.BG_SELECTED), bold: true }),
      item: screen.registerStyle(themeStyles.item || { fg: fg(UI.FG_NORMAL), bg: bg(UI.BG_PANEL) }),

      // Text
      normal: screen.registerStyle(themeStyles.normal || { fg: fg(UI.FG_NORMAL), bg: bg(UI.BG_PANEL) }),
      title: screen.registerStyle(themeStyles.title || { fg: fg(UI.FG_TITLE), bg: bg(UI.BG_PANEL), bold: true }),
      dim: screen.registerStyle(themeStyles.dim || { fg: fg(UI.FG_DIM), bg: bg(UI.BG_PANEL) }),
      accent: screen.registerStyle(themeStyles.accent || { fg: fg(UI.FG_ACCENT), bg: bg(UI.BG_PANEL) }),
      bright: screen.registerStyle(themeStyles.bright || { fg: fg(UI.FG_BRIGHT), bg: bg(UI.BG_PANEL), bold: true }),
      highlight: screen.registerStyle(themeStyles.highlight || { fg: fg(UI.FG_BRIGHT), bg: bg(UI.BG_PANEL), bold: true }),

      // Status
      error: screen.registerStyle(themeStyles.error || { fg: fg(UI.FG_ERROR), bg: bg(UI.BG_PANEL), bold: true }),
      success: screen.registerStyle(themeStyles.success || { fg: fg(UI.FG_SUCCESS), bg: bg(UI.BG_PANEL), bold: true }),
      warning: screen.registerStyle(themeStyles.warning || { fg: fg(UI.FG_WARNING), bg: bg(UI.BG_PANEL) }),

      // Borders
      border: screen.registerStyle(themeStyles.border || { fg: fg(UI.BORDER_NORMAL), bg: bg(UI.BG_PANEL) }),
      borderActive: screen.registerStyle(themeStyles.border_active || { fg: fg(UI.BORDER_ACTIVE), bg: bg(UI.BG_PANEL) })
    };

    // Override with custom styles (legacy support)
    for (const [key, style] of Object.entries(customStyles)) {
      defaults[key] = screen.registerStyle(style);
    }

    return defaults;
  }

  /**
   * Mount a screen
   * @param {Object} screenComponent - Screen with render and onEvent methods
   * @returns {App}
   */
  mount(screenComponent) {
    this.currentScreen = screenComponent;
    return this;
  }

  /**
   * Start the application
   */
  start() {
    if (this.running) return;
    this.running = true;

    // Setup terminal
    writeStdout(ANSI.altScreenOn());
    writeStdout(ANSI.hideCursor());
    writeStdout(ANSI.clear());
    writeStdout(ANSI.home());

    // Start input handling
    this.input.start();
    this.input.on((evt) => {
      // Debug: log events to stderr
      if (process.env.DEBUG_TUI) {
        process.stderr.write(`[TUI] Event: ${JSON.stringify(evt)}\n`);
      }
      this._handleEvent(evt);
    });

    // Handle resize
    if (process.stdout.on) {
      process.stdout.on('resize', () => {
        const size = getTerminalSize();
        this.screen.resize(size.width, size.height);
        this._render();
      });
    }

    // Initial render
    this._render();

    // Start render loop (30fps for efficiency)
    this._renderLoop = setInterval(() => {
      if (this.running) this._render();
    }, 33);
  }

  /**
   * Handle input event
   * @param {Object} evt
   * @private
   */
  _handleEvent(evt) {
    try {
      // Global quit handlers
      if (evt.type === 'key') {
        if (evt.key === 'ctrl+c' || evt.key === 'ctrl+q') {
          this.shutdown();
          return;
        }
      }

      // Pass to current screen
      if (this.currentScreen?.onEvent) {
        this.currentScreen.onEvent(this.ctx, evt);
      }

      // Render after event
      this._render();
    } catch (err) {
      // Log error to stderr and continue
      process.stderr.write(`[TUI Error] ${err.message}\n${err.stack}\n`);
    }
  }

  /**
   * Render current screen
   * @private
   */
  _render() {
    try {
      this.screen.clear(this.styles.panelBg);

      if (this.currentScreen?.render) {
        const rect = { x: 0, y: 0, w: this.screen.width, h: this.screen.height };
        this.currentScreen.render(this.ctx, rect);
      }

      this.screen.render();
    } catch (err) {
      process.stderr.write(`[TUI Render Error] ${err.message}\n${err.stack}\n`);
    }
  }

  /**
   * Shutdown application
   */
  shutdown() {
    if (!this.running) return;
    this.running = false;

    // Stop render loop
    if (this._renderLoop) {
      clearInterval(this._renderLoop);
      this._renderLoop = null;
    }

    // Stop input
    this.input.stop();

    // Restore terminal
    writeStdout(ANSI.reset());
    writeStdout(ANSI.showCursor());
    writeStdout(ANSI.altScreenOff());

    process.exit(0);
  }
}

export default App;
