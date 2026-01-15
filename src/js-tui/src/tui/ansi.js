// Minimal ANSI helpers for terminal control.
export const ANSI = {
  esc: "\x1b[",
  csi(code) { return `${ANSI.esc}${code}`; },

  // Screen modes
  altScreenOn: () => ANSI.csi("?1049h"),
  altScreenOff: () => ANSI.csi("?1049l"),
  clear: () => ANSI.csi("2J"),
  home: () => ANSI.csi("H"),

  hideCursor: () => ANSI.csi("?25l"),
  showCursor: () => ANSI.csi("?25h"),

  // Move cursor (1-based)
  moveTo: (row1, col1) => ANSI.csi(`${row1};${col1}H`),

  // Reset all styles
  reset: () => ANSI.csi("0m"),

  // SGR builder
  sgr: (codes) => ANSI.csi(`${codes.join(";")}m`)
};

export function writeStdout(s) {
  process.stdout.write(s);
}
