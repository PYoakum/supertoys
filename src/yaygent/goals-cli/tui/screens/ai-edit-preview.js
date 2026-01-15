/**
 * @fileoverview AI Edit Preview Screen
 * @module tui/screens/ai-edit-preview
 */

/**
 * AI Edit Preview Screen
 * Shows before/after comparisons for AI-suggested edits
 */
export class AiEditPreviewScreen {
  /**
   * @param {Object} options
   * @param {Object[]} options.edits - Array of {path, before, after}
   * @param {Function} [options.onApply] - Callback when edits are applied
   * @param {Function} [options.onCancel] - Callback when cancelled
   */
  constructor(options) {
    this.edits = options.edits || [];
    this.onApplyCallback = options.onApply;
    this.onCancelCallback = options.onCancel;

    this.currentEditIndex = 0;
    this.scrollOffset = 0;
    this.selectedEdits = new Set(this.edits.map((_, i) => i)); // All selected by default
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    if (evt.type !== 'key') return;

    switch (evt.key) {
      case 'up':
        if (this.currentEditIndex > 0) {
          this.currentEditIndex--;
        }
        break;

      case 'down':
        if (this.currentEditIndex < this.edits.length - 1) {
          this.currentEditIndex++;
        }
        break;

      case 'space':
        // Toggle selection
        if (this.selectedEdits.has(this.currentEditIndex)) {
          this.selectedEdits.delete(this.currentEditIndex);
        } else {
          this.selectedEdits.add(this.currentEditIndex);
        }
        break;

      case 'a':
        // Select all
        this.edits.forEach((_, i) => this.selectedEdits.add(i));
        break;

      case 'n':
        // Select none
        this.selectedEdits.clear();
        break;

      case 'enter':
      case 'y':
        // Apply selected edits
        if (this.onApplyCallback) {
          const selected = this.edits.filter((_, i) => this.selectedEdits.has(i));
          this.onApplyCallback(selected);
        }
        break;

      case 'esc':
      case 'q':
        if (this.onCancelCallback) {
          this.onCancelCallback();
        }
        break;
    }
  }

  /**
   * Render screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    // Header
    const title = ` AI Edit Preview (${this.selectedEdits.size}/${this.edits.length} selected) `;
    screen.drawBox(x, y, w, 3, charset, styles.border, title);

    if (this.edits.length === 0) {
      screen.drawText(x + 2, y + 4, 'No edits to preview', styles.dim);
      return;
    }

    // Split view: left = list, right = diff
    const listWidth = Math.min(40, Math.floor(w * 0.35));
    const diffWidth = w - listWidth - 1;

    // Edit list (left panel)
    this._renderEditList(ctx, { x, y: y + 3, w: listWidth, h: h - 5 });

    // Separator
    for (let i = y + 3; i < h - 2; i++) {
      screen.setCell(x + listWidth, i, charset.get('v'), styles.dim);
    }

    // Diff view (right panel)
    this._renderDiff(ctx, { x: x + listWidth + 1, y: y + 3, w: diffWidth, h: h - 5 });

    // Footer
    const help = ' [Space] Toggle  [A]ll  [N]one  [Enter] Apply  [Q] Cancel ';
    screen.drawText(x, h - 1, charset.hline(w), styles.dim);
    screen.drawText(x + 2, h - 1, help, styles.footer);
  }

  /**
   * Render edit list
   * @private
   */
  _renderEditList(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const visibleCount = h;
    if (this.currentEditIndex < this.scrollOffset) {
      this.scrollOffset = this.currentEditIndex;
    } else if (this.currentEditIndex >= this.scrollOffset + visibleCount) {
      this.scrollOffset = this.currentEditIndex - visibleCount + 1;
    }

    for (let i = 0; i < visibleCount && i + this.scrollOffset < this.edits.length; i++) {
      const editIndex = i + this.scrollOffset;
      const edit = this.edits[editIndex];
      const isSelected = this.selectedEdits.has(editIndex);
      const isCurrent = editIndex === this.currentEditIndex;

      const checkMark = isSelected ? '[x]' : '[ ]';
      const pointer = isCurrent ? charset.get('arrowR') : ' ';
      const path = this._shortenPath(edit.path, w - 6);
      const text = `${pointer}${checkMark} ${path}`;

      const styleKey = isCurrent ? styles.selected : (isSelected ? styles.accent : styles.item);
      screen.drawText(x, y + i, text.slice(0, w), styleKey);
    }
  }

  /**
   * Render diff view
   * @private
   */
  _renderDiff(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const edit = this.edits[this.currentEditIndex];
    if (!edit) return;

    let row = y;

    // Path header
    screen.drawText(x, row++, ` Path: ${edit.path}`, styles.title);
    row++;

    // Before section
    screen.drawText(x, row++, ' BEFORE:', styles.error);
    screen.drawText(x, row++, charset.hline(w), styles.dim);

    const beforeLines = this._wrapText(edit.before || '(empty)', w - 2);
    for (const line of beforeLines.slice(0, Math.floor((h - 8) / 2))) {
      screen.drawText(x + 1, row++, line, styles.dim);
    }
    row++;

    // After section
    screen.drawText(x, row++, ' AFTER:', styles.success);
    screen.drawText(x, row++, charset.hline(w), styles.dim);

    const afterLines = this._wrapText(edit.after || '(empty)', w - 2);
    for (const line of afterLines.slice(0, Math.floor((h - 8) / 2))) {
      screen.drawText(x + 1, row++, line, styles.bright);
    }
  }

  /**
   * Shorten path for display
   * @private
   */
  _shortenPath(path, maxLen) {
    if (path.length <= maxLen) return path;
    const parts = path.split('.');
    if (parts.length <= 2) return path.slice(0, maxLen - 3) + '...';

    // Keep first and last parts
    const first = parts[0];
    const last = parts.slice(-2).join('.');
    const shortened = `${first}...${last}`;
    return shortened.slice(0, maxLen);
  }

  /**
   * Wrap text to width
   * @private
   */
  _wrapText(text, width) {
    if (!text) return ['(empty)'];

    const words = text.split(/\s+/);
    const lines = [];
    let line = '';

    for (const word of words) {
      if (line.length + word.length + 1 <= width) {
        line += (line ? ' ' : '') + word;
      } else {
        if (line) lines.push(line);
        line = word.slice(0, width);
      }
    }
    if (line) lines.push(line);

    return lines;
  }
}

export default AiEditPreviewScreen;
