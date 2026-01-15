/**
 * Character mapping for alternative displays.
 * Use it to swap Unicode box drawing into ASCII, etc.
 */
export const CHARSETS = {
  unicode: {
    h: "─", v: "│",
    tl: "┌", tr: "┐", bl: "└", br: "┘",
    t: "┬", b: "┴", l: "├", r: "┤", x: "┼",
    bullet: "•",
    arrowR: "→",
    arrowD: "↓",
    ellipsis: "…"
  },
  ascii: {
    h: "-", v: "|",
    tl: "+", tr: "+", bl: "+", br: "+",
    t: "+", b: "+", l: "+", r: "+", x: "+",
    bullet: "*",
    arrowR: ">",
    arrowD: "v",
    ellipsis: "..."
  }
};

export function createCharMapper(map = CHARSETS.unicode) {
  return {
    map,
    setMap(newMap) { this.map = newMap; },
    // Replace tokens in strings: "{tl}{h}{tr}"
    render(str) {
      return str.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
        const v = this.map[key];
        return v == null ? `{${key}}` : String(v);
      });
    }
  };
}
