/**
 * @fileoverview TabBar component for TUI
 * @module tui/components/tab-bar
 */

/**
 * Horizontal tab bar with keyboard navigation
 */
export class TabBar {
  /**
   * @param {Object} options
   * @param {Array<{id: string, label: string, shortcut: string}>} options.tabs - Tab definitions
   * @param {number} [options.active=0] - Initially active tab index
   * @param {Function} [options.onTabChange] - Callback when tab changes
   */
  constructor(options) {
    this.tabs = options.tabs || [];
    this.activeIndex = options.active || 0;
    this.onTabChange = options.onTabChange;
  }

  /**
   * Get active tab
   * @returns {Object|null}
   */
  getActiveTab() {
    return this.tabs[this.activeIndex] || null;
  }

  /**
   * Set active tab by index
   * @param {number} index
   */
  setActive(index) {
    if (index >= 0 && index < this.tabs.length && index !== this.activeIndex) {
      this.activeIndex = index;
      if (this.onTabChange) {
        this.onTabChange(index, this.tabs[index]);
      }
    }
  }

  /**
   * Set active tab by id
   * @param {string} id
   */
  setActiveById(id) {
    const index = this.tabs.findIndex(t => t.id === id);
    if (index !== -1) {
      this.setActive(index);
    }
  }

  /**
   * Move to next tab
   */
  next() {
    this.setActive((this.activeIndex + 1) % this.tabs.length);
  }

  /**
   * Move to previous tab
   */
  prev() {
    this.setActive((this.activeIndex - 1 + this.tabs.length) % this.tabs.length);
  }

  /**
   * Handle key input
   * @param {string} key
   * @returns {boolean} True if handled
   */
  onKey(key) {
    // Tab cycling
    if (key === 'tab') {
      this.next();
      return true;
    }
    if (key === 'shift+tab') {
      this.prev();
      return true;
    }

    // Number key shortcuts (1-9)
    const num = parseInt(key, 10);
    if (!isNaN(num) && num >= 1 && num <= this.tabs.length) {
      this.setActive(num - 1);
      return true;
    }

    // Check for shortcut match
    const tab = this.tabs.find(t => t.shortcut === key);
    if (tab) {
      this.setActiveById(tab.id);
      return true;
    }

    return false;
  }

  /**
   * Handle text event (for number keys)
   * @param {string} text
   * @returns {boolean} True if handled
   */
  onText(text) {
    const num = parseInt(text, 10);
    if (!isNaN(num) && num >= 1 && num <= this.tabs.length) {
      this.setActive(num - 1);
      return true;
    }
    return false;
  }

  /**
   * Render tab bar
   * @param {Object} ctx - Rendering context
   * @param {Object} rect - Bounding rectangle {x, y, w, h}
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w } = rect;

    // Draw background line
    screen.drawText(x, y, ' '.repeat(w), styles.header);

    // Calculate tab widths
    let currentX = x + 1;

    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const isActive = i === this.activeIndex;
      const style = isActive ? styles.selected : styles.header;

      // Format: [1:Label]
      const label = `[${tab.shortcut}:${tab.label}]`;

      if (currentX + label.length < x + w) {
        screen.drawText(currentX, y, label, style);
        currentX += label.length + 1;
      }
    }

    // Draw separator line below tabs
    screen.drawText(x, y + 1, charset.hline(w), styles.border);
  }
}

export default TabBar;
