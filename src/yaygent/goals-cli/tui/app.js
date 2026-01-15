/**
 * @fileoverview TUI Application framework
 * @module tui/app
 */

import { ANSI, writeStdout, getTerminalSize } from './ansi.js';
import { Screen } from './screen.js';
import { Input, stop, isStopped } from './input.js';
import { createCharMapper } from './charset.js';
import { CGA, UI, C, STYLES } from './colors.js';

/**
 * TUI Application class
 */
export class App {
  /**
   * @param {Object} options
   * @param {Object} [options.styles] - Custom styles
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

    const defaults = {
      // Panel styles
      panel: screen.registerStyle({ fg: C.fg(UI.FG_NORMAL), bg: C.bg(UI.BG_PANEL) }),
      panelBg: screen.registerStyle({ bg: C.bg(UI.BG_PANEL) }),

      // Header/Footer
      header: screen.registerStyle({ fg: C.fg(UI.FG_TITLE), bg: C.bg(UI.BG_HEADER), bold: true }),
      footer: screen.registerStyle({ fg: C.fg(UI.FG_NORMAL), bg: C.bg(UI.BG_FOOTER) }),

      // Selection
      selected: screen.registerStyle({ fg: C.fg(UI.FG_SELECTED), bg: C.bg(UI.BG_SELECTED), bold: true }),
      item: screen.registerStyle({ fg: C.fg(UI.FG_NORMAL), bg: C.bg(UI.BG_PANEL) }),

      // Text
      title: screen.registerStyle({ fg: C.fg(UI.FG_TITLE), bg: C.bg(UI.BG_PANEL), bold: true }),
      dim: screen.registerStyle({ fg: C.fg(UI.FG_DIM), bg: C.bg(UI.BG_PANEL) }),
      accent: screen.registerStyle({ fg: C.fg(UI.FG_ACCENT), bg: C.bg(UI.BG_PANEL) }),
      bright: screen.registerStyle({ fg: C.fg(UI.FG_BRIGHT), bg: C.bg(UI.BG_PANEL), bold: true }),

      // Status
      error: screen.registerStyle({ fg: C.fg(UI.FG_ERROR), bg: C.bg(UI.BG_PANEL), bold: true }),
      success: screen.registerStyle({ fg: C.fg(UI.FG_SUCCESS), bg: C.bg(UI.BG_PANEL), bold: true }),
      warning: screen.registerStyle({ fg: C.fg(UI.FG_WARNING), bg: C.bg(UI.BG_PANEL) }),

      // Borders
      border: screen.registerStyle({ fg: C.fg(UI.BORDER_NORMAL), bg: C.bg(UI.BG_PANEL) }),
      borderActive: screen.registerStyle({ fg: C.fg(UI.BORDER_ACTIVE), bg: C.bg(UI.BG_PANEL) })
    };

    // Override with custom styles
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
    this.input.on((evt) => this._handleEvent(evt));

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
  }

  /**
   * Render current screen
   * @private
   */
  _render() {
    this.screen.clear(this.styles.panelBg);

    if (this.currentScreen?.render) {
      const rect = { x: 0, y: 0, w: this.screen.width, h: this.screen.height };
      this.currentScreen.render(this.ctx, rect);
    }

    this.screen.render();
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
