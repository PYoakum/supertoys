import { ANSI, writeStdout } from "./ansi.js";
import { styleToSgr } from "./colors.js";

/**
 * Cell = { ch: " ", styleKey: string }
 * styleKey indexes a style registry so we don't store huge style objects per cell.
 */

export class Screen {
  constructor({ width, height }) {
    this.width = width;
    this.height = height;

    this._styles = new Map(); // key -> style object
    this._styleKeyCache = new Map(); // JSON -> key
    this._nextStyleId = 1;

    this._cells = allocCells(width, height);
    this._prev = allocCells(width, height);

    this._defaultStyleKey = this.registerStyle({});
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this._cells = allocCells(width, height);
    this._prev = allocCells(width, height);
  }

  registerStyle(styleObj) {
    const json = JSON.stringify(styleObj || {});
    if (this._styleKeyCache.has(json)) return this._styleKeyCache.get(json);

    const key = `s${this._nextStyleId++}`;
    this._styles.set(key, styleObj || {});
    this._styleKeyCache.set(json, key);
    return key;
  }

  clear(styleKey = this._defaultStyleKey) {
    const c = this._cells;
    for (let i = 0; i < c.length; i++) {
      c[i].ch = " ";
      c[i].styleKey = styleKey;
    }
  }

  drawText(x, y, text, styleKey = this._defaultStyleKey) {
    if (y < 0 || y >= this.height) return;
    if (x >= this.width) return;

    let cx = x;
    for (const ch of text) {
      if (cx >= 0 && cx < this.width) {
        const idx = y * this.width + cx;
        this._cells[idx].ch = ch;
        this._cells[idx].styleKey = styleKey;
      }
      cx++;
      if (cx >= this.width) break;
    }
  }

  fillRect(x, y, w, h, ch = " ", styleKey = this._defaultStyleKey) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const idx = yy * this.width + xx;
        this._cells[idx].ch = ch;
        this._cells[idx].styleKey = styleKey;
      }
    }
  }

  /**
   * Render via diff to reduce flicker.
   * This is simple and robust; you can optimize further later.
   */
  render() {
    const out = [];
    let currentStyleKey = null;

    for (let y = 0; y < this.height; y++) {
      let rowDirty = false;
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        const a = this._cells[idx];
        const b = this._prev[idx];
        if (a.ch !== b.ch || a.styleKey !== b.styleKey) {
          rowDirty = true;
          break;
        }
      }
      if (!rowDirty) continue;

      // Move to row start (1-based)
      out.push(ANSI.moveTo(y + 1, 1));
      currentStyleKey = null;

      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        const cell = this._cells[idx];

        if (cell.styleKey !== currentStyleKey) {
          currentStyleKey = cell.styleKey;
          const styleObj = this._styles.get(currentStyleKey) || {};
          out.push(ANSI.reset());
          out.push(styleToSgr(styleObj));
        }

        out.push(cell.ch);

        // update prev
        this._prev[idx].ch = cell.ch;
        this._prev[idx].styleKey = cell.styleKey;
      }
      out.push(ANSI.reset());
    }

    if (out.length > 0) writeStdout(out.join(""));
  }
}

function allocCells(w, h) {
  const n = w * h;
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = { ch: " ", styleKey: "s0" };
  return arr;
}
