/**
 * @fileoverview Keyboard input handler for TUI
 * @module tui/input
 */

/**
 * Input event types
 * @typedef {Object} KeyEvent
 * @property {'key'} type
 * @property {string} key - Key name (up, down, enter, esc, ctrl+c, etc.)
 *
 * @typedef {Object} TextEvent
 * @property {'text'} type
 * @property {string} text - Input text
 */

/**
 * Raw keyboard input handler
 */
export class Input {
  constructor() {
    /** @type {Function[]} */
    this._listeners = [];

    /** @type {boolean} */
    this._running = false;

    /** @type {Buffer} */
    this._buffer = Buffer.alloc(0);

    this._onData = this._onData.bind(this);
  }

  /**
   * Start listening for keyboard input
   */
  start() {
    if (this._running) return;
    this._running = true;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', this._onData);
  }

  /**
   * Stop listening
   */
  stop() {
    if (!this._running) return;
    this._running = false;

    process.stdin.off('data', this._onData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  /**
   * Subscribe to input events
   * @param {Function} fn - Callback
   * @returns {Function} Unsubscribe function
   */
  on(fn) {
    this._listeners.push(fn);
    return () => {
      const idx = this._listeners.indexOf(fn);
      if (idx !== -1) this._listeners.splice(idx, 1);
    };
  }

  /**
   * Emit event to listeners
   * @param {Object} evt
   * @private
   */
  _emit(evt) {
    for (const fn of this._listeners) {
      fn(evt);
    }
  }

  /**
   * Handle raw input data
   * @param {string} data
   * @private
   */
  _onData(data) {
    // Handle special keys
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      const code = data.charCodeAt(i);

      // Escape sequences
      if (ch === '\x1b') {
        // Check for arrow keys and other sequences
        if (data[i + 1] === '[') {
          const seq = data[i + 2];
          switch (seq) {
            case 'A': this._emit({ type: 'key', key: 'up' }); i += 2; continue;
            case 'B': this._emit({ type: 'key', key: 'down' }); i += 2; continue;
            case 'C': this._emit({ type: 'key', key: 'right' }); i += 2; continue;
            case 'D': this._emit({ type: 'key', key: 'left' }); i += 2; continue;
            case 'H': this._emit({ type: 'key', key: 'home' }); i += 2; continue;
            case 'F': this._emit({ type: 'key', key: 'end' }); i += 2; continue;
            case '3':
              if (data[i + 3] === '~') {
                this._emit({ type: 'key', key: 'delete' });
                i += 3;
                continue;
              }
              break;
            case '5':
              if (data[i + 3] === '~') {
                this._emit({ type: 'key', key: 'pageup' });
                i += 3;
                continue;
              }
              break;
            case '6':
              if (data[i + 3] === '~') {
                this._emit({ type: 'key', key: 'pagedown' });
                i += 3;
                continue;
              }
              break;
          }
        }
        // Bare escape
        this._emit({ type: 'key', key: 'esc' });
        continue;
      }

      // Control characters
      if (code === 3) {  // Ctrl+C
        this._emit({ type: 'key', key: 'ctrl+c' });
        continue;
      }
      if (code === 4) {  // Ctrl+D
        this._emit({ type: 'key', key: 'ctrl+d' });
        continue;
      }
      if (code === 12) {  // Ctrl+L
        this._emit({ type: 'key', key: 'ctrl+l' });
        continue;
      }
      if (code === 17) {  // Ctrl+Q
        this._emit({ type: 'key', key: 'ctrl+q' });
        continue;
      }

      // Enter
      if (code === 13 || code === 10) {
        this._emit({ type: 'key', key: 'enter' });
        continue;
      }

      // Tab
      if (code === 9) {
        this._emit({ type: 'key', key: 'tab' });
        continue;
      }

      // Backspace
      if (code === 127 || code === 8) {
        this._emit({ type: 'key', key: 'backspace' });
        continue;
      }

      // Space
      if (code === 32) {
        this._emit({ type: 'key', key: 'space' });
        continue;
      }

      // Regular text
      if (code >= 32 && code < 127) {
        this._emit({ type: 'text', text: ch });
      }
    }
  }
}

/**
 * Create key event
 * @param {string} key
 * @returns {KeyEvent}
 */
export function keyEvent(key) {
  return { type: 'key', key, _stopped: false };
}

/**
 * Create text event
 * @param {string} text
 * @returns {TextEvent}
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
  evt._stopped = true;
  evt._stopReason = reason;
  return evt;
}

/**
 * Check if event was stopped
 * @param {Object} evt
 * @returns {boolean}
 */
export function isStopped(evt) {
  return evt._stopped === true;
}

export default { Input, keyEvent, textEvent, stop, isStopped };
