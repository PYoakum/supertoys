import { Screen } from "../tui/screen.js";
import { BlockManager } from "../tui/blocks.js";
import { Input } from "../tui/input.js";
import { ANSI, writeStdout } from "../tui/ansi.js";
import { keyEvent, textEvent, systemEvent } from "./events.js";
import { FocusManager } from "./focus.js";

function termSize() {
  return { w: process.stdout.columns || 80, h: process.stdout.rows || 24 };
}

function enterTui() {
  writeStdout(ANSI.altScreenOn());
  writeStdout(ANSI.hideCursor());
  writeStdout(ANSI.clear());
  writeStdout(ANSI.home());
}

function exitTui() {
  writeStdout(ANSI.reset());
  writeStdout(ANSI.showCursor());
  writeStdout(ANSI.altScreenOff());
}

export class App {
  constructor({ router, styles, charset, charsets }) {
    this.router = router;
    this.styles = styles;
    this.charset = charset;
    this.charsets = charsets;

    this.running = false;

    const { w, h } = termSize();
    this.screen = new Screen({ width: w, height: h });
    this.blocks = new BlockManager(this.screen);

    // A single reserved “canvas” block covering the full screen
    this.canvas = this.blocks.createBlock({
      id: "canvas",
      x: 0, y: 0, w: w, h: h,
      z: 10,
      clearStyleKey: styles.panelBg
    });

    this.input = new Input();

    this.ctx = {
      screen: this.screen,
      blocks: this.blocks,
      block: this.canvas,
      styles: this.styles,
      charset: this.charset,
      charsets: this.charsets,
      focus: null,
      quit: () => this.shutdown()
    };

    this.root = null;
    this.focus = null;

    process.stdout.on("resize", () => this._onResize());
  }

  mount(routeName) {
    this.root = this.router.go(routeName, this.ctx);
    this.focus = new FocusManager(this.root);
    this.focus.rebuild();
    this.ctx.focus = this.focus;
    return this;
  }

  start() {
    enterTui();
    this.running = true;

    this.input.on((evt) => {
      if (!this.running) return;

      // Convert old input events to app events
      if (evt.type === "key") {
        // crude shift+tab detection: many terminals send ESC [ Z; if you want that, extend parser.
        const e = keyEvent(evt.key);
        this.dispatch(e);
      } else if (evt.type === "text") {
        this.dispatch(textEvent(evt.text));
      }
    });

    this.input.start();

    // First tick
    this.dispatch(systemEvent("mounted", {}));
    this._loop();

    // safety
    process.on("uncaughtException", (e) => {
      try { exitTui(); } catch {}
      console.error(e);
      process.exit(1);
    });
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  dispatch(evt) {
    // If focused exists, bubble from there; else bubble from root
    const start = this.focus?.focused || this.root;
    if (!start) return;
    start.bubble(this.ctx, evt);
  }

  _onResize() {
    const { w, h } = termSize();
    this.screen.resize(w, h);
    this.canvas.x = 0; this.canvas.y = 0;
    this.canvas.resize(w, h);
    this.dispatch(systemEvent("resize", { w, h }));
  }

  _loop() {
    if (!this.running) return;

    const { w, h } = termSize();

    // clear screen buffer
    this.screen.clear(this.screen.registerStyle({}));

    // clear canvas block (it writes into screen during flush)
    this.canvas.clear();

    // arrange + render tree into canvas block
    if (this.root) {
      this.root.arrange(this.ctx, { x: 0, y: 0, w, h });
      this.root.renderTree(this.ctx);
    }

    // composite + render
    this.blocks.composite();
    this.screen.render();

    setTimeout(() => this._loop(), 16);
  }

  shutdown() {
    if (!this.running) return;
    this.running = false;
    try { this.input.stop(); } catch {}
    exitTui();
    process.exit(0);
  }
}
