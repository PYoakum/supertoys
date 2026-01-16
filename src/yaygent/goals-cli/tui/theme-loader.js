/**
 * @fileoverview Theme Loader for TUI
 * @module tui/theme-loader
 *
 * Loads and parses TOML theme files for customizing TUI colors.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * CGA color name to index mapping
 */
const CGA_COLORS = {
  black: 0,
  blue: 1,
  green: 2,
  cyan: 3,
  red: 4,
  magenta: 5,
  brown: 6,
  light_gray: 7,
  dark_gray: 8,
  light_blue: 9,
  light_green: 10,
  light_cyan: 11,
  light_red: 12,
  light_magenta: 13,
  yellow: 14,
  white: 15
};

/**
 * Default UI color assignments
 */
const DEFAULT_UI = {
  // Backgrounds
  bg_normal: 'blue',
  bg_panel: 'black',
  bg_selected: 'cyan',
  bg_header: 54,  // indigo (256-color)
  bg_footer: 54,  // indigo (256-color)
  bg_error: 54,  // indigo (256-color)
  bg_success: 'green',

  // Foregrounds
  fg_normal: 'light_gray',
  fg_bright: 'white',
  fg_dim: 'dark_gray',
  fg_selected: 'black',
  fg_title: 'yellow',
  fg_accent: 'light_cyan',
  fg_error: 99,  // light indigo (256-color)
  fg_success: 'light_green',
  fg_warning: 'yellow',
  fg_highlight: 'white',

  // Borders
  border_normal: 'light_gray',
  border_active: 'white',
  border_dim: 'dark_gray'
};

/**
 * Default style definitions
 */
const DEFAULT_STYLES = {
  panel: { fg: 'fg_normal', bg: 'bg_panel' },
  panel_bg: { bg: 'bg_panel' },
  header: { fg: 'fg_title', bg: 'bg_header', bold: true },
  footer: { fg: 'fg_normal', bg: 'bg_footer' },
  selected: { fg: 'fg_selected', bg: 'bg_selected', bold: true },
  item: { fg: 'fg_normal', bg: 'bg_panel' },
  title: { fg: 'fg_title', bg: 'bg_panel', bold: true },
  dim: { fg: 'fg_dim', bg: 'bg_panel' },
  accent: { fg: 'fg_accent', bg: 'bg_panel' },
  bright: { fg: 'fg_bright', bg: 'bg_panel', bold: true },
  normal: { fg: 'fg_normal', bg: 'bg_panel' },
  highlight: { fg: 'fg_highlight', bg: 'bg_panel', bold: true },
  error: { fg: 'fg_error', bg: 'bg_panel', bold: true },
  success: { fg: 'fg_success', bg: 'bg_panel', bold: true },
  warning: { fg: 'fg_warning', bg: 'bg_panel' },
  border: { fg: 'border_normal', bg: 'bg_panel' },
  border_active: { fg: 'border_active', bg: 'bg_panel' }
};

/**
 * Parse a simple TOML file
 * @param {string} content - TOML content
 * @returns {Object} Parsed object
 */
function parseToml(content) {
  const result = {};
  let currentSection = null;

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Section header [section]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      // Handle nested sections like [ui.backgrounds]
      const parts = currentSection.split('.');
      let obj = result;
      for (const part of parts) {
        if (!obj[part]) obj[part] = {};
        obj = obj[part];
      }
      continue;
    }

    // Key = value
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();

      // Parse value
      if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (/^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (/^-?\d+\.\d+$/.test(value)) {
        value = parseFloat(value);
      } else if ((value.startsWith('"') && value.endsWith('"')) ||
                 (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Set value in appropriate section
      if (currentSection) {
        const parts = currentSection.split('.');
        let obj = result;
        for (const part of parts) {
          if (!obj[part]) obj[part] = {};
          obj = obj[part];
        }
        obj[key] = value;
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Resolve a color name to color index
 * @param {string|number} color - Color name or index (0-255 for 256-color mode)
 * @returns {number} Color index
 */
function resolveColor(color) {
  if (typeof color === 'number') {
    // Allow full 256-color range (0-255)
    return Math.min(255, Math.max(0, color));
  }
  const lower = String(color).toLowerCase().replace(/-/g, '_');
  return CGA_COLORS[lower] ?? 7; // Default to light_gray
}

/**
 * Resolve UI reference to color index
 * @param {string} ref - UI reference like 'fg_normal' or color name
 * @param {Object} uiColors - Resolved UI colors
 * @returns {number} CGA color index
 */
function resolveUIRef(ref, uiColors) {
  if (typeof ref === 'number') {
    return ref;
  }
  const lower = String(ref).toLowerCase().replace(/-/g, '_');
  if (uiColors[lower] !== undefined) {
    return uiColors[lower];
  }
  return resolveColor(ref);
}

/**
 * Load and parse a theme file
 * @param {string} themePath - Path to theme TOML file
 * @returns {Object} Theme configuration
 */
export function loadTheme(themePath) {
  const absPath = resolve(themePath);

  if (!existsSync(absPath)) {
    throw new Error(`Theme file not found: ${absPath}`);
  }

  const content = readFileSync(absPath, 'utf-8');
  return parseToml(content);
}

/**
 * Build UI colors from theme config
 * @param {Object} theme - Parsed theme object
 * @returns {Object} UI color indices
 */
export function buildUIColors(theme) {
  const ui = { ...DEFAULT_UI };

  // Apply theme overrides
  if (theme.ui) {
    // Backgrounds
    if (theme.ui.backgrounds) {
      for (const [key, value] of Object.entries(theme.ui.backgrounds)) {
        ui[`bg_${key}`] = value;
      }
    }
    // Foregrounds
    if (theme.ui.foregrounds) {
      for (const [key, value] of Object.entries(theme.ui.foregrounds)) {
        ui[`fg_${key}`] = value;
      }
    }
    // Borders
    if (theme.ui.borders) {
      for (const [key, value] of Object.entries(theme.ui.borders)) {
        ui[`border_${key}`] = value;
      }
    }
  }

  // Resolve all color names to indices
  const resolved = {};
  for (const [key, value] of Object.entries(ui)) {
    resolved[key] = resolveColor(value);
  }

  return resolved;
}

/**
 * Build styles from theme config
 * @param {Object} theme - Parsed theme object
 * @param {Object} uiColors - Resolved UI colors
 * @returns {Object} Style definitions for App._registerStyles
 */
export function buildStyles(theme, uiColors) {
  const styles = { ...DEFAULT_STYLES };

  // Apply theme style overrides
  if (theme.styles) {
    for (const [name, def] of Object.entries(theme.styles)) {
      styles[name] = { ...styles[name], ...def };
    }
  }

  // Convert style definitions to color objects
  // Auto-detect 16 vs 256 color mode based on color index
  const colorObj = (n) => n > 15 ? { type: 'ansi256', n } : { type: 'ansi16', n };
  const C = {
    fg: colorObj,
    bg: colorObj
  };

  const resolved = {};
  for (const [name, def] of Object.entries(styles)) {
    const style = {};

    if (def.fg) {
      style.fg = C.fg(resolveUIRef(def.fg, uiColors));
    }
    if (def.bg) {
      style.bg = C.bg(resolveUIRef(def.bg, uiColors));
    }
    if (def.bold) style.bold = true;
    if (def.dim) style.dim = true;
    if (def.italic) style.italic = true;
    if (def.underline) style.underline = true;
    if (def.inverse) style.inverse = true;

    resolved[name] = style;
  }

  return resolved;
}

/**
 * Load theme and build complete style configuration
 * @param {string} [themePath] - Path to theme file (optional)
 * @returns {Object} Style configuration for App
 */
export function loadThemeStyles(themePath) {
  let theme = {};

  if (themePath) {
    try {
      theme = loadTheme(themePath);
    } catch (err) {
      console.error(`Warning: Failed to load theme: ${err.message}`);
      console.error('Using default theme.');
    }
  }

  const uiColors = buildUIColors(theme);
  const styles = buildStyles(theme, uiColors);

  return {
    theme,
    uiColors,
    styles
  };
}

/**
 * Get default theme path
 * @returns {string}
 */
export function getDefaultThemePath() {
  return resolve(__dirname, 'themes', 'default.toml');
}

/**
 * List available built-in themes
 * @returns {string[]} Theme names
 */
export function listBuiltInThemes() {
  const themesDir = resolve(__dirname, 'themes');
  if (!existsSync(themesDir)) {
    return ['default'];
  }

  try {
    const { readdirSync } = require('fs');
    return readdirSync(themesDir)
      .filter(f => f.endsWith('.toml'))
      .map(f => f.replace('.toml', ''));
  } catch {
    return ['default'];
  }
}

export default {
  loadTheme,
  loadThemeStyles,
  buildUIColors,
  buildStyles,
  getDefaultThemePath,
  listBuiltInThemes,
  CGA_COLORS,
  DEFAULT_UI,
  DEFAULT_STYLES
};
