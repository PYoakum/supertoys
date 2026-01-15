/**
 * @fileoverview StatusBar component for TUI
 * @module tui/components/status-bar
 */

/**
 * Footer status bar with left/center/right sections
 */
export class StatusBar {
  /**
   * @param {Object} options
   * @param {string} [options.left=''] - Left section text
   * @param {string} [options.center=''] - Center section text
   * @param {string} [options.right=''] - Right section text (keyboard hints)
   */
  constructor(options = {}) {
    this.left = options.left || '';
    this.center = options.center || '';
    this.right = options.right || '';
  }

  /**
   * Set left section
   * @param {string} text
   */
  setLeft(text) {
    this.left = text;
  }

  /**
   * Set center section
   * @param {string} text
   */
  setCenter(text) {
    this.center = text;
  }

  /**
   * Set right section (keyboard hints)
   * @param {string} text
   */
  setRight(text) {
    this.right = text;
  }

  /**
   * Set all sections
   * @param {Object} sections
   */
  set({ left, center, right }) {
    if (left !== undefined) this.left = left;
    if (center !== undefined) this.center = center;
    if (right !== undefined) this.right = right;
  }

  /**
   * Render status bar
   * @param {Object} ctx
   * @param {Object} rect - {x, y, w, h}
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w } = rect;

    // Draw separator line
    screen.drawText(x, y, charset.hline(w), styles.border);

    // Draw background on second line
    screen.drawText(x, y + 1, ' '.repeat(w), styles.footer);

    // Draw left section
    if (this.left) {
      const leftText = ' ' + this.left.slice(0, Math.floor(w / 3) - 2);
      screen.drawText(x, y + 1, leftText, styles.footer);
    }

    // Draw center section
    if (this.center) {
      const centerText = this.center.slice(0, Math.floor(w / 3));
      const centerX = x + Math.floor((w - centerText.length) / 2);
      screen.drawText(centerX, y + 1, centerText, styles.footer);
    }

    // Draw right section (keyboard hints)
    if (this.right) {
      const rightText = this.right.slice(0, Math.floor(w / 3) - 1) + ' ';
      const rightX = x + w - rightText.length;
      screen.drawText(rightX, y + 1, rightText, styles.dim);
    }
  }
}

export default StatusBar;
