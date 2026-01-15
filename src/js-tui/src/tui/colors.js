import { ANSI } from "./ansi.js";

/**
 * Style = { fg, bg, bold, dim, italic, underline, blink, inverse }
 * fg/bg can be:
 *  - null (no-op)
 *  - { type: "ansi256", n: 0..255 }
 *  - { type: "rgb", r,g,b }
 */
export function styleToSgr(style = {}) {
  const codes = [];

  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.blink) codes.push(5);
  if (style.inverse) codes.push(7);

  if (style.fg) codes.push(...colorCodes("fg", style.fg));
  if (style.bg) codes.push(...colorCodes("bg", style.bg));

  if (codes.length === 0) return "";
  return ANSI.sgr(codes);
}

function colorCodes(which, c) {
  const isFg = which === "fg";
  if (c.type === "ansi256") {
    // 38;5;n or 48;5;n
    return [isFg ? 38 : 48, 5, clamp(c.n, 0, 255)];
  }
  if (c.type === "rgb") {
    // 38;2;r;g;b or 48;2;r;g;b
    return [isFg ? 38 : 48, 2, clamp(c.r, 0, 255), clamp(c.g, 0, 255), clamp(c.b, 0, 255)];
  }
  return [];
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v | 0));
}

// Convenience constructors
export const C = {
  fg256: (n) => ({ type: "ansi256", n }),
  bg256: (n) => ({ type: "ansi256", n }),
  fgRgb: (r, g, b) => ({ type: "rgb", r, g, b }),
  bgRgb: (r, g, b) => ({ type: "rgb", r, g, b })
};
