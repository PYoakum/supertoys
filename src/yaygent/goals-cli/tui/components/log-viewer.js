/**
 * @fileoverview LogViewer component for TUI
 * @module tui/components/log-viewer
 */

/**
 * Log entry
 * @typedef {Object} LogEntry
 * @property {string} timestamp - ISO timestamp
 * @property {'debug'|'info'|'warn'|'error'|'success'} level - Log level
 * @property {string} message - Log message
 * @property {*} [data] - Optional data
 */

/**
 * Scrollable log display with color-coded levels
 */
export class LogViewer {
  /**
   * @param {Object} options
   * @param {boolean} [options.autoScroll=true] - Auto-scroll to bottom
   * @param {number} [options.maxEntries=1000] - Max entries to keep
   * @param {boolean} [options.showTimestamp=true] - Show timestamps
   * @param {string} [options.title] - Optional title
   */
  constructor(options = {}) {
    this.entries = [];
    this.autoScroll = options.autoScroll !== false;
    this.maxEntries = options.maxEntries || 1000;
    this.showTimestamp = options.showTimestamp !== false;
    this.title = options.title || '';
    this.scrollOffset = 0;
    this.filter = null; // Filter by level
    this.focused = false;
  }

  /**
   * Add a log entry
   * @param {LogEntry} entry
   */
  addEntry(entry) {
    this.entries.push({
      timestamp: entry.timestamp || new Date().toISOString(),
      level: entry.level || 'info',
      message: entry.message || '',
      data: entry.data
    });

    // Trim old entries
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Auto-scroll to bottom
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  /**
   * Add a debug message
   * @param {string} message
   * @param {*} [data]
   */
  debug(message, data) {
    this.addEntry({ level: 'debug', message, data });
  }

  /**
   * Add an info message
   * @param {string} message
   * @param {*} [data]
   */
  info(message, data) {
    this.addEntry({ level: 'info', message, data });
  }

  /**
   * Add a warning message
   * @param {string} message
   * @param {*} [data]
   */
  warn(message, data) {
    this.addEntry({ level: 'warn', message, data });
  }

  /**
   * Add an error message
   * @param {string} message
   * @param {*} [data]
   */
  error(message, data) {
    this.addEntry({ level: 'error', message, data });
  }

  /**
   * Add a success message
   * @param {string} message
   * @param {*} [data]
   */
  success(message, data) {
    this.addEntry({ level: 'success', message, data });
  }

  /**
   * Add a log line with specified level
   * @param {string} level - Log level (debug, info, warn, error, success)
   * @param {string} message - Log message
   * @param {*} [data] - Optional data
   */
  addLine(level, message, data) {
    this.addEntry({ level, message, data });
  }

  /**
   * Clear all entries
   */
  clear() {
    this.entries = [];
    this.scrollOffset = 0;
  }

  /**
   * Scroll to bottom
   */
  scrollToBottom() {
    this.scrollOffset = Math.max(0, this.entries.length - 1);
  }

  /**
   * Set level filter
   * @param {string|null} level
   */
  setFilter(level) {
    this.filter = level;
  }

  /**
   * Get filtered entries
   * @returns {LogEntry[]}
   */
  getFilteredEntries() {
    if (!this.filter) return this.entries;
    return this.entries.filter(e => e.level === this.filter);
  }

  /**
   * Focus the log viewer
   */
  focus() {
    this.focused = true;
  }

  /**
   * Blur the log viewer
   */
  blur() {
    this.focused = false;
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   * @param {boolean} [allowUnfocused=false] - Allow handling even when not focused
   * @returns {boolean} True if handled
   */
  onEvent(ctx, evt, allowUnfocused = false) {
    // Handle +/- keys for scrolling even when not focused
    if (evt.type === 'text') {
      const entries = this.getFilteredEntries();
      switch (evt.text) {
        case '-':
          // Page up (scroll back in history)
          this.scrollOffset = Math.max(0, this.scrollOffset - 10);
          this.autoScroll = false;
          return true;

        case '+':
        case '=':  // Also handle = (unshifted +)
          // Page down (scroll forward)
          this.scrollOffset = Math.min(Math.max(0, entries.length - 1), this.scrollOffset + 10);
          // Re-enable auto-scroll if we're at the bottom
          const visibleCount = 20; // Approximate
          if (this.scrollOffset >= entries.length - visibleCount) {
            this.autoScroll = true;
          }
          return true;
      }
    }

    if (!this.focused && !allowUnfocused) return false;

    if (evt.type === 'key') {
      switch (evt.key) {
        case 'up':
          if (this.scrollOffset > 0) {
            this.scrollOffset--;
            this.autoScroll = false;
          }
          return true;

        case 'down':
          const filtered = this.getFilteredEntries();
          if (this.scrollOffset < filtered.length - 1) {
            this.scrollOffset++;
          }
          return true;

        case 'pageup':
          this.scrollOffset = Math.max(0, this.scrollOffset - 10);
          this.autoScroll = false;
          return true;

        case 'pagedown':
          const entries = this.getFilteredEntries();
          this.scrollOffset = Math.min(entries.length - 1, this.scrollOffset + 10);
          return true;

        case 'home':
          this.scrollOffset = 0;
          this.autoScroll = false;
          return true;

        case 'end':
          this.scrollToBottom();
          this.autoScroll = true;
          return true;

        case 'ctrl+l':
          // Clear log
          this.clear();
          return true;
      }
    }

    return false;
  }

  /**
   * Get style for log level
   * @param {string} level
   * @param {Object} styles
   * @returns {string}
   * @private
   */
  _getLevelStyle(level, styles) {
    switch (level) {
      case 'debug': return styles.dim;
      case 'info': return styles.item;
      case 'warn': return styles.warning;
      case 'error': return styles.error;
      case 'success': return styles.success;
      default: return styles.item;
    }
  }

  /**
   * Get level prefix
   * @param {string} level
   * @returns {string}
   * @private
   */
  _getLevelPrefix(level) {
    switch (level) {
      case 'debug': return '[DBG]';
      case 'info': return '[INF]';
      case 'warn': return '[WRN]';
      case 'error': return '[ERR]';
      case 'success': return '[OK!]';
      default: return '[---]';
    }
  }

  /**
   * Format timestamp
   * @param {string} timestamp
   * @returns {string}
   * @private
   */
  _formatTimestamp(timestamp) {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', { hour12: false });
    } catch {
      return timestamp.slice(11, 19); // Fallback: extract time from ISO
    }
  }

  /**
   * Render the log viewer
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    // Draw title/header if present
    let contentY = y;
    let contentH = h;

    if (this.title) {
      screen.drawText(x, y, ` ${this.title} `, styles.title);
      screen.drawText(x + this.title.length + 2, y, charset.hline(w - this.title.length - 2), styles.border);
      contentY++;
      contentH--;
    }

    const entries = this.getFilteredEntries();

    // Adjust scroll offset for visible area
    const visibleCount = contentH;
    const maxScroll = Math.max(0, entries.length - visibleCount);

    if (this.autoScroll && entries.length > 0) {
      this.scrollOffset = maxScroll;
    }

    this.scrollOffset = Math.min(this.scrollOffset, maxScroll);
    this.scrollOffset = Math.max(0, this.scrollOffset);

    // Draw entries
    for (let i = 0; i < visibleCount; i++) {
      const entryIndex = this.scrollOffset + i;
      const lineY = contentY + i;

      if (entryIndex < entries.length) {
        const entry = entries[entryIndex];
        const style = this._getLevelStyle(entry.level, styles);

        // Build line
        let line = '';
        if (this.showTimestamp) {
          line += this._formatTimestamp(entry.timestamp) + ' ';
        }
        line += this._getLevelPrefix(entry.level) + ' ';
        line += entry.message;

        // Truncate and pad
        if (line.length > w) {
          line = line.slice(0, w - 1) + '~';
        } else {
          line = line.padEnd(w);
        }

        screen.drawText(x, lineY, line, style);
      } else {
        // Empty line
        screen.drawText(x, lineY, ' '.repeat(w), styles.panel);
      }
    }

    // Scroll indicator
    if (entries.length > visibleCount) {
      const scrollRatio = entries.length > visibleCount
        ? this.scrollOffset / maxScroll
        : 0;
      const indicatorPos = Math.floor(scrollRatio * (visibleCount - 1));
      screen.setCell(x + w - 1, contentY + indicatorPos, '|', styles.accent);
    }
  }
}

export default LogViewer;
