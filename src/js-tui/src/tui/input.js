/**
 * Raw input handler. Emits normalized key events.
 * Supports arrows, enter, esc, ctrl+c, backspace, basic UTF-8 text.
 */
export class Input {
  constructor() {
    this.handlers = new Set();
    this._onData = this._onData.bind(this);
    this._buffer = "";
  }

  start() {
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", this._onData);
  }

  stop() {
    process.stdin.off("data", this._onData);
    try { process.stdin.setRawMode(false); } catch {}
    process.stdin.pause();
  }

  on(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  emit(evt) {
    for (const fn of this.handlers) fn(evt);
  }

  _onData(chunk) {
    // chunk may contain multiple escape sequences / characters
    this._buffer += chunk;

    // Parse as much as possible.
    while (this._buffer.length > 0) {
      const evt = tryParseEvent(this._buffer);
      if (!evt) break;
      this._buffer = this._buffer.slice(evt.consumed);
      this.emit(evt.event);
    }
  }
}

function tryParseEvent(buf) {
  // Ctrl+C
  if (buf.startsWith("\x03")) {
    return { consumed: 1, event: { type: "key", key: "ctrl+c" } };
  }

  // Escape sequences
  if (buf.startsWith("\x1b")) {
    // Arrow keys: ESC [ A/B/C/D
    if (buf.startsWith("\x1b[A")) return { consumed: 3, event: { type: "key", key: "up" } };
    if (buf.startsWith("\x1b[B")) return { consumed: 3, event: { type: "key", key: "down" } };
    if (buf.startsWith("\x1b[C")) return { consumed: 3, event: { type: "key", key: "right" } };
    if (buf.startsWith("\x1b[D")) return { consumed: 3, event: { type: "key", key: "left" } };

    // ESC alone (might be followed by more; if just ESC, treat as esc)
    if (buf.length >= 1) return { consumed: 1, event: { type: "key", key: "esc" } };
  }

  // Enter
  if (buf.startsWith("\r") || buf.startsWith("\n")) {
    return { consumed: 1, event: { type: "key", key: "enter" } };
  }

  // Backspace (DEL)
  if (buf.startsWith("\x7f")) {
    return { consumed: 1, event: { type: "key", key: "backspace" } };
  }

  // Plain text (take first codepoint)
  const cp = firstCodepoint(buf);
  if (cp) {
    return { consumed: cp.bytes, event: { type: "text", text: cp.char } };
  }

  return null;
}

function firstCodepoint(s) {
  if (!s || s.length === 0) return null;
  const code = s.codePointAt(0);
  if (code == null) return null;
  const char = String.fromCodePoint(code);
  const bytes = Buffer.from(char, "utf8").length;
  // If buffer doesn't yet contain full utf8 char, wait
  if (Buffer.from(s, "utf8").length < bytes) return null;
  return { char, bytes };
}
