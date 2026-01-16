/**
 * @fileoverview Context Tab Screen
 * @module tui/screens/context-tab
 */

import { readdirSync, readFileSync, statSync, copyFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, basename, extname, dirname } from 'path';
import { Menu } from '../components/menu.js';
import { TextArea } from '../components/text-area.js';

/**
 * Context Tab Screen - Manage context files and AI editing
 */
export class ContextTabScreen {
  /**
   * @param {Object} options
   * @param {Object} [options.state] - Shared state reference
   */
  constructor(options = {}) {
    this.state = options.state || {};

    // Mode: 'browse' | 'view' | 'ai-edit'
    this.mode = 'browse';

    // Context directory
    this.contextPath = this.state.contextPath || './context';

    // Components
    this.filesList = new Menu({ title: 'Context Files', items: [] });
    this.fileViewer = new TextArea({ readOnly: true });

    // State
    this.files = [];
    this.selectedFile = null;
    this.focused = false;

    // Add file mode state
    this.addMode = false;
    this.addFilePath = '';

    // Confirm delete state
    this.confirmDelete = false;

    // Status message
    this.statusMessage = '';
  }

  /**
   * Set shared state reference
   * @param {Object} state
   */
  setState(state) {
    this.state = state;
    this.contextPath = state.contextPath || this.contextPath;
  }

  /**
   * Focus the screen
   */
  focus() {
    this.focused = true;
    this._loadFiles();
  }

  /**
   * Blur the screen
   */
  blur() {
    this.focused = false;
  }

  /**
   * Get help text
   * @returns {string}
   */
  getHelpText() {
    if (this.addMode) {
      return '[Enter] Add File  [Esc] Cancel';
    }
    if (this.confirmDelete) {
      return '[Y] Confirm Delete  [N/Esc] Cancel';
    }
    switch (this.mode) {
      case 'browse':
        return '[Enter] View  [A] Add  [X] Delete  [R] Refresh';
      case 'view':
        return '[Up/Down] Scroll  [Esc] Back';
      case 'ai-edit':
        return '[Space] Toggle  [Enter] Apply  [Esc] Cancel';
      default:
        return '';
    }
  }

  /**
   * Load files from context directory
   * @private
   */
  _loadFiles() {
    try {
      const absPath = resolve(this.contextPath);
      const entries = readdirSync(absPath, { withFileTypes: true });

      this.files = entries
        .filter(e => e.isFile())
        .map(e => {
          const filePath = join(absPath, e.name);
          let content = '';
          try {
            content = readFileSync(filePath, 'utf-8');
          } catch (readErr) {
            // Skip files that can't be read
          }
          return {
            name: e.name,
            path: filePath,
            ext: extname(e.name),
            size: statSync(filePath).size,
            content
          };
        })
        .filter(f => f.content.length > 0) // Only include readable files
        .sort((a, b) => a.name.localeCompare(b.name));

      this._updateFilesList();
      this._updateStateContext();
    } catch (err) {
      this.files = [];
      this.filesList.setItems(['(No context directory or empty)']);
    }
  }

  /**
   * Update shared state with context files for session creation
   * @private
   */
  _updateStateContext() {
    if (!this.state) return;

    // Build context bundle with file contents for LLM
    this.state.context = {
      files: this.files.map(f => ({
        path: f.name, // Use relative path/filename
        content: f.content,
        extension: f.ext,
        size: f.size
      })),
      metadata: {
        source: this.contextPath,
        totalFiles: this.files.length,
        totalSize: this.files.reduce((sum, f) => sum + f.size, 0),
        loadedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Update files list menu
   * @private
   */
  _updateFilesList() {
    if (this.files.length === 0) {
      this.filesList.setItems(['(No files in context directory)']);
      return;
    }

    const items = this.files.map(f => {
      const size = f.size < 1024 ? `${f.size}B` : `${Math.round(f.size / 1024)}KB`;
      return `${f.name} (${size})`;
    });

    this.filesList.setItems(items);
  }

  /**
   * View selected file
   * @private
   */
  _viewFile() {
    const index = this.filesList.selected;
    if (index >= 0 && index < this.files.length) {
      try {
        const file = this.files[index];
        const content = readFileSync(file.path, 'utf-8');
        this.selectedFile = file;
        this.fileViewer.setValue(content);
        this.mode = 'view';
        this.fileViewer.focus();
      } catch (err) {
        // Error reading file
      }
    }
  }

  /**
   * Start add file mode
   * @private
   */
  _startAddFile() {
    this.addMode = true;
    this.addFilePath = '';
  }

  /**
   * Add a file to the context directory
   * @private
   */
  _addFile() {
    if (!this.addFilePath.trim()) {
      this.addMode = false;
      return;
    }

    try {
      const sourcePath = resolve(this.addFilePath.trim());

      if (!existsSync(sourcePath)) {
        this.statusMessage = `File not found: ${this.addFilePath}`;
        this.addMode = false;
        return;
      }

      const stat = statSync(sourcePath);
      if (!stat.isFile()) {
        this.statusMessage = 'Path is not a file';
        this.addMode = false;
        return;
      }

      // Ensure context directory exists
      const contextDir = resolve(this.contextPath);
      if (!existsSync(contextDir)) {
        mkdirSync(contextDir, { recursive: true });
      }

      // Copy file to context directory
      const destPath = join(contextDir, basename(sourcePath));
      copyFileSync(sourcePath, destPath);

      this.statusMessage = `Added: ${basename(sourcePath)}`;
      this.addMode = false;
      this.addFilePath = '';
      this._loadFiles();
    } catch (err) {
      this.statusMessage = `Error: ${err.message}`;
      this.addMode = false;
    }
  }

  /**
   * Start delete confirmation
   * @private
   */
  _startDelete() {
    const index = this.filesList.selected;
    if (index >= 0 && index < this.files.length) {
      this.confirmDelete = true;
    }
  }

  /**
   * Delete the selected file
   * @private
   */
  _deleteFile() {
    const index = this.filesList.selected;
    if (index >= 0 && index < this.files.length) {
      try {
        const file = this.files[index];
        unlinkSync(file.path);
        this.statusMessage = `Deleted: ${file.name}`;
        this.confirmDelete = false;
        this._loadFiles();
      } catch (err) {
        this.statusMessage = `Error: ${err.message}`;
        this.confirmDelete = false;
      }
    }
  }

  /**
   * Handle events
   * @param {Object} ctx
   * @param {Object} evt
   */
  onEvent(ctx, evt) {
    // Handle add mode first
    if (this.addMode) {
      this._handleAddModeEvent(ctx, evt);
      return;
    }

    // Handle delete confirmation
    if (this.confirmDelete) {
      this._handleDeleteConfirmEvent(ctx, evt);
      return;
    }

    switch (this.mode) {
      case 'browse':
        this._handleBrowseEvent(ctx, evt);
        break;
      case 'view':
        this._handleViewEvent(ctx, evt);
        break;
      case 'ai-edit':
        this._handleAiEditEvent(ctx, evt);
        break;
    }
  }

  /**
   * Handle add mode events (file path input)
   * @private
   */
  _handleAddModeEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.addMode = false;
          this.addFilePath = '';
          return;
        case 'enter':
          this._addFile();
          return;
        case 'backspace':
          this.addFilePath = this.addFilePath.slice(0, -1);
          return;
      }
    }

    if (evt.type === 'text') {
      this.addFilePath += evt.text;
    }
  }

  /**
   * Handle delete confirmation events
   * @private
   */
  _handleDeleteConfirmEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.confirmDelete = false;
          return;
      }
    }

    if (evt.type === 'text') {
      const char = evt.text.toLowerCase();
      if (char === 'y') {
        this._deleteFile();
      } else if (char === 'n') {
        this.confirmDelete = false;
      }
    }
  }

  /**
   * Handle browse mode events
   * @private
   */
  _handleBrowseEvent(ctx, evt) {
    if (evt.type === 'key') {
      const result = this.filesList.onKey(evt.key);
      if (result?.action === 'select') {
        this._viewFile();
        return;
      }

      switch (evt.key) {
        case 'enter':
          this._viewFile();
          break;
      }
    }

    if (evt.type === 'text') {
      switch (evt.text.toLowerCase()) {
        case 'r':
          this._loadFiles();
          break;
        case 'a':
          this._startAddFile();
          break;
        case 'x':
        case 'd':
          this._startDelete();
          break;
        case 'e':
          // AI-edit mode - would integrate with existing ai-editor.js
          // For now, show message
          break;
      }
    }
  }

  /**
   * Handle view mode events
   * @private
   */
  _handleViewEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'browse';
          return;
      }
    }

    this.fileViewer.onEvent(ctx, evt);
  }

  /**
   * Handle AI-edit mode events
   * @private
   */
  _handleAiEditEvent(ctx, evt) {
    if (evt.type === 'key') {
      switch (evt.key) {
        case 'esc':
          this.mode = 'browse';
          return;
      }
    }
  }

  /**
   * Render the screen
   * @param {Object} ctx
   * @param {Object} rect
   */
  render(ctx, rect) {
    switch (this.mode) {
      case 'browse':
        this._renderBrowse(ctx, rect);
        break;
      case 'view':
        this._renderView(ctx, rect);
        break;
      case 'ai-edit':
        this._renderAiEdit(ctx, rect);
        break;
    }
  }

  /**
   * Render browse mode
   * @private
   */
  _renderBrowse(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ` Context: ${basename(this.contextPath)} `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    // Reserve space for input/status at bottom
    const hasOverlay = this.addMode || this.confirmDelete || this.statusMessage;
    const menuHeight = hasOverlay ? h - 4 : h - 2;

    const menuRect = { x: x + 1, y: y + 1, w: w - 2, h: menuHeight };
    this.filesList.render(ctx, menuRect);

    // Render add file input
    if (this.addMode) {
      const inputY = y + h - 3;
      screen.drawText(x + 2, inputY, 'File path:', styles.normal);
      screen.drawText(x + 13, inputY, this.addFilePath + '_', styles.highlight);
    }

    // Render delete confirmation
    if (this.confirmDelete) {
      const index = this.filesList.selected;
      const fileName = this.files[index]?.name || 'file';
      const confirmY = y + h - 3;
      const msg = `Delete "${fileName}"? [Y/N]`;
      screen.drawText(x + 2, confirmY, msg, styles.error);
    }

    // Render status message (clear after showing)
    if (this.statusMessage && !this.addMode && !this.confirmDelete) {
      const statusY = y + h - 3;
      const isError = this.statusMessage.startsWith('Error');
      screen.drawText(x + 2, statusY, this.statusMessage, isError ? styles.error : styles.success);
      // Clear status after a render
      setTimeout(() => { this.statusMessage = ''; }, 2000);
    }
  }

  /**
   * Render view mode
   * @private
   */
  _renderView(ctx, rect) {
    const { screen, styles, charset } = ctx;
    const { x, y, w, h } = rect;

    const title = ` ${this.selectedFile?.name || 'File'} `;
    screen.drawBox(x, y, w, h, charset, styles.border, title);

    const viewerRect = { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
    this.fileViewer.render(ctx, viewerRect);
  }

  /**
   * Render AI-edit mode
   * @private
   */
  _renderAiEdit(ctx, rect) {
    const { screen, styles } = ctx;
    const { x, y, w, h } = rect;

    const message = 'AI-Edit mode coming soon';
    const msgX = x + Math.floor((w - message.length) / 2);
    const msgY = y + Math.floor(h / 2);
    screen.drawText(msgX, msgY, message, styles.dim);
  }
}

export default ContextTabScreen;
