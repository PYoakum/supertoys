/**
 * @fileoverview Screen buffer for TUI rendering
 * @module tui/screen
 */

import { ANSI, writeStdout, getTerminalSize } from './ansi.js';
import { styleToSgr } from './colors.js';

/**
 * Cell in the screen buffer
 * @typedef {Object} Cell
 * @property {string} ch - Character
 * @property {string} styleKey - Style key reference
 */

/**
 * Screen buffer for terminal rendering
 */
export class Screen {
  /**
   * @param {Object} options
   * @param {number} [options.width] - Screen width (default: terminal width)
   * @param {number} [options.height] - Screen height (default: terminal height)
   */
  constructor(options = {}) {
    const size = getTerminalSize();
    this.width = options.width || size.width;
    this.height = options.height || size.height;

    /** @type {Cell[][]} Current frame buffer */
    this._cells = this._createBuffer();

    /** @type {Cell[][]} Previous frame buffer for diffing */
    this._prev = this._createBuffer();

    /** @type {Map<string, Object>} Style registry */
    this._styles = new Map();

    /** @type {Map<string, string>} Style deduplication cache */
    this._styleKeyCache = new Map();

    /** @type {number} Style key counter */
    this._styleCounter = 0;

    /** @type {string} Default style key */
    this._defaultStyleKey = this.registerStyle({});
  }

  /**
   * Create empty buffer
   * @returns {Cell[][]}
   * @private
   */
  _createBuffer() {
    const buffer = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        row.push({ ch: ' ', styleKey: 's0' });
      }
      buffer.push(row);
    }
    return buffer;
  }

  /**
   * Register a style and return its key
   * @param {Object} style - Style object
   * @returns {string} Style key
   */
  registerStyle(style) {
    const json = JSON.stringify(style);
    const existing = this._styleKeyCache.get(json);
    if (existing) return existing;

    const key = 's' + this._styleCounter++;
    this._styles.set(key, style);
    this._styleKeyCache.set(json, key);
    return key;
  }

  /**
   * Get style by key
   * @param {string} key
   * @returns {Object|null}
   */
  getStyle(key) {
    return this._styles.get(key) || null;
  }

  /**
   * Clear screen with style
   * @param {string} [styleKey]
   */
  clear(styleKey) {
    const key = styleKey || this._defaultStyleKey;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this._cells[y][x] = { ch: ' ', styleKey: key };
      }
    }
  }

  /**
   * Set a cell
   * @param {number} x
   * @param {number} y
   * @param {string} ch
   * @param {string} styleKey
   */
  setCell(x, y, ch, styleKey) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this._cells[y][x] = { ch: ch[0] || ' ', styleKey };
  }

  /**
   * Draw text at position
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {string} styleKey
   */
  drawText(x, y, text, styleKey) {
    if (y < 0 || y >= this.height) return;

    for (let i = 0; i < text.length; i++) {
      const px = x + i;
      if (px < 0) continue;
      if (px >= this.width) break;
      this._cells[y][px] = { ch: text[i], styleKey };
    }
  }

  /**
   * Fill rectangle with character
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} ch
   * @param {string} styleKey
   */
  fillRect(x, y, w, h, ch, styleKey) {
    for (let dy = 0; dy < h; dy++) {
      const py = y + dy;
      if (py < 0 || py >= this.height) continue;

      for (let dx = 0; dx < w; dx++) {
        const px = x + dx;
        if (px < 0 || px >= this.width) continue;
        this._cells[py][px] = { ch, styleKey };
      }
    }
  }

  /**
   * Draw a box
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {Object} charset - Character mapper
   * @param {string} styleKey
   * @param {string} [title]
   */
  drawBox(x, y, w, h, charset, styleKey, title) {
    if (w < 2 || h < 2) return;

    const { tl, tr, bl, br, h: hc, v } = charset.map || charset;

    // Top border
    this.setCell(x, y, tl, styleKey);
    for (let i = 1; i < w - 1; i++) {
      this.setCell(x + i, y, hc, styleKey);
    }
    this.setCell(x + w - 1, y, tr, styleKey);

    // Title
    if (title && w > 4) {
      const maxLen = w - 4;
      const text = title.length > maxLen ? title.slice(0, maxLen) : title;
      const titleX = x + Math.floor((w - text.length - 2) / 2);
      this.drawText(titleX, y, ` ${text} `, styleKey);
    }

    // Sides
    for (let i = 1; i < h - 1; i++) {
      this.setCell(x, y + i, v, styleKey);
      this.setCell(x + w - 1, y + i, v, styleKey);
    }

    // Bottom border
    this.setCell(x, y + h - 1, bl, styleKey);
    for (let i = 1; i < w - 1; i++) {
      this.setCell(x + i, y + h - 1, hc, styleKey);
    }
    this.setCell(x + w - 1, y + h - 1, br, styleKey);
  }

  /**
   * Render screen to terminal (differential)
   */
  render() {
    let output = '';
    let lastStyleKey = null;

    for (let y = 0; y < this.height; y++) {
      let rowChanged = false;
      let rowStart = -1;

      // Check if row has changes
      for (let x = 0; x < this.width; x++) {
        const curr = this._cells[y][x];
        const prev = this._prev[y][x];

        if (curr.ch !== prev.ch || curr.styleKey !== prev.styleKey) {
          rowChanged = true;
          if (rowStart === -1) rowStart = x;
        }
      }

      if (!rowChanged) continue;

      // Move to row start (1-indexed)
      output += ANSI.moveTo(y + 1, rowStart + 1);

      // Render changed portion
      for (let x = rowStart; x < this.width; x++) {
        const cell = this._cells[y][x];

        // Apply style if changed
        if (cell.styleKey !== lastStyleKey) {
          const style = this._styles.get(cell.styleKey) || {};
          const codes = styleToSgr(style);
          output += ANSI.sgr(codes.length > 0 ? codes : [0]);
          lastStyleKey = cell.styleKey;
        }

        output += cell.ch;

        // Update prev buffer
        this._prev[y][x] = { ...cell };
      }
    }

    // Reset styles at end
    output += ANSI.reset();

    if (output) {
      writeStdout(output);
    }
  }

  /**
   * Force full redraw
   */
  forceRedraw() {
    // Clear prev buffer to force all cells to redraw
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this._prev[y][x] = { ch: '\0', styleKey: '' };
      }
    }
    this.render();
  }

  /**
   * Resize screen
   * @param {number} width
   * @param {number} height
   */
  resize(width, height) {
    this.width = width;
    this.height = height;
    this._cells = this._createBuffer();
    this._prev = this._createBuffer();
  }
}

export default Screen;
