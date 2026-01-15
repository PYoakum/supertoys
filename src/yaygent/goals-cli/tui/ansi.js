/**
 * @fileoverview ANSI escape sequence utilities
 * @module tui/ansi
 */

const ESC = '\x1b[';

/**
 * ANSI escape sequence helpers
 */
export const ANSI = {
  esc: ESC,

  /**
   * Build CSI sequence
   * @param {string} code
   * @returns {string}
   */
  csi(code) {
    return ESC + code;
  },

  // Screen buffer control
  altScreenOn() { return ESC + '?1049h'; },
  altScreenOff() { return ESC + '?1049l'; },

  // Screen operations
  clear() { return ESC + '2J'; },
  clearLine() { return ESC + '2K'; },
  clearToEnd() { return ESC + '0K'; },
  clearToStart() { return ESC + '1K'; },

  // Cursor control
  home() { return ESC + 'H'; },
  moveTo(row, col) { return ESC + `${row};${col}H`; },
  moveUp(n = 1) { return ESC + `${n}A`; },
  moveDown(n = 1) { return ESC + `${n}B`; },
  moveRight(n = 1) { return ESC + `${n}C`; },
  moveLeft(n = 1) { return ESC + `${n}D`; },

  // Cursor visibility
  hideCursor() { return ESC + '?25l'; },
  showCursor() { return ESC + '?25h'; },
  saveCursor() { return ESC + 's'; },
  restoreCursor() { return ESC + 'u'; },

  // Style reset
  reset() { return ESC + '0m'; },

  /**
   * Select Graphic Rendition (styling)
   * @param {number[]} codes - SGR codes
   * @returns {string}
   */
  sgr(codes) {
    if (!codes || codes.length === 0) return ESC + '0m';
    return ESC + codes.join(';') + 'm';
  }
};

/**
 * Write directly to stdout
 * @param {string} s
 */
export function writeStdout(s) {
  if (typeof Bun !== 'undefined') {
    Bun.write(Bun.stdout, s);
  } else if (process?.stdout) {
    process.stdout.write(s);
  }
}

/**
 * Get terminal size
 * @returns {{width: number, height: number}}
 */
export function getTerminalSize() {
  if (process?.stdout?.columns && process?.stdout?.rows) {
    return {
      width: process.stdout.columns,
      height: process.stdout.rows
    };
  }
  // Default fallback
  return { width: 80, height: 24 };
}

export default { ANSI, writeStdout, getTerminalSize };
