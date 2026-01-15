/**
 * @fileoverview SplitPane component for TUI
 * @module tui/components/split-pane
 */

/**
 * Split container for horizontal or vertical layouts
 */
export class SplitPane {
  /**
   * @param {Object} options
   * @param {'horizontal'|'vertical'} [options.orientation='horizontal'] - Split direction
   * @param {number} [options.ratio=0.5] - Size ratio for first pane (0-1)
   * @param {Object} [options.left] - Left/top component
   * @param {Object} [options.right] - Right/bottom component
   * @param {boolean} [options.showBorder=true] - Show separator border
   */
  constructor(options = {}) {
    this.orientation = options.orientation || 'horizontal';
    this.ratio = options.ratio || 0.5;
    this.left = options.left || null;  // Also used as 'top' for vertical
    this.right = options.right || null; // Also used as 'bottom' for vertical
    this.showBorder = options.showBorder !== false;
    this.focusSide = 'left'; // 'left' or 'right'
  }

  /**
   * Set left/top component
   * @param {Object} component
   */
  setLeft(component) {
    this.left = component;
  }

  /**
   * Set right/bottom component
   * @param {Object} component
   */
  setRight(component) {
    this.right = component;
  }

  /**
   * Focus left/top pane
   */
  focusLeft() {
    this.focusSide = 'left';
    if (this.left?.focus) this.left.focus();
    if (this.right?.blur) this.right.blur();
  }

  /**
   * Focus right/bottom pane
   */
  focusRight() {
    this.focusSide = 'right';
    if (this.right?.focus) this.right.focus();
    if (this.left?.blur) this.left.blur();
  }

  /**
   * Toggle focus between panes
   */
  toggleFocus() {
    if (this.focusSide === 'left') {
      this.focusRight();
    } else {
      this.focusLeft();
    }
  }

  /**
   * Get currently focused component
   * @returns {Object|null}
   */
  getFocusedComponent() {
    return this.focusSide === 'left' ? this.left : this.right;
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   * @returns {boolean} True if handled
   */
  onEvent(ctx, evt) {
    // Tab switches focus between panes
    if (evt.type === 'key' && evt.key === 'tab') {
      this.toggleFocus();
      return true;
    }

    // Delegate to focused component
    const focused = this.getFocusedComponent();
    if (focused?.onEvent) {
      return focused.onEvent(ctx, evt);
    }

    return false;
  }

  /**
   * Calculate pane rectangles
   * @param {Object} rect - Container rect
   * @returns {{left: Object, right: Object, separator: Object}}
   * @private
   */
  _calculateRects(rect) {
    const { x, y, w, h } = rect;
    const borderSize = this.showBorder ? 1 : 0;

    if (this.orientation === 'horizontal') {
      const leftWidth = Math.floor(w * this.ratio) - borderSize;
      const rightWidth = w - leftWidth - borderSize;

      return {
        left: { x, y, w: leftWidth, h },
        separator: { x: x + leftWidth, y, w: borderSize, h },
        right: { x: x + leftWidth + borderSize, y, w: rightWidth, h }
      };
    } else {
      // Vertical split
      const topHeight = Math.floor(h * this.ratio) - borderSize;
      const bottomHeight = h - topHeight - borderSize;

      return {
        left: { x, y, w, h: topHeight },  // 'left' is 'top' for vertical
        separator: { x, y: y + topHeight, w, h: borderSize },
        right: { x, y: y + topHeight + borderSize, w, h: bottomHeight }
      };
    }
  }

  /**
   * Render the split pane
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const rects = this._calculateRects(rect);

    // Draw separator
    if (this.showBorder) {
      if (this.orientation === 'horizontal') {
        // Vertical line separator
        for (let i = 0; i < rects.separator.h; i++) {
          screen.setCell(rects.separator.x, rects.separator.y + i, charset.get('v'), styles.border);
        }
      } else {
        // Horizontal line separator
        screen.drawText(rects.separator.x, rects.separator.y, charset.hline(rects.separator.w), styles.border);
      }
    }

    // Render left/top component
    if (this.left?.render) {
      this.left.render(ctx, rects.left);
    }

    // Render right/bottom component
    if (this.right?.render) {
      this.right.render(ctx, rects.right);
    }
  }
}

export default SplitPane;
