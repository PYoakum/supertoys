/**
 * @fileoverview Keyboard input handler for TUI
 * @module tui/input
 *
 * Adapted from js-tui input handler
 */

/**
 * Raw input handler with buffered parsing
 */
export class Input {
  constructor() {
    this._handlers = new Set();
    this._onData = this._onData.bind(this);
    this._buffer = '';
    this._escTimeout = null;
    this._ESC_TIMEOUT_MS = 50; // Wait 50ms for escape sequence completion
  }

  /**
   * Start listening for keyboard input
   */
  start() {
    // Check if stdin is a TTY (interactive terminal)
    if (!process.stdin.isTTY) {
      console.error('Error: stdin is not a TTY. Run this command in an interactive terminal.');
      process.exit(1);
    }

    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', this._onData);
  }

  /**
   * Stop listening
   */
  stop() {
    if (this._escTimeout) {
      clearTimeout(this._escTimeout);
      this._escTimeout = null;
    }
    process.stdin.off('data', this._onData);
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors when restoring mode
      }
    }
    process.stdin.pause();
  }

  /**
   * Subscribe to input events
   * @param {Function} fn - Callback
   * @returns {Function} Unsubscribe function
   */
  on(fn) {
    this._handlers.add(fn);
    return () => this._handlers.delete(fn);
  }

  /**
   * Emit event to handlers
   * @param {Object} evt
   * @private
   */
  _emit(evt) {
    for (const fn of this._handlers) {
      fn(evt);
    }
  }

  /**
   * Handle incoming data from stdin
   * @param {string} chunk
   * @private
   */
  _onData(chunk) {
    // Clear any pending ESC timeout since we got more data
    if (this._escTimeout) {
      clearTimeout(this._escTimeout);
      this._escTimeout = null;
    }

    // Append to buffer
    this._buffer += chunk;

    // Parse as much as possible
    this._parseBuffer();
  }

  /**
   * Parse buffer and emit events
   * @private
   */
  _parseBuffer() {
    while (this._buffer.length > 0) {
      const result = this._tryParse();

      if (!result) {
        // Check if we have a lone ESC that needs a timeout
        if (this._buffer === '\x1b' || this._buffer === '\x1b[') {
          // Set timeout to either get more data or treat as standalone
          this._escTimeout = setTimeout(() => {
            this._escTimeout = null;
            if (this._buffer === '\x1b') {
              this._buffer = '';
              this._emit({ type: 'key', key: 'esc' });
            } else if (this._buffer === '\x1b[') {
              // Incomplete sequence, discard
              this._buffer = '';
            }
          }, this._ESC_TIMEOUT_MS);
        }
        break;
      }

      this._buffer = this._buffer.slice(result.consumed);
      if (result.event) {
        this._emit(result.event);
      }
    }
  }

  /**
   * Try to parse an event from the buffer
   * @returns {{consumed: number, event: Object}|null}
   * @private
   */
  _tryParse() {
    const buf = this._buffer;

    // Ctrl+C
    if (buf.startsWith('\x03')) {
      return { consumed: 1, event: { type: 'key', key: 'ctrl+c' } };
    }

    // Ctrl+D
    if (buf.startsWith('\x04')) {
      return { consumed: 1, event: { type: 'key', key: 'ctrl+d' } };
    }

    // Ctrl+Q
    if (buf.startsWith('\x11')) {
      return { consumed: 1, event: { type: 'key', key: 'ctrl+q' } };
    }

    // Escape sequences
    if (buf.startsWith('\x1b')) {
      // Arrow keys: ESC [ A/B/C/D
      if (buf.startsWith('\x1b[A')) return { consumed: 3, event: { type: 'key', key: 'up' } };
      if (buf.startsWith('\x1b[B')) return { consumed: 3, event: { type: 'key', key: 'down' } };
      if (buf.startsWith('\x1b[C')) return { consumed: 3, event: { type: 'key', key: 'right' } };
      if (buf.startsWith('\x1b[D')) return { consumed: 3, event: { type: 'key', key: 'left' } };

      // Home/End
      if (buf.startsWith('\x1b[H')) return { consumed: 3, event: { type: 'key', key: 'home' } };
      if (buf.startsWith('\x1b[F')) return { consumed: 3, event: { type: 'key', key: 'end' } };

      // Delete: ESC [ 3 ~
      if (buf.startsWith('\x1b[3~')) return { consumed: 4, event: { type: 'key', key: 'delete' } };

      // Page Up/Down: ESC [ 5/6 ~
      if (buf.startsWith('\x1b[5~')) return { consumed: 4, event: { type: 'key', key: 'pageup' } };
      if (buf.startsWith('\x1b[6~')) return { consumed: 4, event: { type: 'key', key: 'pagedown' } };

      // If we have ESC followed by something we don't recognize,
      // wait for more data if buffer is short
      if (buf.length === 1) {
        // Bare ESC - wait for more data (timeout will handle standalone ESC)
        return null;
      }

      // If ESC followed by [ but not enough chars, wait for more
      if (buf.length === 2 && buf[1] === '[') {
        return null; // Wait for more data
      }

      // ESC followed by [ and at least one more char
      if (buf.startsWith('\x1b[')) {
        // Check if we need more data for numeric sequences like \x1b[5~
        if (buf.length === 3 && buf[2] >= '0' && buf[2] <= '9') {
          return null; // Wait for ~ terminator
        }

        // Unknown escape sequence - skip it
        let end = 2;
        while (end < buf.length && buf[end] >= '0' && buf[end] <= '9') end++;
        if (end < buf.length) end++; // Skip the final character
        return { consumed: end, event: { type: 'key', key: 'unknown' } };
      }

      // ESC followed by non-[ character (like ESC+letter for Alt combos)
      // Treat ESC as standalone and leave the rest
      return { consumed: 1, event: { type: 'key', key: 'esc' } };
    }

    // Enter
    if (buf.startsWith('\r') || buf.startsWith('\n')) {
      return { consumed: 1, event: { type: 'key', key: 'enter' } };
    }

    // Tab
    if (buf.startsWith('\t')) {
      return { consumed: 1, event: { type: 'key', key: 'tab' } };
    }

    // Backspace (DEL)
    if (buf.startsWith('\x7f') || buf.startsWith('\x08')) {
      return { consumed: 1, event: { type: 'key', key: 'backspace' } };
    }

    // Space
    if (buf.startsWith(' ')) {
      return { consumed: 1, event: { type: 'key', key: 'space' } };
    }

    // Regular text (first codepoint)
    const code = buf.codePointAt(0);
    if (code != null && code >= 32 && code < 127) {
      const char = String.fromCodePoint(code);
      return { consumed: char.length, event: { type: 'text', text: char } };
    }

    // Skip unknown byte
    return { consumed: 1, event: null };
  }
}

/**
 * Create key event
 * @param {string} key
 * @returns {Object}
 */
export function keyEvent(key) {
  return { type: 'key', key, _stopped: false };
}

/**
 * Create text event
 * @param {string} text
 * @returns {Object}
 */
export function textEvent(text) {
  return { type: 'text', text, _stopped: false };
}

/**
 * Stop event propagation
 * @param {Object} evt
 * @param {string} [reason]
 * @returns {Object}
 */
export function stop(evt, reason) {
  if (evt) {
    evt._stopped = true;
    evt._stopReason = reason;
  }
  return evt;
}

/**
 * Check if event was stopped
 * @param {Object} evt
 * @returns {boolean}
 */
export function isStopped(evt) {
  return evt?._stopped === true;
}

export default { Input, keyEvent, textEvent, stop, isStopped };
