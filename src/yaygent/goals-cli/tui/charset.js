/**
 * @fileoverview ASCII Character Set for TUI
 * @module tui/charset
 *
 * Pure ASCII box drawing and symbols - no Unicode required
 */

/**
 * ASCII-only character set for box drawing
 */
export const ASCII = {
  // Box drawing
  h: '-',         // Horizontal line
  v: '|',         // Vertical line
  tl: '+',        // Top-left corner
  tr: '+',        // Top-right corner
  bl: '+',        // Bottom-left corner
  br: '+',        // Bottom-right corner
  t: '+',         // Top tee
  b: '+',         // Bottom tee
  l: '+',         // Left tee
  r: '+',         // Right tee
  x: '+',         // Cross

  // Double-line box (ASCII fallback)
  hd: '=',        // Double horizontal
  vd: '|',        // Double vertical (same as single)
  tld: '+',       // Double top-left
  trd: '+',       // Double top-right
  bld: '+',       // Double bottom-left
  brd: '+',       // Double bottom-right

  // Symbols
  bullet: '*',
  diamond: '*',
  check: 'x',
  cross: 'X',
  arrowR: '>',
  arrowL: '<',
  arrowU: '^',
  arrowD: 'v',
  ellipsis: '...',
  dot: '.',

  // Blocks/shading
  blockFull: '#',
  blockLight: ':',
  blockMedium: '%',
  blockDark: '@',

  // Progress
  progressFull: '=',
  progressEmpty: '-',
  progressCap: '>',

  // Tree
  treeBranch: '+',
  treeLast: '\\',
  treeVert: '|',
  treeSpace: ' '
};

/**
 * Character mapper class for template rendering
 */
export class CharMapper {
  constructor(charMap = ASCII) {
    this.map = { ...charMap };
  }

  /**
   * Set the character map
   * @param {Object} newMap
   */
  setMap(newMap) {
    this.map = { ...newMap };
  }

  /**
   * Get a character by key
   * @param {string} key
   * @returns {string}
   */
  get(key) {
    return this.map[key] ?? key;
  }

  /**
   * Render a template string with character substitutions
   * @param {string} template - Template with {key} placeholders
   * @returns {string}
   *
   * @example
   * charset.render("{tl}{h}{h}{h}{tr}")  // "+---+"
   */
  render(template) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      return this.map[key] ?? `{${key}}`;
    });
  }

  /**
   * Draw a horizontal line
   * @param {number} width
   * @returns {string}
   */
  hline(width) {
    return this.map.h.repeat(width);
  }

  /**
   * Draw a box top border
   * @param {number} width - Inner width (excluding corners)
   * @param {string} [title] - Optional title
   * @returns {string}
   */
  boxTop(width, title = '') {
    const { tl, tr, h } = this.map;
    if (title && title.length < width - 2) {
      const titleStr = ` ${title} `;
      const leftPad = Math.floor((width - titleStr.length) / 2);
      const rightPad = width - titleStr.length - leftPad;
      return tl + h.repeat(leftPad) + titleStr + h.repeat(rightPad) + tr;
    }
    return tl + h.repeat(width) + tr;
  }

  /**
   * Draw a box bottom border
   * @param {number} width - Inner width (excluding corners)
   * @returns {string}
   */
  boxBottom(width) {
    const { bl, br, h } = this.map;
    return bl + h.repeat(width) + br;
  }

  /**
   * Draw a box middle row
   * @param {number} width - Inner width (excluding sides)
   * @param {string} [content=''] - Content to center
   * @param {string} [fill=' '] - Fill character
   * @returns {string}
   */
  boxMiddle(width, content = '', fill = ' ') {
    const { v } = this.map;
    const text = content.slice(0, width);
    const padding = width - text.length;
    const rightPad = Math.floor(padding / 2);
    const leftPad = padding - rightPad;
    return v + fill.repeat(leftPad) + text + fill.repeat(rightPad) + v;
  }

  /**
   * Draw a box row with left-aligned content
   * @param {number} width - Inner width
   * @param {string} content - Content
   * @returns {string}
   */
  boxRow(width, content = '') {
    const { v } = this.map;
    const text = content.slice(0, width);
    return v + text + ' '.repeat(width - text.length) + v;
  }

  /**
   * Draw a separator line
   * @param {number} width - Inner width
   * @returns {string}
   */
  separator(width) {
    const { l, r, h } = this.map;
    return l + h.repeat(width) + r;
  }

  /**
   * Draw a progress bar
   * @param {number} width - Total width
   * @param {number} progress - Progress 0-1
   * @returns {string}
   */
  progressBar(width, progress) {
    const { progressFull, progressEmpty, progressCap } = this.map;
    const fillWidth = Math.round(progress * (width - 1));
    const emptyWidth = width - fillWidth - 1;
    return progressFull.repeat(fillWidth) + progressCap + progressEmpty.repeat(emptyWidth);
  }

  /**
   * Draw a tree node prefix
   * @param {number} depth - Node depth
   * @param {boolean} isLast - Is last sibling
   * @returns {string}
   */
  treePrefix(depth, isLast) {
    const { treeBranch, treeLast, treeVert, treeSpace } = this.map;
    let prefix = '';
    for (let i = 0; i < depth - 1; i++) {
      prefix += treeVert + '  ';
    }
    if (depth > 0) {
      prefix += (isLast ? treeLast : treeBranch) + '- ';
    }
    return prefix;
  }
}

/**
 * Create a character mapper with the ASCII charset
 * @returns {CharMapper}
 */
export function createCharMapper() {
  return new CharMapper(ASCII);
}

export default { ASCII, CharMapper, createCharMapper };
