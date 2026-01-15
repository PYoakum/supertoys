/**
 * @fileoverview Goals Browser Screen
 * @module tui/screens/goals-browser
 */

import { Menu } from '../components/menu.js';

/**
 * Goals Browser Screen
 * Displays goals from a loaded file with navigation
 */
export class GoalsBrowserScreen {
  /**
   * @param {Object} options
   * @param {Object} options.goals - Goals data {version, goals: [], metadata}
   * @param {Function} [options.onSelect] - Callback when goal is selected
   * @param {Function} [options.onBack] - Callback for back/escape
   */
  constructor(options) {
    this.goals = options.goals || { goals: [] };
    this.onSelectCallback = options.onSelect;
    this.onBackCallback = options.onBack;

    this.selectedGoalIndex = 0;
    this.viewMode = 'list';  // 'list' or 'detail'

    // Build menu items from goals
    this.menu = new Menu({
      title: this._getTitle(),
      items: this._buildMenuItems(),
      selected: 0
    });
  }

  /**
   * Get screen title
   * @returns {string}
   * @private
   */
  _getTitle() {
    const name = this.goals.metadata?.name || 'Goals';
    const count = this.goals.goals?.length || 0;
    return `${name} (${count} goals)`;
  }

  /**
   * Build menu items from goals
   * @returns {string[]}
   * @private
   */
  _buildMenuItems() {
    if (!this.goals.goals || this.goals.goals.length === 0) {
      return ['(No goals loaded)'];
    }

    return this.goals.goals.map((goal, i) => {
      const priority = goal.priority ? `[P${goal.priority}]` : '';
      const id = goal.id || `goal-${i}`;
      const obj = goal.objective?.slice(0, 50) || '(no objective)';
      return `${priority} ${id}: ${obj}`;
    });
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    if (evt.type !== 'key') return;

    if (this.viewMode === 'list') {
      this._handleListEvent(ctx, evt);
    } else {
      this._handleDetailEvent(ctx, evt);
    }
  }

  /**
   * Handle list view events
   * @private
   */
  _handleListEvent(ctx, evt) {
    const result = this.menu.onKey(evt.key);

    if (result?.action === 'select') {
      this.selectedGoalIndex = result.index;
      this.viewMode = 'detail';
      if (this.onSelectCallback) {
        this.onSelectCallback(this.goals.goals[result.index], result.index);
      }
    }

    if (evt.key === 'esc' || evt.key === 'q') {
      if (this.onBackCallback) {
        this.onBackCallback();
      }
    }
  }

  /**
   * Handle detail view events
   * @private
   */
  _handleDetailEvent(ctx, evt) {
    if (evt.key === 'esc' || evt.key === 'backspace' || evt.key === 'q') {
      this.viewMode = 'list';
    }

    if (evt.key === 'left') {
      if (this.selectedGoalIndex > 0) {
        this.selectedGoalIndex--;
      }
    }

    if (evt.key === 'right') {
      if (this.selectedGoalIndex < this.goals.goals.length - 1) {
        this.selectedGoalIndex++;
      }
    }
  }

  /**
   * Render screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    if (this.viewMode === 'list') {
      this._renderList(ctx, rect);
    } else {
      this._renderDetail(ctx, rect);
    }
  }

  /**
   * Render list view
   * @private
   */
  _renderList(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    // Draw box around menu
    screen.drawBox(x, y, w, h - 2, charset, styles.border, this._getTitle());

    // Menu area (inside box)
    const menuRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 4 };
    this.menu.title = '';  // Title is in box
    this.menu.render(ctx, menuRect);

    // Footer help
    const help = ' [Enter] View  [Q] Quit ';
    screen.drawText(x, h - 1, charset.hline(w), styles.dim);
    screen.drawText(x + 2, h - 1, help, styles.footer);
  }

  /**
   * Render detail view
   * @private
   */
  _renderDetail(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const goal = this.goals.goals[this.selectedGoalIndex];
    if (!goal) return;

    // Header
    const title = ` Goal ${this.selectedGoalIndex + 1}/${this.goals.goals.length}: ${goal.id} `;
    screen.drawBox(x, y, w, 3, charset, styles.border, title);

    let row = y + 3;

    // Objective
    screen.drawText(x, row++, ' Objective:', styles.title);
    const objLines = this._wrapText(goal.objective || '(none)', w - 4);
    for (const line of objLines) {
      screen.drawText(x + 2, row++, line, styles.item);
    }
    row++;

    // Priority & Dependencies
    if (goal.priority) {
      screen.drawText(x, row++, ` Priority: ${goal.priority}`, styles.accent);
    }
    if (goal.dependencies?.length > 0) {
      screen.drawText(x, row++, ` Dependencies: ${goal.dependencies.join(', ')}`, styles.dim);
    }
    row++;

    // Constraints
    if (goal.constraints?.length > 0) {
      screen.drawText(x, row++, ' Constraints:', styles.title);
      for (const c of goal.constraints) {
        screen.drawText(x + 2, row++, `${charset.get('bullet')} ${c.slice(0, w - 6)}`, styles.item);
      }
      row++;
    }

    // Success Criteria
    if (goal.criteria?.success?.length > 0) {
      screen.drawText(x, row++, ' Success Criteria:', styles.title);
      for (const c of goal.criteria.success) {
        screen.drawText(x + 2, row++, `${charset.get('check')} ${c.slice(0, w - 6)}`, styles.success);
      }
      row++;
    }

    // Acceptance Criteria
    if (goal.criteria?.acceptance?.length > 0) {
      screen.drawText(x, row++, ' Acceptance Criteria:', styles.title);
      for (const c of goal.criteria.acceptance) {
        screen.drawText(x + 2, row++, `${charset.get('bullet')} ${c.slice(0, w - 6)}`, styles.item);
      }
    }

    // Footer
    const nav = this.selectedGoalIndex > 0 ? '[<] Prev ' : '';
    const nav2 = this.selectedGoalIndex < this.goals.goals.length - 1 ? '[>] Next ' : '';
    const help = ` ${nav}${nav2}[Esc] Back `;
    screen.drawText(x, h - 1, charset.hline(w), styles.dim);
    screen.drawText(x + 2, h - 1, help, styles.footer);
  }

  /**
   * Wrap text to width
   * @param {string} text
   * @param {number} width
   * @returns {string[]}
   * @private
   */
  _wrapText(text, width) {
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

    return lines.slice(0, 10);  // Max 10 lines
  }
}

export default GoalsBrowserScreen;
