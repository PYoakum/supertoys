/**
 * @fileoverview Menu component for TUI
 * @module tui/components/menu
 */

/**
 * Simple menu component with keyboard navigation
 */
export class Menu {
  /**
   * @param {Object} options
   * @param {string[]} options.items - Menu items
   * @param {number} [options.selected=0] - Initially selected index
   * @param {string} [options.title] - Menu title
   */
  constructor(options) {
    this.items = options.items || [];
    this.selected = options.selected || 0;
    this.title = options.title || '';
    this.scrollOffset = 0;
  }

  /**
   * Handle key input
   * @param {string} key
   * @returns {Object|null} Action result or null
   */
  onKey(key) {
    switch (key) {
      case 'up':
        if (this.selected > 0) {
          this.selected--;
          return { action: 'move', index: this.selected };
        }
        break;

      case 'down':
        if (this.selected < this.items.length - 1) {
          this.selected++;
          return { action: 'move', index: this.selected };
        }
        break;

      case 'home':
        this.selected = 0;
        return { action: 'move', index: this.selected };

      case 'end':
        this.selected = this.items.length - 1;
        return { action: 'move', index: this.selected };

      case 'enter':
      case 'space':
        return {
          action: 'select',
          index: this.selected,
          item: this.items[this.selected]
        };

      case 'pageup':
        this.selected = Math.max(0, this.selected - 10);
        return { action: 'move', index: this.selected };

      case 'pagedown':
        this.selected = Math.min(this.items.length - 1, this.selected + 10);
        return { action: 'move', index: this.selected };
    }

    return null;
  }

  /**
   * Set items
   * @param {string[]} items
   */
  setItems(items) {
    this.items = items;
    this.selected = Math.min(this.selected, items.length - 1);
    if (this.selected < 0) this.selected = 0;
  }

  /**
   * Render menu to screen
   * @param {Object} ctx - Rendering context
   * @param {Object} rect - Bounding rectangle {x, y, w, h}
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    // Calculate visible area
    const titleHeight = this.title ? 2 : 0;
    const contentY = y + titleHeight;
    const contentH = h - titleHeight;
    const maxVisible = contentH;

    // Adjust scroll to keep selection visible
    if (this.selected < this.scrollOffset) {
      this.scrollOffset = this.selected;
    } else if (this.selected >= this.scrollOffset + maxVisible) {
      this.scrollOffset = this.selected - maxVisible + 1;
    }

    // Draw title
    if (this.title) {
      const titleText = ` ${charset.get('bullet')} ${this.title} `;
      screen.drawText(x, y, titleText, styles.title);
      // Separator line
      screen.drawText(x, y + 1, charset.hline(w), styles.dim);
    }

    // Draw items
    for (let i = 0; i < maxVisible && i + this.scrollOffset < this.items.length; i++) {
      const itemIndex = i + this.scrollOffset;
      const item = this.items[itemIndex];
      const isSelected = itemIndex === this.selected;

      const styleKey = isSelected ? styles.selected : styles.item;
      const prefix = isSelected ? `${charset.get('arrowR')} ` : '  ';
      const text = (prefix + item).slice(0, w);
      const padded = text + ' '.repeat(Math.max(0, w - text.length));

      screen.drawText(x, contentY + i, padded, styleKey);
    }

    // Show scroll indicators if needed
    if (this.scrollOffset > 0) {
      screen.drawText(x + w - 3, contentY, charset.get('arrowU'), styles.dim);
    }
    if (this.scrollOffset + maxVisible < this.items.length) {
      screen.drawText(x + w - 3, contentY + maxVisible - 1, charset.get('arrowD'), styles.dim);
    }
  }
}

export default Menu;
