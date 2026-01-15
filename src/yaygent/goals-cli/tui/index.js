/**
 * @fileoverview TUI module entry point
 * @module tui
 *
 * Terminal UI for goals-cli with CGA colors and ASCII characters
 */

// Import everything we need
import { App } from './app.js';
import { Screen } from './screen.js';
import { Input, stop, isStopped, keyEvent, textEvent } from './input.js';
import { ANSI, writeStdout, getTerminalSize } from './ansi.js';
import { CGA, UI, C, STYLES, fg, bg, styleToSgr } from './colors.js';
import { ASCII, CharMapper, createCharMapper } from './charset.js';
import { Menu } from './components/menu.js';
import { GoalsBrowserScreen } from './screens/goals-browser.js';
import { AiEditPreviewScreen } from './screens/ai-edit-preview.js';

// Re-export everything
export {
  // Core
  App,
  Screen,
  Input,
  stop,
  isStopped,
  keyEvent,
  textEvent,

  // Styling
  ANSI,
  writeStdout,
  getTerminalSize,
  CGA,
  UI,
  C,
  STYLES,
  fg,
  bg,
  styleToSgr,
  ASCII,
  CharMapper,
  createCharMapper,

  // Components
  Menu,

  // Screens
  GoalsBrowserScreen,
  AiEditPreviewScreen
};

/**
 * Quick start helper - creates and runs a TUI app
 * @param {Object} screen - Screen component with render and onEvent methods
 * @returns {App}
 */
export function runTui(screen) {
  const app = new App();
  app.mount(screen).start();
  return app;
}

/**
 * Browse goals in a TUI
 * @param {Object} goals - Goals data
 * @param {Object} [options]
 * @returns {Promise<Object|null>} Selected goal or null
 */
export function browseGoals(goals, options = {}) {
  return new Promise((resolve) => {
    const app = new App();

    const screen = new GoalsBrowserScreen({
      goals,
      onSelect: (goal) => {
        // Just viewing, don't resolve yet
      },
      onBack: () => {
        app.shutdown();
        resolve(null);
      }
    });

    app.mount(screen).start();
  });
}

/**
 * Preview AI edits in a TUI
 * @param {Object[]} edits - Array of {path, before, after}
 * @param {Object} [options]
 * @returns {Promise<Object[]>} Selected edits to apply
 */
export function previewAiEditsTui(edits, options = {}) {
  return new Promise((resolve) => {
    const app = new App();

    const screen = new AiEditPreviewScreen({
      edits,
      onApply: (selected) => {
        app.shutdown();
        resolve(selected);
      },
      onCancel: () => {
        app.shutdown();
        resolve([]);
      }
    });

    app.mount(screen).start();
  });
}

export default {
  App,
  Screen,
  Input,
  Menu,
  GoalsBrowserScreen,
  AiEditPreviewScreen,
  runTui,
  browseGoals,
  previewAiEditsTui
};
