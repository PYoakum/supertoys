/**
 * @fileoverview ProgressBar component for TUI
 * @module tui/components/progress-bar
 */

/**
 * ASCII progress bar visualization
 */
export class ProgressBar {
  /**
   * @param {Object} options
   * @param {number} [options.value=0] - Progress value (0-1)
   * @param {string} [options.label] - Optional label
   * @param {boolean} [options.showPercent=true] - Show percentage
   * @param {string} [options.fillChar='='] - Fill character
   * @param {string} [options.emptyChar='-'] - Empty character
   * @param {string} [options.capChar='>'] - Cap character
   */
  constructor(options = {}) {
    this.value = options.value || 0;
    this.label = options.label || '';
    this.showPercent = options.showPercent !== false;
    this.fillChar = options.fillChar || '=';
    this.emptyChar = options.emptyChar || '-';
    this.capChar = options.capChar || '>';
  }

  /**
   * Set progress value
   * @param {number} value - Value between 0 and 1
   */
  setValue(value) {
    this.value = Math.max(0, Math.min(1, value));
  }

  /**
   * Set label
   * @param {string} label
   */
  setLabel(label) {
    this.label = label;
  }

  /**
   * Render the progress bar
   * @param {Object} ctx
   * @param {Object} rect - {x, y, w, h}
   */
  render(ctx, rect) {
    const { screen, styles } = ctx;
    const { x, y, w } = rect;

    // Calculate component widths
    const labelWidth = this.label ? this.label.length + 1 : 0;
    const percentWidth = this.showPercent ? 5 : 0; // " 100%"
    const barWidth = w - labelWidth - percentWidth - 2; // 2 for brackets

    if (barWidth < 3) return; // Too narrow

    // Draw label
    if (this.label) {
      screen.drawText(x, y, this.label + ' ', styles.dim);
    }

    // Calculate fill
    const fillWidth = Math.floor(this.value * (barWidth - 1));
    const emptyWidth = barWidth - fillWidth - 1;

    // Build bar string
    let bar = '[';
    bar += this.fillChar.repeat(fillWidth);
    bar += this.value < 1 ? this.capChar : this.fillChar;
    bar += this.emptyChar.repeat(Math.max(0, emptyWidth));
    bar += ']';

    // Draw bar
    const barStyle = this.value >= 1 ? styles.success : styles.accent;
    screen.drawText(x + labelWidth, y, bar, barStyle);

    // Draw percentage
    if (this.showPercent) {
      const percent = Math.floor(this.value * 100);
      const percentStr = ` ${percent.toString().padStart(3)}%`;
      screen.drawText(x + labelWidth + bar.length, y, percentStr, styles.dim);
    }
  }
}

/**
 * Create a labeled progress bar for scoring display
 * @param {Object} options
 * @param {string} options.label - Metric label
 * @param {number} options.score - Score (0-100)
 * @param {number} options.maxScore - Max score (default 100)
 * @returns {ProgressBar}
 */
export function scoreBar(options) {
  const value = options.score / (options.maxScore || 100);
  return new ProgressBar({
    label: options.label,
    value,
    showPercent: true
  });
}

export default ProgressBar;
