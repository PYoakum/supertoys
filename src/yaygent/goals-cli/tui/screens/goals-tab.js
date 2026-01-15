/**
 * @fileoverview Goals Tab Screen
 * @module tui/screens/goals-tab
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { Menu } from '../components/menu.js';
import { TextInput } from '../components/text-input.js';
import { TextArea } from '../components/text-area.js';
import { Modal } from '../components/modal.js';

/**
 * Goals Tab Screen - Edit goals with form or JSON
 */
export class GoalsTabScreen {
  /**
   * @param {Object} options
   * @param {Object} [options.state] - Shared state reference
   * @param {Function} [options.onStateChange] - State change callback
   */
  constructor(options = {}) {
    this.state = options.state || {};
    this.onStateChange = options.onStateChange;

    // Mode: 'list' | 'edit-form' | 'edit-json' | 'add' | 'rename'
    this.mode = 'list';

    // Goals data
    this.goals = null;
    this.goalsPath = this.state.goalsPath || './goals.json';

    // Components
    this.goalsList = new Menu({ title: 'Goals', items: [] });
    this.editingGoalIndex = -1;
    this.editingGoal = null;

    // Form fields for editing
    this.formFields = {
      id: new TextInput({ label: 'ID', placeholder: 'goal-id' }),
      objective: new TextArea({ value: '' }),
      priority: new TextInput({ label: 'Priority', placeholder: '1-10' }),
      constraints: new TextArea({ value: '' }),
      successCriteria: new TextArea({ value: '' }),
      acceptanceCriteria: new TextArea({ value: '' }),
      dependencies: new TextInput({ label: 'Dependencies', placeholder: 'id1, id2' })
    };
    this.focusedField = 'id';
    this.formFieldOrder = ['id', 'objective', 'priority', 'constraints', 'successCriteria', 'acceptanceCriteria', 'dependencies'];

    // JSON editor
    this.jsonEditor = new TextArea({ value: '' });

    // Rename input
    this.renameInput = new TextInput({ label: 'New filename', placeholder: 'goals.json' });

    // Modal for confirmations
    this.modal = null;

    // Focus state
    this.focused = false;
  }

  /**
   * Set shared state reference
   * @param {Object} state
   */
  setState(state) {
    this.state = state;
    this.goalsPath = state.goalsPath || this.goalsPath;
  }

  /**
   * Focus the screen
   */
  focus() {
    this.focused = true;
    if (this.mode === 'list') {
      // Load goals if not loaded
      if (!this.goals) {
        this._loadGoals();
      }
    }
  }

  /**
   * Blur the screen
   */
  blur() {
    this.focused = false;
  }

  /**
   * Get help text for status bar
   * @returns {string}
   */
  getHelpText() {
    switch (this.mode) {
      case 'list':
        return '[Enter] Edit  [A] Add  [J] JSON  [R] Rename  [D] Delete';
      case 'edit-form':
        return '[Tab] Next  [Ctrl+S] Save  [Esc] Cancel';
      case 'edit-json':
        return '[Ctrl+S] Save  [Esc] Cancel';
      case 'add':
        return '[Tab] Next  [Ctrl+S] Save  [Esc] Cancel';
      case 'rename':
        return '[Enter] Save  [Esc] Cancel';
      default:
        return '';
    }
  }

  /**
   * Load goals from file
   * @private
   */
  async _loadGoals() {
    try {
      const absPath = resolve(this.goalsPath);

      if (!existsSync(absPath)) {
        // Auto-create empty file
        this.goals = {
          version: '1.0',
          goals: [],
          metadata: {
            name: 'New Goals',
            createdAt: new Date().toISOString()
          }
        };
        await this._saveGoals();
      } else {
        const content = await readFile(absPath, 'utf-8');
        this.goals = JSON.parse(content);
      }

      this._updateGoalsList();

      // Update shared state
      if (this.state) {
        this.state.goals = this.goals;
      }
    } catch (err) {
      this.goals = { version: '1.0', goals: [], metadata: {} };
      this._updateGoalsList();
    }
  }

  /**
   * Save goals to file
   * @private
   */
  async _saveGoals() {
    try {
      const absPath = resolve(this.goalsPath);

      // Update metadata
      if (!this.goals.metadata) {
        this.goals.metadata = {};
      }
      this.goals.metadata.updatedAt = new Date().toISOString();

      await writeFile(absPath, JSON.stringify(this.goals, null, 2), 'utf-8');

      // Update shared state
      if (this.state) {
        this.state.goals = this.goals;
        this.state.dirty = false;
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Update goals list menu
   * @private
   */
  _updateGoalsList() {
    if (!this.goals?.goals) {
      this.goalsList.setItems(['(No goals file loaded)']);
      return;
    }

    if (this.goals.goals.length === 0) {
      this.goalsList.setItems(['(No goals - press A to add)']);
      return;
    }

    const items = this.goals.goals.map((goal, i) => {
      const priority = goal.priority ? `[P${goal.priority}]` : '';
      const id = goal.id || `goal-${i}`;
      const obj = (goal.objective || '(no objective)').slice(0, 40);
      return `${priority} ${id}: ${obj}`;
    });

    this.goalsList.setItems(items);
  }

  /**
   * Start editing a goal in form mode
   * @param {number} index
   * @private
   */
  _startFormEdit(index) {
    const goal = this.goals.goals[index];
    if (!goal) return;

    this.editingGoalIndex = index;
    this.editingGoal = { ...goal };
    this.mode = 'edit-form';

    // Populate form fields
    this.formFields.id.setValue(goal.id || '');
    this.formFields.objective.setValue(goal.objective || '');
    this.formFields.priority.setValue(goal.priority?.toString() || '');
    this.formFields.constraints.setValue((goal.constraints || []).join('\n'));
    this.formFields.successCriteria.setValue((goal.criteria?.success || []).join('\n'));
    this.formFields.acceptanceCriteria.setValue((goal.criteria?.acceptance || []).join('\n'));
    this.formFields.dependencies.setValue((goal.dependencies || []).join(', '));

    this.focusedField = 'id';
    this.formFields.id.focus();
  }

  /**
   * Start editing in JSON mode
   * @private
   */
  _startJsonEdit() {
    this.mode = 'edit-json';
    this.jsonEditor.setValue(JSON.stringify(this.goals, null, 2));
    this.jsonEditor.focus();
  }

  /**
   * Start adding a new goal
   * @private
   */
  _startAdd() {
    this.editingGoalIndex = -1;
    this.editingGoal = {
      id: `goal-${this.goals.goals.length + 1}`,
      objective: '',
      priority: 5
    };
    this.mode = 'add';

    // Clear form fields
    this.formFields.id.setValue(this.editingGoal.id);
    this.formFields.objective.setValue('');
    this.formFields.priority.setValue('5');
    this.formFields.constraints.setValue('');
    this.formFields.successCriteria.setValue('');
    this.formFields.acceptanceCriteria.setValue('');
    this.formFields.dependencies.setValue('');

    this.focusedField = 'id';
    this.formFields.id.focus();
  }

  /**
   * Save form edits
   * @private
   */
  async _saveFormEdit() {
    // Build goal from form
    const goal = {
      id: this.formFields.id.getValue().trim() || `goal-${Date.now()}`,
      objective: this.formFields.objective.getValue().trim(),
      priority: parseInt(this.formFields.priority.getValue()) || 5
    };

    // Parse constraints
    const constraints = this.formFields.constraints.getValue().split('\n').filter(c => c.trim());
    if (constraints.length > 0) {
      goal.constraints = constraints;
    }

    // Parse criteria
    const success = this.formFields.successCriteria.getValue().split('\n').filter(c => c.trim());
    const acceptance = this.formFields.acceptanceCriteria.getValue().split('\n').filter(c => c.trim());
    if (success.length > 0 || acceptance.length > 0) {
      goal.criteria = {};
      if (success.length > 0) goal.criteria.success = success;
      if (acceptance.length > 0) goal.criteria.acceptance = acceptance;
    }

    // Parse dependencies
    const deps = this.formFields.dependencies.getValue().split(',').map(d => d.trim()).filter(d => d);
    if (deps.length > 0) {
      goal.dependencies = deps;
    }

    // Update or add
    if (this.mode === 'add') {
      this.goals.goals.push(goal);
    } else {
      this.goals.goals[this.editingGoalIndex] = goal;
    }

    // Save and return to list
    await this._saveGoals();
    this._updateGoalsList();
    this.mode = 'list';
    this.editingGoalIndex = -1;
  }

  /**
   * Save JSON edits
   * @private
   */
  async _saveJsonEdit() {
    try {
      const newGoals = JSON.parse(this.jsonEditor.getValue());
      this.goals = newGoals;
      await this._saveGoals();
      this._updateGoalsList();
      this.mode = 'list';
      return true;
    } catch (err) {
      // Invalid JSON - stay in edit mode
      return false;
    }
  }

  /**
   * Delete a goal
   * @param {number} index
   * @private
   */
  async _deleteGoal(index) {
    if (index >= 0 && index < this.goals.goals.length) {
      this.goals.goals.splice(index, 1);
      await this._saveGoals();
      this._updateGoalsList();
    }
  }

  /**
   * Rename the goals file
   * @param {string} newName
   * @private
   */
  async _renameFile(newName) {
    const dir = dirname(this.goalsPath);
    const newPath = resolve(dir, newName);

    try {
      // Save to new path
      const oldPath = this.goalsPath;
      this.goalsPath = newPath;
      await this._saveGoals();

      // Update state
      if (this.state) {
        this.state.goalsPath = this.goalsPath;
      }

      this.mode = 'list';
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    // Modal takes priority
    if (this.modal?.visible) {
      this.modal.onEvent(ctx, evt);
      return;
    }

    switch (this.mode) {
      case 'list':
        this._handleListEvent(ctx, evt);
        break;
      case 'edit-form':
      case 'add':
        this._handleFormEvent(ctx, evt);
        break;
      case 'edit-json':
        this._handleJsonEvent(ctx, evt);
        break;
      case 'rename':
        this._handleRenameEvent(ctx, evt);
        break;
    }
  }

  /**
   * Handle list mode events
   * @private
   */
  _handleListEvent(ctx, evt) {
    if (evt.type === 'key') {
      // Menu navigation
      const result = this.goalsList.onKey(evt.key);
      if (result?.action === 'select') {
        if (this.goals?.goals?.length > 0) {
          this._startFormEdit(result.index);
        }
        return;
      }

      // Other keys
      switch (evt.key) {
        case 'enter':
          if (this.goals?.goals?.length > 0) {
            this._startFormEdit(this.goalsList.selected);
          }
          break;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'a':
          this._startAdd();
          break;
        case 'j':
          this._startJsonEdit();
          break;
        case 'r':
          this.mode = 'rename';
          this.renameInput.setValue(basename(this.goalsPath));
          this.renameInput.focus();
          break;
        case 'd':
          if (this.goals?.goals?.length > 0) {
            const index = this.goalsList.selected;
            const goal = this.goals.goals[index];
            this.modal = new Modal({
              title: 'Delete Goal',
              content: `Delete goal "${goal.id}"?`,
              buttons: [
                { label: 'Yes', action: () => { this._deleteGoal(index); this.modal = null; } },
                { label: 'No', action: () => { this.modal = null; }, isDefault: true }
              ]
            });
          }
          break;
      }
    }
  }

  /**
   * Handle form mode events
   * @private
   */
  _handleFormEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'tab':
          this._nextFormField();
          return;
        case 'shift+tab':
          this._prevFormField();
          return;
        case 'ctrl+s':
          this._saveFormEdit();
          return;
        case 'esc':
          this.mode = 'list';
          return;
      }
    }

    // Delegate to focused field
    const field = this.formFields[this.focusedField];
    if (field?.onEvent) {
      field.onEvent(ctx, evt);
    }
  }

  /**
   * Move to next form field
   * @private
   */
  _nextFormField() {
    const current = this.formFieldOrder.indexOf(this.focusedField);
    const next = (current + 1) % this.formFieldOrder.length;
    this._focusField(this.formFieldOrder[next]);
  }

  /**
   * Move to previous form field
   * @private
   */
  _prevFormField() {
    const current = this.formFieldOrder.indexOf(this.focusedField);
    const prev = (current - 1 + this.formFieldOrder.length) % this.formFieldOrder.length;
    this._focusField(this.formFieldOrder[prev]);
  }

  /**
   * Focus a specific field
   * @param {string} fieldName
   * @private
   */
  _focusField(fieldName) {
    // Blur current
    const current = this.formFields[this.focusedField];
    if (current?.blur) current.blur();

    // Focus new
    this.focusedField = fieldName;
    const next = this.formFields[fieldName];
    if (next?.focus) next.focus();
  }

  /**
   * Handle JSON edit mode events
   * @private
   */
  _handleJsonEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'ctrl+s':
          this._saveJsonEdit();
          return;
        case 'esc':
          this.mode = 'list';
          return;
      }
    }

    this.jsonEditor.onEvent(ctx, evt);
  }

  /**
   * Handle rename mode events
   * @private
   */
  _handleRenameEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'enter':
          this._renameFile(this.renameInput.getValue());
          return;
        case 'esc':
          this.mode = 'list';
          return;
      }
    }

    this.renameInput.onEvent(ctx, evt);
  }

  /**
   * Render the screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    const { screen, styles, charset } = ctx;

    switch (this.mode) {
      case 'list':
        this._renderList(ctx, rect);
        break;
      case 'edit-form':
      case 'add':
        this._renderForm(ctx, rect);
        break;
      case 'edit-json':
        this._renderJson(ctx, rect);
        break;
      case 'rename':
        this._renderRename(ctx, rect);
        break;
    }

    // Render modal if visible
    if (this.modal?.visible) {
      this.modal.render(ctx, rect);
    }
  }

  /**
   * Render list mode
   * @private
   */
  _renderList(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    // Title
    const title = ` Goals: ${basename(this.goalsPath)} `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    // Menu inside box
    const menuRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    this.goalsList.render(ctx, menuRect);
  }

  /**
   * Render form mode
   * @private
   */
  _renderForm(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = this.mode === 'add' ? ' Add Goal ' : ' Edit Goal ';
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    let row = y + 2;
    const labelWidth = 12;
    const fieldWidth = w - labelWidth - 4;

    // ID field
    this._renderFormField(ctx, 'ID:', this.formFields.id, x + 2, row, labelWidth, fieldWidth, this.focusedField === 'id');
    row += 2;

    // Objective field (multi-line)
    screen.drawText(x + 2, row, 'Objective:', this.focusedField === 'objective' ? styles.accent : styles.dim);
    row++;
    const objRect = { x: x + 2, y: row, w: w - 4, h: 3 };
    this.formFields.objective.focused = this.focusedField === 'objective';
    this.formFields.objective.render(ctx, objRect);
    row += 4;

    // Priority field
    this._renderFormField(ctx, 'Priority:', this.formFields.priority, x + 2, row, labelWidth, 10, this.focusedField === 'priority');
    row += 2;

    // Constraints (multi-line)
    screen.drawText(x + 2, row, 'Constraints (one per line):', this.focusedField === 'constraints' ? styles.accent : styles.dim);
    row++;
    const conRect = { x: x + 2, y: row, w: w - 4, h: 3 };
    this.formFields.constraints.focused = this.focusedField === 'constraints';
    this.formFields.constraints.render(ctx, conRect);
    row += 4;

    // Success Criteria (multi-line)
    screen.drawText(x + 2, row, 'Success Criteria (one per line):', this.focusedField === 'successCriteria' ? styles.accent : styles.dim);
    row++;
    const sucRect = { x: x + 2, y: row, w: w - 4, h: 2 };
    this.formFields.successCriteria.focused = this.focusedField === 'successCriteria';
    this.formFields.successCriteria.render(ctx, sucRect);
    row += 3;

    // Acceptance Criteria (multi-line)
    screen.drawText(x + 2, row, 'Acceptance Criteria (one per line):', this.focusedField === 'acceptanceCriteria' ? styles.accent : styles.dim);
    row++;
    const accRect = { x: x + 2, y: row, w: w - 4, h: 2 };
    this.formFields.acceptanceCriteria.focused = this.focusedField === 'acceptanceCriteria';
    this.formFields.acceptanceCriteria.render(ctx, accRect);
    row += 3;

    // Dependencies field
    this._renderFormField(ctx, 'Dependencies:', this.formFields.dependencies, x + 2, row, labelWidth, fieldWidth, this.focusedField === 'dependencies');
  }

  /**
   * Render a single-line form field
   * @private
   */
  _renderFormField(ctx, label, input, x, y, labelWidth, fieldWidth, focused) {
    const { screen, styles } = ctx;
    screen.drawText(x, y, label.padEnd(labelWidth), focused ? styles.accent : styles.dim);
    input.focused = focused;
    input.render(ctx, { x: x + labelWidth, y, w: fieldWidth, h: 1 });
  }

  /**
   * Render JSON edit mode
   * @private
   */
  _renderJson(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    screen.drawBox(x, y, w, h, charset, styles.border, ' Edit JSON ');

    const editorRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    this.jsonEditor.render(ctx, editorRect);
  }

  /**
   * Render rename mode
   * @private
   */
  _renderRename(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    screen.drawBox(x, y, w, Math.min(h, 5), charset, styles.border, ' Rename File ');

    const inputRect = { x: x + 2, y: y + 2, w: w - 4, h: 1 };
    this.renameInput.render(ctx, inputRect);
  }
}

export default GoalsTabScreen;
