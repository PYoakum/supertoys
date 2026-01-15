/**
 * Reserved blocks: rectangular regions that render onto the main screen.
 * Each block has its own local coordinate system (0..w-1, 0..h-1).
 */

export class BlockManager {
  constructor(screen) {
    this.screen = screen;
    this.blocks = [];
  }

  createBlock({ id, x, y, w, h, z = 0, clearStyleKey = null }) {
    const block = new Block({ id, x, y, w, h, z, clearStyleKey, screen: this.screen });
    this.blocks.push(block);
    this.blocks.sort((a, b) => a.z - b.z);
    return block;
  }

  removeBlock(id) {
    this.blocks = this.blocks.filter(b => b.id !== id);
  }

  // Composite all blocks onto the screen in z-order.
  composite() {
    for (const b of this.blocks) b.flushToScreen();
  }
}

export class Block {
  constructor({ id, x, y, w, h, z, clearStyleKey, screen }) {
    this.id = id;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.z = z;
    this.screen = screen;

    this.clearStyleKey = clearStyleKey ?? screen.registerStyle({});
    this._cells = allocCells(w, h);
    this._dirty = true;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this._cells = allocCells(w, h);
    this._dirty = true;
  }

  clear() {
    for (let i = 0; i < this._cells.length; i++) {
      this._cells[i].ch = " ";
      this._cells[i].styleKey = this.clearStyleKey;
    }
    this._dirty = true;
  }

  drawText(x, y, text, styleKey) {
    if (y < 0 || y >= this.h) return;
    let cx = x;
    for (const ch of text) {
      if (cx >= 0 && cx < this.w) {
        const idx = y * this.w + cx;
        this._cells[idx].ch = ch;
        this._cells[idx].styleKey = styleKey;
      }
      cx++;
      if (cx >= this.w) break;
    }
    this._dirty = true;
  }

  fillRect(x, y, w, h, ch, styleKey) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const idx = yy * this.w + xx;
        this._cells[idx].ch = ch;
        this._cells[idx].styleKey = styleKey;
      }
    }
    this._dirty = true;
  }

  // Animation support: supply a function that draws a frame into the block.
  animate(fn /* (block, tMs) */, { fps = 30 } = {}) {
    let active = true;
    const frameMs = Math.max(1, Math.floor(1000 / fps));
    const loop = () => {
      if (!active) return;
      fn(this, Date.now());
      setTimeout(loop, frameMs);
    };
    loop();
    return () => { active = false; };
  }

  flushToScreen() {
    if (!this._dirty) return;

    for (let yy = 0; yy < this.h; yy++) {
      const sy = this.y + yy;
      if (sy < 0 || sy >= this.screen.height) continue;
      for (let xx = 0; xx < this.w; xx++) {
        const sx = this.x + xx;
        if (sx < 0 || sx >= this.screen.width) continue;
        const src = this._cells[yy * this.w + xx];
        const idx = sy * this.screen.width + sx;
        this.screen._cells[idx].ch = src.ch;
        this.screen._cells[idx].styleKey = src.styleKey;
      }
    }

    this._dirty = false;
  }
}

function allocCells(w, h) {
  const n = w * h;
  const arr = new Array(n);
  for (let i = 0; i < n; i++) arr[i] = { ch: " ", styleKey: "s0" };
  return arr;
}
