import { isStopped } from "../app/events.js";

let _id = 1;

export class Component {
  constructor(props = {}) {
    this.id = props.id || `c${_id++}`;
    this.parent = null;
    this.children = [];
    this.focusable = !!props.focusable;
    this.visible = props.visible !== false;
    this.layout = props.layout || null; // assigned by layout engine
    this.state = props.state || {};
  }

  add(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(childId) {
    const idx = this.children.findIndex(c => c.id === childId);
    if (idx >= 0) {
      this.children[idx].parent = null;
      this.children.splice(idx, 1);
    }
  }

  // Hooks you override
  measure(_ctx, _constraints) { return { w: 0, h: 0 }; }
  arrange(_ctx, rect) { this.layout = rect; } // rect = {x,y,w,h}
  render(_ctx) {}
  onEvent(_ctx, _evt) {} // return stop(evt) to halt bubbling

  // Bubble event from focused component up to root
  bubble(ctx, evt) {
    let cur = this;
    while (cur) {
      cur.onEvent(ctx, evt);
      if (isStopped(evt)) break;
      cur = cur.parent;
    }
  }

  // DFS render
  renderTree(ctx) {
    if (!this.visible) return;
    this.render(ctx);
    for (const ch of this.children) ch.renderTree(ctx);
  }
}
