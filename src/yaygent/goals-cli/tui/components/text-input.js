/**
 * @fileoverview TextInput component for TUI
 * @module tui/components/text-input
 */

/**
 * Single-line text input with cursor
 */
export class TextInput {
  /**
   * @param {Object} options
   * @param {string} [options.value=''] - Initial value
   * @param {string} [options.label] - Input label
   * @param {string} [options.placeholder] - Placeholder text
   * @param {number} [options.maxLength] - Maximum input length
   * @param {Function} [options.onChange] - Callback on value change
   * @param {Function} [options.onSubmit] - Callback on Enter
   * @param {Function} [options.onCancel] - Callback on Escape
   */
  constructor(options = {}) {
    this.value = options.value || '';
    this.cursor = this.value.length;
    this.label = options.label || '';
    this.placeholder = options.placeholder || '';
    this.maxLength = options.maxLength;
    this.onChange = options.onChange;
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
    this.focused = false;
    this.scrollOffset = 0; // For horizontal scrolling
  }

  /**
   * Get current value
   * @returns {string}
   */
  getValue() {
    return this.value;
  }

  /**
   * Set value
   * @param {string} value
   */
  setValue(value) {
    this.value = value;
    this.cursor = Math.min(this.cursor, value.length);
    if (this.onChange) {
      this.onChange(this.value);
    }
  }

  /**
   * Clear the input
   */
  clear() {
    this.value = '';
    this.cursor = 0;
    this.scrollOffset = 0;
    if (this.onChange) {
      this.onChange(this.value);
    }
  }

  /**
   * Focus the input
   */
  focus() {
    this.focused = true;
  }

  /**
   * Blur the input
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

    if (evt.type === 'text') {
      return this._insertText(evt.text);
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
      case 'left':
        if (this.cursor > 0) {
          this.cursor--;
          this._adjustScroll();
        }
        return true;

      case 'right':
        if (this.cursor < this.value.length) {
          this.cursor++;
          this._adjustScroll();
        }
        return true;

      case 'home':
        this.cursor = 0;
        this._adjustScroll();
        return true;

      case 'end':
        this.cursor = this.value.length;
        this._adjustScroll();
        return true;

      case 'backspace':
        if (this.cursor > 0) {
          this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
          this.cursor--;
          this._adjustScroll();
          if (this.onChange) {
            this.onChange(this.value);
          }
        }
        return true;

      case 'delete':
        if (this.cursor < this.value.length) {
          this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
          if (this.onChange) {
            this.onChange(this.value);
          }
        }
        return true;

      case 'enter':
        if (this.onSubmit) {
          this.onSubmit(this.value);
        }
        return true;

      case 'esc':
        if (this.onCancel) {
          this.onCancel();
        }
        return true;

      case 'ctrl+a':
        // Select all (move cursor to end for now)
        this.cursor = this.value.length;
        this._adjustScroll();
        return true;

      default:
        return false;
    }
  }

  /**
   * Insert text at cursor
   * @param {string} text
   * @returns {boolean}
   * @private
   */
  _insertText(text) {
    // Check max length
    if (this.maxLength && this.value.length + text.length > this.maxLength) {
      text = text.slice(0, this.maxLength - this.value.length);
      if (!text) return true; // Blocked by max length
    }

    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this._adjustScroll();

    if (this.onChange) {
      this.onChange(this.value);
    }

    return true;
  }

  /**
   * Adjust scroll offset to keep cursor visible
   * @private
   */
  _adjustScroll() {
    // This will be calculated during render based on available width
  }

  /**
   * Render the input
   * @param {Object} ctx
   * @param {Object} rect - {x, y, w, h}
   */
  render(ctx, rect) {
    const { screen, styles } = ctx;
    const { x, y, w } = rect;

    // Calculate label width
    const labelWidth = this.label ? this.label.length + 2 : 0;
    const inputStart = x + labelWidth;
    const inputWidth = w - labelWidth;

    // Draw label
    if (this.label) {
      screen.drawText(x, y, this.label + ': ', styles.dim);
    }

    // Determine what to display
    let displayValue = this.value || this.placeholder;
    const isPlaceholder = !this.value && this.placeholder;
    const valueStyle = isPlaceholder ? styles.dim : (this.focused ? styles.selected : styles.item);

    // Calculate scroll offset to keep cursor visible
    if (this.cursor < this.scrollOffset) {
      this.scrollOffset = this.cursor;
    } else if (this.cursor > this.scrollOffset + inputWidth - 1) {
      this.scrollOffset = this.cursor - inputWidth + 1;
    }

    // Apply scroll offset
    displayValue = displayValue.slice(this.scrollOffset);

    // Truncate to fit
    if (displayValue.length > inputWidth) {
      displayValue = displayValue.slice(0, inputWidth);
    } else {
      // Pad with spaces
      displayValue = displayValue.padEnd(inputWidth);
    }

    // Draw input background
    screen.drawText(inputStart, y, displayValue, valueStyle);

    // Draw cursor (if focused)
    if (this.focused && !isPlaceholder) {
      const cursorPos = this.cursor - this.scrollOffset;
      if (cursorPos >= 0 && cursorPos < inputWidth) {
        const cursorChar = this.cursor < this.value.length ? this.value[this.cursor] : ' ';
        screen.drawText(inputStart + cursorPos, y, cursorChar, styles.accent);
      }
    }
  }
}

export default TextInput;
