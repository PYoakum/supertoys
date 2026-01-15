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

// Components
import { Menu } from './components/menu.js';
import { TabBar } from './components/tab-bar.js';
import { TextInput } from './components/text-input.js';
import { TextArea } from './components/text-area.js';
import { StatusBar } from './components/status-bar.js';
import { Modal, confirmModal, alertModal } from './components/modal.js';
import { ProgressBar, scoreBar } from './components/progress-bar.js';
import { LogViewer } from './components/log-viewer.js';
import { SplitPane } from './components/split-pane.js';

// Screens
import { GoalsBrowserScreen } from './screens/goals-browser.js';
import { AiEditPreviewScreen } from './screens/ai-edit-preview.js';
import { MainTuiScreen } from './screens/main-tui.js';
import { GoalsTabScreen } from './screens/goals-tab.js';
import { ContextTabScreen } from './screens/context-tab.js';
import { ExecuteTabScreen } from './screens/execute-tab.js';
import { OutputTabScreen } from './screens/output-tab.js';

// Services
import { SessionServerClient } from './services/session-server-client.js';
import { ActionPlanRunner } from './services/action-plan-runner.js';
import { OutputEvalRunner } from './services/output-eval-runner.js';

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
  TabBar,
  TextInput,
  TextArea,
  StatusBar,
  Modal,
  confirmModal,
  alertModal,
  ProgressBar,
  scoreBar,
  LogViewer,
  SplitPane,

  // Screens
  GoalsBrowserScreen,
  AiEditPreviewScreen,
  MainTuiScreen,
  GoalsTabScreen,
  ContextTabScreen,
  ExecuteTabScreen,
  OutputTabScreen,

  // Services
  SessionServerClient,
  ActionPlanRunner,
  OutputEvalRunner
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

/**
 * Run the main tabbed TUI
 * @param {Object} options
 * @param {string} [options.goalsPath='./goals.json'] - Goals file path
 * @param {string} [options.contextPath] - Context directory path
 * @param {string} [options.serverUrl='http://localhost:3000'] - Session server URL
 * @param {string} [options.outputDir='./output'] - Output directory
 * @returns {Promise<void>}
 */
export function runMainTui(options = {}) {
  return new Promise((resolve) => {
    const app = new App();

    // Create main screen
    const mainScreen = new MainTuiScreen({
      goalsPath: options.goalsPath || './goals.json',
      contextPath: options.contextPath,
      serverUrl: options.serverUrl || 'http://localhost:3000',
      outputDir: options.outputDir || './output'
    });

    // Create tab screens
    const goalsTab = new GoalsTabScreen({ state: mainScreen.state });
    const contextTab = new ContextTabScreen({ state: mainScreen.state });
    const executeTab = new ExecuteTabScreen({ state: mainScreen.state });
    const outputTab = new OutputTabScreen({ state: mainScreen.state });

    // Register tab screens
    mainScreen.setTabScreen('goals', goalsTab);
    mainScreen.setTabScreen('context', contextTab);
    mainScreen.setTabScreen('execute', executeTab);
    mainScreen.setTabScreen('output', outputTab);

    // Focus initial tab
    goalsTab.focus();

    // Store original shutdown to intercept
    const originalShutdown = app.shutdown.bind(app);
    app.shutdown = () => {
      originalShutdown();
      resolve();
    };

    // Wrap to handle quit
    const wrapper = {
      render: (ctx, rect) => mainScreen.render(ctx, rect),
      onEvent: (ctx, evt) => {
        // Handle global quit with Ctrl+Q or Ctrl+C
        if (evt.type === 'key' && (evt.key === 'ctrl+q' || evt.key === 'ctrl+c')) {
          app.shutdown();
          return;
        }
        mainScreen.onEvent(ctx, evt);
      }
    };

    app.mount(wrapper);
    app.start();
  });
}

export default {
  App,
  Screen,
  Input,
  Menu,
  TabBar,
  TextInput,
  TextArea,
  StatusBar,
  Modal,
  ProgressBar,
  LogViewer,
  SplitPane,
  GoalsBrowserScreen,
  AiEditPreviewScreen,
  MainTuiScreen,
  GoalsTabScreen,
  ContextTabScreen,
  ExecuteTabScreen,
  OutputTabScreen,
  SessionServerClient,
  ActionPlanRunner,
  OutputEvalRunner,
  runTui,
  runMainTui,
  browseGoals,
  previewAiEditsTui
};
