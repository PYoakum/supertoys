import { Component } from "../component.js";

export class Box extends Component {
  constructor(props = {}) {
    super(props);
    this.title = props.title || "";
    this.styleKey = props.styleKey;       // background/body style
    this.borderStyleKey = props.borderStyleKey;
    this.charset = props.charset;         // char mapper
    this.padding = props.padding ?? 1;
  }

  render(ctx) {
    const r = this.layout;
    if (!r) return;

    const b = ctx.block; // block = reserved block for whole screen
    const cs = this.charset;

    // fill
    b.fillRect(r.x, r.y, r.w, r.h, " ", this.styleKey);

    if (r.w < 2 || r.h < 2) return;

    // border
    const top = cs.render("{tl}" + "{h}".repeat(Math.max(0, r.w - 2)) + "{tr}");
    const mid = cs.render("{v}") + " ".repeat(Math.max(0, r.w - 2)) + cs.render("{v}");
    const bot = cs.render("{bl}" + "{h}".repeat(Math.max(0, r.w - 2)) + "{br}");

    b.drawText(r.x, r.y, top, this.borderStyleKey);
    for (let yy = 1; yy < r.h - 1; yy++) {
      b.drawText(r.x, r.y + yy, mid, this.borderStyleKey);
    }
    b.drawText(r.x, r.y + r.h - 1, bot, this.borderStyleKey);

    if (this.title && r.w > 4) {
      const t = ` ${this.title} `;
      b.drawText(r.x + 2, r.y, t.slice(0, r.w - 4), this.borderStyleKey);
    }
  }

  contentRect() {
    const r = this.layout;
    if (!r) return null;
    const p = this.padding;
    return { x: r.x + 1 + p, y: r.y + 1 + p, w: Math.max(0, r.w - 2 - 2 * p), h: Math.max(0, r.h - 2 - 2 * p) };
  }
}
