/**
 * @fileoverview CGA Color Palette for TUI
 * @module tui/colors
 *
 * Classic 16-color CGA palette using ANSI color codes 0-15
 */

/**
 * CGA color indices (standard ANSI 0-15)
 * Note: RED and LIGHT_RED replaced with INDIGO (256-color mode)
 */
export const CGA = {
  BLACK: 0,
  BLUE: 1,
  GREEN: 2,
  CYAN: 3,
  RED: 4,           // Kept for compatibility but not used in UI
  MAGENTA: 5,
  BROWN: 6,         // Also called "yellow" in some systems
  LIGHT_GRAY: 7,
  DARK_GRAY: 8,
  LIGHT_BLUE: 9,
  LIGHT_GREEN: 10,
  LIGHT_CYAN: 11,
  LIGHT_RED: 12,    // Kept for compatibility but not used in UI
  LIGHT_MAGENTA: 13,
  YELLOW: 14,
  WHITE: 15
};

/**
 * Extended 256-color palette additions
 */
export const EXTENDED = {
  LAVENDER: 183,       // Light lavender (#d7afff)
  LIGHT_LAVENDER: 189, // Lighter lavender (#d7d7ff)
  INDIGO: 54,          // Deep indigo (#5f0087)
  LIGHT_INDIGO: 99     // Lighter indigo (#875fff)
};

/**
 * Semantic color aliases for UI elements
 * Note: Error colors now use indigo instead of red
 */
export const UI = {
  // Backgrounds
  BG_NORMAL: CGA.BLUE,
  BG_PANEL: CGA.BLACK,
  BG_SELECTED: CGA.CYAN,
  BG_HEADER: EXTENDED.INDIGO,
  BG_FOOTER: EXTENDED.INDIGO,
  BG_ERROR: EXTENDED.INDIGO,        // Changed from RED to INDIGO
  BG_SUCCESS: CGA.GREEN,

  // Foregrounds
  FG_NORMAL: CGA.LIGHT_GRAY,
  FG_BRIGHT: CGA.WHITE,
  FG_DIM: CGA.DARK_GRAY,
  FG_SELECTED: CGA.BLACK,
  FG_TITLE: CGA.YELLOW,
  FG_ACCENT: CGA.LIGHT_CYAN,
  FG_ERROR: EXTENDED.LIGHT_INDIGO,  // Changed from LIGHT_RED to LIGHT_INDIGO
  FG_SUCCESS: CGA.LIGHT_GREEN,
  FG_WARNING: CGA.YELLOW,

  // Borders
  BORDER_NORMAL: CGA.LIGHT_GRAY,
  BORDER_ACTIVE: CGA.WHITE,
  BORDER_DIM: CGA.DARK_GRAY
};

/**
 * Style object format (compatible with js-tui)
 * @typedef {Object} Style
 * @property {Object|null} fg - Foreground color
 * @property {Object|null} bg - Background color
 * @property {boolean} bold
 * @property {boolean} dim
 * @property {boolean} italic
 * @property {boolean} underline
 * @property {boolean} blink
 * @property {boolean} inverse
 */

/**
 * Create foreground color object (auto-detects 16 vs 256 color mode)
 * @param {number} n - Color index (0-15 for ANSI16, 16-255 for ANSI256)
 * @returns {Object}
 */
export function fg(n) {
  return n > 15 ? { type: 'ansi256', n } : { type: 'ansi16', n };
}

/**
 * Create background color object (auto-detects 16 vs 256 color mode)
 * @param {number} n - Color index (0-15 for ANSI16, 16-255 for ANSI256)
 * @returns {Object}
 */
export function bg(n) {
  return n > 15 ? { type: 'ansi256', n } : { type: 'ansi16', n };
}

/**
 * Convert color to SGR codes
 * @param {'fg'|'bg'} which - Foreground or background
 * @param {Object} color - Color object
 * @returns {number[]} SGR codes
 */
function colorCodes(which, color) {
  if (!color) return [];

  const { type, n } = color;

  if (type === 'ansi16') {
    // Standard ANSI 16 colors
    // FG: 30-37 (normal), 90-97 (bright)
    // BG: 40-47 (normal), 100-107 (bright)
    if (which === 'fg') {
      return n < 8 ? [30 + n] : [90 + (n - 8)];
    } else {
      return n < 8 ? [40 + n] : [100 + (n - 8)];
    }
  }

  if (type === 'ansi256') {
    // 256-color mode (fallback)
    return which === 'fg' ? [38, 5, n] : [48, 5, n];
  }

  return [];
}

/**
 * Convert style object to ANSI SGR codes
 * @param {Style} style
 * @returns {number[]}
 */
export function styleToSgr(style) {
  const codes = [];

  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.blink) codes.push(5);
  if (style.inverse) codes.push(7);

  if (style.fg) codes.push(...colorCodes('fg', style.fg));
  if (style.bg) codes.push(...colorCodes('bg', style.bg));

  return codes;
}

/**
 * Color builder convenience object
 */
export const C = {
  fg: (n) => ({ type: 'ansi16', n }),
  bg: (n) => ({ type: 'ansi16', n }),
  fg256: (n) => ({ type: 'ansi256', n }),
  bg256: (n) => ({ type: 'ansi256', n })
};

/**
 * Predefined CGA-based UI styles
 */
export const STYLES = {
  // Panel styles
  panel: { fg: fg(UI.FG_NORMAL), bg: bg(UI.BG_PANEL) },
  panelBright: { fg: fg(UI.FG_BRIGHT), bg: bg(UI.BG_PANEL) },

  // Header/Footer
  header: { fg: fg(UI.FG_TITLE), bg: bg(UI.BG_HEADER), bold: true },
  footer: { fg: fg(UI.FG_NORMAL), bg: bg(UI.BG_FOOTER) },

  // Selection
  selected: { fg: fg(UI.FG_SELECTED), bg: bg(UI.BG_SELECTED), bold: true },

  // Text styles
  title: { fg: fg(UI.FG_TITLE), bg: bg(UI.BG_PANEL), bold: true },
  dim: { fg: fg(UI.FG_DIM), bg: bg(UI.BG_PANEL) },
  accent: { fg: fg(UI.FG_ACCENT), bg: bg(UI.BG_PANEL) },

  // Status
  error: { fg: fg(UI.FG_ERROR), bg: bg(UI.BG_PANEL), bold: true },
  success: { fg: fg(UI.FG_SUCCESS), bg: bg(UI.BG_PANEL), bold: true },
  warning: { fg: fg(UI.FG_WARNING), bg: bg(UI.BG_PANEL) },

  // Borders
  border: { fg: fg(UI.BORDER_NORMAL), bg: bg(UI.BG_PANEL) },
  borderActive: { fg: fg(UI.BORDER_ACTIVE), bg: bg(UI.BG_PANEL) }
};

export default { CGA, EXTENDED, UI, C, fg, bg, styleToSgr, STYLES };
