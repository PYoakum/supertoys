import { Component } from "../component.js";
import { Box } from "../primitives/box.js";
import { Text } from "../primitives/text.js";
import { dock, pad } from "../../app/layout.js";
import { stop } from "../../app/events.js";

import { Menu } from "../../tui/components/menu.js";
import { Tree } from "../../tui/components/tree.js";
import { restJson } from "../../tui/net/rest.js";
import { connectWebSocket } from "../../tui/net/ws.js";
import { streamNdjson } from "../../tui/net/ndjson.js";

class MenuComponent extends Component {
  constructor(props) {
    super({ ...props, focusable: true });
    this.menu = props.menu;
    this.styles = props.styles;
    this.charset = props.charset;
    this.onSelect = props.onSelect;
  }
  render(ctx) {
    const r = this.layout;
    if (!r) return;
    ctx.block.clear();
    // We render menu into the screen’s shared block using local rect coordinates.
    // So: temporarily treat `block` as "canvas", and pass offsets to menu render.
    this.menu.render(ctx.block, { x: r.x, y: r.y, w: r.w, h: r.h, styles: this.styles, charset: this.charset });
  }
  onEvent(_ctx, evt) {
    if (evt.type !== "key") return;
    const res = this.menu.onKey(evt.key);
    if (res?.action === "select") {
      this.onSelect?.(res.index);
      stop(evt);
    }
    // prevent arrows from bubbling into parent if desired:
    if (["up", "down", "enter"].includes(evt.key)) stop(evt);
  }
}

class TreeComponent extends Component {
  constructor(props) {
    super({ ...props, focusable: true });
    this.tree = props.tree;
    this.styles = props.styles;
    this.charset = props.charset;
    this.onActivate = props.onActivate;
  }
  render(ctx) {
    const r = this.layout;
    if (!r) return;
    this.tree.render(ctx.block, { x: r.x, y: r.y, w: r.w, h: r.h, styles: this.styles, charset: this.charset });
  }
  onEvent(_ctx, evt) {
    if (evt.type !== "key") return;
    const res = this.tree.onKey(evt.key);
    if (res?.action === "activate") {
      this.onActivate?.(res);
      stop(evt);
    }
    if (["up", "down", "left", "right", "enter"].includes(evt.key)) stop(evt);
  }
}

export function MainScreenFactory(ctx) {
  const root = new Component({ id: "main-root" });

  const menu = new Menu({
    title: "Actions",
    items: [
      "Toggle charset (unicode/ascii)",
      "REST: GET /health",
      "WS: connect/close",
      "NDJSON: start/stop",
      "Go to (future) screen",
      "Quit"
    ],
    selected: 0
  });

  const tree = new Tree({
    title: "Example Tree",
    root: {
      label: "root",
      expanded: true,
      children: [
        { label: "alpha", expanded: true, children: [{ label: "alpha-1" }, { label: "alpha-2" }] },
        { label: "beta", expanded: false, children: [{ label: "beta-1" }] },
        { label: "gamma" }
      ]
    },
    selectedPath: [0]
  });

  const leftBox = root.add(new Box({
    id: "leftBox",
    title: "Menu",
    styleKey: ctx.styles.panelBg,
    borderStyleKey: ctx.styles.dim,
    charset: ctx.charset,
    padding: 0
  }));

  const rightBox = root.add(new Box({
    id: "rightBox",
    title: "Tree",
    styleKey: ctx.styles.panelBg,
    borderStyleKey: ctx.styles.dim,
    charset: ctx.charset,
    padding: 0
  }));

  const status = root.add(new Text({
    id: "status",
    text: "Ready",
    styleKey: ctx.styles.status
  }));

  // Focusable children
  const menuComp = leftBox.add(new MenuComponent({
    id: "menuComp",
    menu,
    styles: ctx.styles,
    charset: ctx.charset,
    onSelect: (i) => handleSelect(i)
  }));

  const treeComp = rightBox.add(new TreeComponent({
    id: "treeComp",
    tree,
    styles: ctx.styles,
    charset: ctx.charset,
    onActivate: (res) => setStatus(`Tree: ${res.node.label}`)
  }));

  // Networking state
  let wsClient = null;
  let ndjsonAbort = null;

  function setStatus(t) {
    status.setText(String(t ?? ""));
  }

  async function handleSelect(index) {
    switch (index) {
      case 0: {
        const isUnicode = ctx.charset.map === ctx.charsets.unicode;
        ctx.charset.setMap(isUnicode ? ctx.charsets.ascii : ctx.charsets.unicode);
        setStatus(`Charset: ${isUnicode ? "ascii" : "unicode"}`);
        break;
      }
      case 1: {
        const url = "http://localhost:3000/health";
        try {
          const r = await restJson(url);
          setStatus(`REST ${r.status}: ${(r.text || JSON.stringify(r.data)).slice(0, 80)}`);
        } catch (e) {
          setStatus(`REST error: ${String(e.message || e).slice(0, 80)}`);
        }
        break;
      }
      case 2: {
        const url = "ws://localhost:3000/ws";
        if (wsClient) {
          try { wsClient.close(); } catch {}
          wsClient = null;
          setStatus("WS: closed");
        } else {
          setStatus("WS: connecting…");
          wsClient = connectWebSocket(url, {
            onOpen: () => setStatus("WS: connected"),
            onMessage: (_, msg) => setStatus(`WS msg: ${String(msg).slice(0, 80)}`),
            onClose: () => { wsClient = null; setStatus("WS: closed"); },
            onError: () => setStatus("WS: error")
          });
        }
        break;
      }
      case 3: {
        const url = "http://localhost:3000/stream.ndjson";
        if (ndjsonAbort) {
          ndjsonAbort.abort();
          ndjsonAbort = null;
          setStatus("NDJSON: stopped");
        } else {
          ndjsonAbort = new AbortController();
          setStatus("NDJSON: streaming…");
          streamNdjson(url, {
            signal: ndjsonAbort.signal,
            onObject: (obj) => setStatus(`NDJSON obj: ${JSON.stringify(obj).slice(0, 80)}`),
            onError: (err) => setStatus(`NDJSON parse err: ${String(err?.message || err).slice(0, 80)}`)
          }).catch(e => setStatus(`NDJSON error: ${String(e?.message || e).slice(0, 80)}`))
            .finally(() => { ndjsonAbort = null; });
        }
        break;
      }
      case 4: {
        // router example placeholder
        setStatus("Router: (placeholder) add another screen factory");
        break;
      }
      case 5:
        ctx.quit();
        break;
    }
  }

  // Root-level event handling (Tab focus + global quit)
  root.onEvent = (ctx2, evt) => {
    if (evt.type !== "key") return;

    if (evt.key === "ctrl+c") { ctx2.quit(); stop(evt); return; }
    if (evt.key === "tab") { ctx2.focus.focusNext(); setStatus(`Focus: ${ctx2.focus.focused?.id}`); stop(evt); return; }
    if (evt.key === "shift+tab") { ctx2.focus.focusPrev(); setStatus(`Focus: ${ctx2.focus.focused?.id}`); stop(evt); return; }

    // Example: quick focus toggle
    if (evt.key === "esc") { ctx2.focus.focusNext(); setStatus(`Focus: ${ctx2.focus.focused?.id}`); stop(evt); }
  };

  // Layout function: called every frame on current terminal size
  root.arrange = (_ctx, rect) => {
    root.layout = rect;

    const statusH = 1;
    const leftW = Math.max(22, Math.min(34, Math.floor(rect.w * 0.28)));

    const { frames } = dock(rect, [
      { pos: "bottom", size: statusH, id: "status" },
      { pos: "left", size: leftW, id: "left" },
      { pos: "fill", id: "right" }
    ]);

    const leftRect = pad(frames.get("left"), 0);
    const rightRect = pad(frames.get("right"), 0);
    const statusRect = frames.get("status");

    leftBox.arrange(_ctx, leftRect);
    rightBox.arrange(_ctx, rightRect);
    status.arrange(_ctx, statusRect);

    // inner content uses box content rect
    menuComp.arrange(_ctx, leftBox.contentRect());
    treeComp.arrange(_ctx, rightBox.contentRect());
  };

  return root;
}
