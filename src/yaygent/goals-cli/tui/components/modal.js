/**
 * @fileoverview Modal component for TUI
 * @module tui/components/modal
 */

/**
 * Modal dialog overlay
 */
export class Modal {
  /**
   * @param {Object} options
   * @param {string} options.title - Modal title
   * @param {string|string[]} [options.content] - Content text or lines
   * @param {Array<{label: string, action: Function, isDefault?: boolean}>} [options.buttons] - Action buttons
   * @param {Function} [options.onClose] - Close callback
   * @param {number} [options.width] - Fixed width (auto if not set)
   * @param {number} [options.height] - Fixed height (auto if not set)
   */
  constructor(options) {
    this.title = options.title || '';
    this.content = options.content || '';
    this.buttons = options.buttons || [
      { label: 'OK', action: () => this.close(), isDefault: true }
    ];
    this.onClose = options.onClose;
    this.fixedWidth = options.width;
    this.fixedHeight = options.height;
    this.selectedButton = this.buttons.findIndex(b => b.isDefault) || 0;
    this.visible = true;

    // Convert content to lines
    if (typeof this.content === 'string') {
      this.contentLines = this.content.split('\n');
    } else {
      this.contentLines = this.content;
    }
  }

  /**
   * Show the modal
   */
  show() {
    this.visible = true;
  }

  /**
   * Hide the modal
   */
  hide() {
    this.visible = false;
  }

  /**
   * Close the modal
   */
  close() {
    this.visible = false;
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   * @returns {boolean} True if handled
   */
  onEvent(ctx, evt) {
    if (!this.visible) return false;

    if (evt.type === 'key') {
      switch (evt.key) {
        case 'left':
          if (this.selectedButton > 0) {
            this.selectedButton--;
          }
          return true;

        case 'right':
          if (this.selectedButton < this.buttons.length - 1) {
            this.selectedButton++;
          }
          return true;

        case 'tab':
          this.selectedButton = (this.selectedButton + 1) % this.buttons.length;
          return true;

        case 'shift+tab':
          this.selectedButton = (this.selectedButton - 1 + this.buttons.length) % this.buttons.length;
          return true;

        case 'enter':
        case 'space':
          const button = this.buttons[this.selectedButton];
          if (button && button.action) {
            button.action();
          }
          return true;

        case 'esc':
          this.close();
          return true;
      }
    }

    return true; // Modal captures all events while visible
  }

  /**
   * Render the modal
   * @param {Object} ctx
   * @param {Object} rect - Full screen rect
   */
  render(ctx, rect) {
    if (!this.visible) return;

    const { screen, styles, charset } = ctx;
    const { w: screenW, h: screenH } = rect;

    // Calculate modal dimensions
    const contentWidth = Math.max(
      this.title.length + 4,
      ...this.contentLines.map(l => l.length + 4),
      this.buttons.reduce((sum, b) => sum + b.label.length + 4, 0) + 2
    );
    const modalW = this.fixedWidth || Math.min(contentWidth, screenW - 4);
    const modalH = this.fixedHeight || Math.min(this.contentLines.length + 6, screenH - 4);

    // Center the modal
    const modalX = Math.floor((screenW - modalW) / 2);
    const modalY = Math.floor((screenH - modalH) / 2);

    // Draw shadow (dim the background slightly)
    for (let y = modalY + 1; y < modalY + modalH + 1 && y < screenH; y++) {
      for (let x = modalX + 2; x < modalX + modalW + 2 && x < screenW; x++) {
        screen.setCell(x, y, ' ', styles.dim);
      }
    }

    // Draw modal box
    screen.drawBox(modalX, modalY, modalW, modalH, charset, styles.borderActive, this.title);

    // Fill interior
    for (let y = modalY + 1; y < modalY + modalH - 1; y++) {
      screen.drawText(modalX + 1, y, ' '.repeat(modalW - 2), styles.panel);
    }

    // Draw content
    const contentStartY = modalY + 2;
    const maxContentLines = modalH - 5; // Leave room for buttons
    for (let i = 0; i < Math.min(this.contentLines.length, maxContentLines); i++) {
      const line = this.contentLines[i].slice(0, modalW - 4);
      screen.drawText(modalX + 2, contentStartY + i, line, styles.item);
    }

    // Draw buttons at bottom
    const buttonY = modalY + modalH - 2;
    let buttonX = modalX + 2;

    for (let i = 0; i < this.buttons.length; i++) {
      const button = this.buttons[i];
      const isSelected = i === this.selectedButton;
      const style = isSelected ? styles.selected : styles.item;
      const label = `[${button.label}]`;

      screen.drawText(buttonX, buttonY, label, style);
      buttonX += label.length + 2;
    }
  }
}

/**
 * Create a confirmation modal
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {Function} options.onConfirm
 * @param {Function} [options.onCancel]
 * @returns {Modal}
 */
export function confirmModal(options) {
  return new Modal({
    title: options.title,
    content: options.message,
    buttons: [
      {
        label: 'Yes',
        action: () => {
          if (options.onConfirm) options.onConfirm();
        },
        isDefault: true
      },
      {
        label: 'No',
        action: () => {
          if (options.onCancel) options.onCancel();
        }
      }
    ]
  });
}

/**
 * Create an alert modal
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {Function} [options.onClose]
 * @returns {Modal}
 */
export function alertModal(options) {
  return new Modal({
    title: options.title,
    content: options.message,
    buttons: [
      {
        label: 'OK',
        action: () => {
          if (options.onClose) options.onClose();
        },
        isDefault: true
      }
    ]
  });
}

export default Modal;
