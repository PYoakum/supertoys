/**
 * @fileoverview TextArea component for TUI
 * @module tui/components/text-area
 */

/**
 * Multi-line text editor
 */
export class TextArea {
  /**
   * @param {Object} options
   * @param {string} [options.value=''] - Initial value
   * @param {boolean} [options.readOnly=false] - Read-only mode
   * @param {boolean} [options.wrap=true] - Word wrap
   * @param {Function} [options.onChange] - Change callback
   */
  constructor(options = {}) {
    this.lines = (options.value || '').split('\n');
    this.readOnly = options.readOnly || false;
    this.wrap = options.wrap !== false;
    this.onChange = options.onChange;

    this.cursorLine = 0;
    this.cursorCol = 0;
    this.scrollY = 0;
    this.scrollX = 0;
    this.focused = false;
  }

  /**
   * Get full text value
   * @returns {string}
   */
  getValue() {
    return this.lines.join('\n');
  }

  /**
   * Set text value
   * @param {string} value
   */
  setValue(value) {
    this.lines = (value || '').split('\n');
    this.cursorLine = Math.min(this.cursorLine, this.lines.length - 1);
    this.cursorCol = Math.min(this.cursorCol, this._currentLineLength());
  }

  /**
   * Get current line
   * @returns {string}
   * @private
   */
  _currentLine() {
    return this.lines[this.cursorLine] || '';
  }

  /**
   * Get current line length
   * @returns {number}
   * @private
   */
  _currentLineLength() {
    return this._currentLine().length;
  }

  /**
   * Focus the text area
   */
  focus() {
    this.focused = true;
  }

  /**
   * Blur the text area
   */
  blur() {
    this.focused = false;
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   * @returns {boolean} True if handled
   */
  onEvent(ctx, evt) {
    if (!this.focused) return false;

    if (evt.type === 'key') {
      return this._handleKey(evt.key);
    }

    if (evt.type === 'text' && !this.readOnly) {
      return this._insertChar(evt.text);
    }

    return false;
  }

  /**
   * Handle key event
   * @param {string} key
   * @returns {boolean}
   * @private
   */
  _handleKey(key) {
    switch (key) {
      case 'up':
        if (this.cursorLine > 0) {
          this.cursorLine--;
          this.cursorCol = Math.min(this.cursorCol, this._currentLineLength());
          this._adjustScrollY();
        }
        return true;

      case 'down':
        if (this.cursorLine < this.lines.length - 1) {
          this.cursorLine++;
          this.cursorCol = Math.min(this.cursorCol, this._currentLineLength());
          this._adjustScrollY();
        }
        return true;

      case 'left':
        if (this.cursorCol > 0) {
          this.cursorCol--;
        } else if (this.cursorLine > 0) {
          this.cursorLine--;
          this.cursorCol = this._currentLineLength();
        }
        this._adjustScrollY();
        return true;

      case 'right':
        if (this.cursorCol < this._currentLineLength()) {
          this.cursorCol++;
        } else if (this.cursorLine < this.lines.length - 1) {
          this.cursorLine++;
          this.cursorCol = 0;
        }
        this._adjustScrollY();
        return true;

      case 'home':
        this.cursorCol = 0;
        return true;

      case 'end':
        this.cursorCol = this._currentLineLength();
        return true;

      case 'pageup':
        this.cursorLine = Math.max(0, this.cursorLine - 10);
        this.cursorCol = Math.min(this.cursorCol, this._currentLineLength());
        this._adjustScrollY();
        return true;

      case 'pagedown':
        this.cursorLine = Math.min(this.lines.length - 1, this.cursorLine + 10);
        this.cursorCol = Math.min(this.cursorCol, this._currentLineLength());
        this._adjustScrollY();
        return true;

      case 'backspace':
        if (this.readOnly) return true;
        if (this.cursorCol > 0) {
          const line = this._currentLine();
          this.lines[this.cursorLine] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
          this.cursorCol--;
        } else if (this.cursorLine > 0) {
          // Join with previous line
          const prevLine = this.lines[this.cursorLine - 1];
          const currLine = this._currentLine();
          this.lines[this.cursorLine - 1] = prevLine + currLine;
          this.lines.splice(this.cursorLine, 1);
          this.cursorLine--;
          this.cursorCol = prevLine.length;
        }
        this._notifyChange();
        return true;

      case 'delete':
        if (this.readOnly) return true;
        const line = this._currentLine();
        if (this.cursorCol < line.length) {
          this.lines[this.cursorLine] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1);
        } else if (this.cursorLine < this.lines.length - 1) {
          // Join with next line
          this.lines[this.cursorLine] = line + this.lines[this.cursorLine + 1];
          this.lines.splice(this.cursorLine + 1, 1);
        }
        this._notifyChange();
        return true;

      case 'enter':
        if (this.readOnly) return true;
        const currentLine = this._currentLine();
        const beforeCursor = currentLine.slice(0, this.cursorCol);
        const afterCursor = currentLine.slice(this.cursorCol);
        this.lines[this.cursorLine] = beforeCursor;
        this.lines.splice(this.cursorLine + 1, 0, afterCursor);
        this.cursorLine++;
        this.cursorCol = 0;
        this._adjustScrollY();
        this._notifyChange();
        return true;

      default:
        return false;
    }
  }

  /**
   * Insert character at cursor
   * @param {string} char
   * @returns {boolean}
   * @private
   */
  _insertChar(char) {
    if (this.readOnly) return true;

    const line = this._currentLine();
    this.lines[this.cursorLine] = line.slice(0, this.cursorCol) + char + line.slice(this.cursorCol);
    this.cursorCol += char.length;
    this._notifyChange();
    return true;
  }

  /**
   * Adjust vertical scroll
   * @private
   */
  _adjustScrollY() {
    // Will be calculated in render based on visible height
  }

  /**
   * Notify change
   * @private
   */
  _notifyChange() {
    if (this.onChange) {
      this.onChange(this.getValue());
    }
  }

  /**
   * Render the text area
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    const { screen, styles } = ctx;
    const { x, y, w, h } = rect;

    // Adjust scroll to keep cursor visible
    if (this.cursorLine < this.scrollY) {
      this.scrollY = this.cursorLine;
    } else if (this.cursorLine >= this.scrollY + h) {
      this.scrollY = this.cursorLine - h + 1;
    }

    // Draw visible lines
    for (let i = 0; i < h; i++) {
      const lineIndex = this.scrollY + i;
      const lineY = y + i;

      if (lineIndex < this.lines.length) {
        let lineText = this.lines[lineIndex];

        // Handle horizontal scroll if no wrap
        if (!this.wrap) {
          lineText = lineText.slice(this.scrollX);
        }

        // Truncate to width
        if (lineText.length > w) {
          lineText = lineText.slice(0, w);
        } else {
          lineText = lineText.padEnd(w);
        }

        const style = this.focused ? styles.item : styles.dim;
        screen.drawText(x, lineY, lineText, style);

        // Draw cursor
        if (this.focused && lineIndex === this.cursorLine) {
          const cursorX = this.cursorCol - (this.wrap ? 0 : this.scrollX);
          if (cursorX >= 0 && cursorX < w) {
            const cursorChar = this.cursorCol < this.lines[lineIndex].length
              ? this.lines[lineIndex][this.cursorCol]
              : ' ';
            screen.drawText(x + cursorX, lineY, cursorChar, styles.accent);
          }
        }
      } else {
        // Empty line
        screen.drawText(x, lineY, ' '.repeat(w), styles.panel);
      }
    }

    // Scroll indicator
    if (this.lines.length > h) {
      const scrollPos = Math.floor((this.scrollY / (this.lines.length - h)) * (h - 1));
      screen.setCell(x + w - 1, y + scrollPos, '|', styles.dim);
    }
  }
}

export default TextArea;
