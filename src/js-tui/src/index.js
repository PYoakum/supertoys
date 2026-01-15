import { App } from "./app/app.js";
import { Router } from "./app/router.js";
import { C } from "./tui/colors.js";
import { createCharMapper, CHARSETS } from "./tui/charset.js";
import { Screen } from "./tui/screen.js"; // only for style registration convenience
import { MainScreenFactory } from "./ui/screens/main.js";

// We need a Screen instance temporarily to create style keys consistently.
// App will create its own Screen, but style keys are internal to Screen, so we do this:
// 1) Create app, then register styles on app.screen.
// For simplicity, we’ll build styles after App is created.

const router = new Router();

const charset = createCharMapper(CHARSETS.unicode);

// Build app first (with placeholder styles, updated after)
const dummyStyles = { panelBg: "s0" };
const app = new App({ router, styles: dummyStyles, charset, charsets: CHARSETS });

// Now register styles on the *real* app screen
const styles = {
  panelBg: app.screen.registerStyle({ bg: C.bg256(235) }),
  title: app.screen.registerStyle({ fg: C.fg256(229), bg: C.bg256(235), bold: true }),
  item: app.screen.registerStyle({ fg: C.fg256(252), bg: C.bg256(235) }),
  selected: app.screen.registerStyle({ fg: C.fg256(16), bg: C.bg256(220), bold: true }),
  status: app.screen.registerStyle({ fg: C.fg256(232), bg: C.bg256(251), bold: true }),
  dim: app.screen.registerStyle({ fg: C.fg256(244), bg: C.bg256(235) }),
  accent: app.screen.registerStyle({ fg: C.fg256(81), bg: C.bg256(235), bold: true })
};

// Patch styles into app + canvas
app.styles = styles;
app.ctx.styles = styles;
app.canvas.clearStyleKey = styles.panelBg;

// Routes
router.add("main", (ctx) => MainScreenFactory(ctx));

// Start
app.mount("main").start();
