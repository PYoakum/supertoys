/**
 * @fileoverview ContextLoader class for loading and processing context files
 * @module context-loader
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, extname, relative } from 'path';
import { ContextError, ErrorCodes } from './errors.js';

/**
 * @typedef {Object} ContextLoaderOptions
 * @property {boolean} [recursive=true] - Whether to traverse subdirectories
 * @property {string[]} [extensions=['*']] - File extensions to include
 * @property {string[]} [exclude=['node_modules', '.git']] - Directories/patterns to exclude
 * @property {number} [maxFileSize=1048576] - Maximum individual file size in bytes (1MB)
 * @property {number} [maxTotalSize=10485760] - Maximum total context size in bytes (10MB)
 */

/**
 * @typedef {Object} ContextFile
 * @property {string} path - Relative path from context root
 * @property {string} content - File content
 * @property {string} extension - File extension
 * @property {number} size - File size in bytes
 * @property {Date} modified - Last modification time
 */

/**
 * @typedef {Object} ContextMetadata
 * @property {number} totalFiles - Number of files loaded
 * @property {number} totalSize - Total size in bytes
 * @property {Object.<string, number>} byExtension - Count by file extension
 * @property {string[]} skipped - Files that were skipped (with reasons)
 */

/**
 * @typedef {Object} ContextBundle
 * @property {ContextFile[]} files - Array of loaded context files
 * @property {ContextMetadata} metadata - Aggregated metadata
 */

/**
 * Default options for context loading
 * @type {ContextLoaderOptions}
 */
const DEFAULT_OPTIONS = {
  recursive: true,
  extensions: ['*'],
  exclude: ['node_modules', '.git', '.DS_Store', '__pycache__', '.venv', 'venv'],
  maxFileSize: 1048576,      // 1MB
  maxTotalSize: 10485760     // 10MB
};

/**
 * ContextLoader class for loading and processing context files
 */
export class ContextLoader {
  /**
   * @param {string} contextPath - Path to the context directory
   * @param {ContextLoaderOptions} [options={}]
   */
  constructor(contextPath, options = {}) {
    /** @type {string} */
    this.contextPath = contextPath;
    
    /** @type {ContextLoaderOptions} */
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    /** @type {ContextBundle|null} */
    this.bundle = null;
    
    /** @type {boolean} */
    this.loaded = false;
  }

  /**
   * Load all context files from the directory
   * @returns {Promise<ContextBundle>}
   * @throws {ContextError}
   */
  async load() {
    // Check directory exists
    if (!existsSync(this.contextPath)) {
      throw new ContextError(
        `Context directory not found: ${this.contextPath}`,
        ErrorCodes.CONTEXT_DIR_NOT_FOUND,
        { path: this.contextPath }
      );
    }

    // Verify it's a directory
    const dirStat = await stat(this.contextPath);
    if (!dirStat.isDirectory()) {
      throw new ContextError(
        `Context path is not a directory: ${this.contextPath}`,
        ErrorCodes.CONTEXT_DIR_NOT_FOUND,
        { path: this.contextPath }
      );
    }

    // Load files
    const files = [];
    const skipped = [];
    let totalSize = 0;

    await this.traverseDirectory(this.contextPath, files, skipped, { totalSize });
    totalSize = files.reduce((sum, f) => sum + f.size, 0);

    // Check if any files were loaded
    if (files.length === 0) {
      throw new ContextError(
        `Context directory is empty or contains no matching files: ${this.contextPath}`,
        ErrorCodes.CONTEXT_DIR_EMPTY,
        { path: this.contextPath, skipped }
      );
    }

    // Check total size
    if (totalSize > this.options.maxTotalSize) {
      throw new ContextError(
        `Context exceeds maximum total size: ${this.formatSize(totalSize)} > ${this.formatSize(this.options.maxTotalSize)}`,
        ErrorCodes.CONTEXT_SIZE_EXCEEDED,
        { totalSize, maxSize: this.options.maxTotalSize }
      );
    }

    // Build metadata
    const byExtension = {};
    for (const file of files) {
      const ext = file.extension || '(no extension)';
      byExtension[ext] = (byExtension[ext] || 0) + 1;
    }

    this.bundle = {
      files,
      metadata: {
        totalFiles: files.length,
        totalSize,
        byExtension,
        skipped
      }
    };

    this.loaded = true;
    return this.bundle;
  }

  /**
   * Traverse a directory and collect files
   * @param {string} dirPath - Directory to traverse
   * @param {ContextFile[]} files - Array to collect files into
   * @param {string[]} skipped - Array to collect skipped file info
   * @param {{totalSize: number}} state - Shared state for size tracking
   * @private
   */
  async traverseDirectory(dirPath, files, skipped, state) {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(this.contextPath, fullPath);

      // Check exclusions
      if (this.isExcluded(entry.name, relativePath)) {
        skipped.push(`${relativePath}: excluded by pattern`);
        continue;
      }

      if (entry.isDirectory()) {
        if (this.options.recursive) {
          await this.traverseDirectory(fullPath, files, skipped, state);
        }
      } else if (entry.isFile()) {
        // Check extension
        const ext = extname(entry.name).toLowerCase();
        if (!this.matchesExtension(ext)) {
          skipped.push(`${relativePath}: extension not in allowed list`);
          continue;
        }

        // Check file size
        const fileStat = await stat(fullPath);
        if (fileStat.size > this.options.maxFileSize) {
          skipped.push(`${relativePath}: exceeds max file size (${this.formatSize(fileStat.size)})`);
          continue;
        }

        // Check if adding this file would exceed total size
        if (state.totalSize + fileStat.size > this.options.maxTotalSize) {
          skipped.push(`${relativePath}: would exceed total size limit`);
          continue;
        }

        // Read file content
        try {
          const content = await readFile(fullPath, 'utf-8');
          
          files.push({
            path: relativePath,
            content,
            extension: ext,
            size: fileStat.size,
            modified: fileStat.mtime
          });

          state.totalSize += fileStat.size;
        } catch (err) {
          // Skip binary files or files that can't be read as UTF-8
          skipped.push(`${relativePath}: could not read as text (${err.message})`);
        }
      }
    }
  }

  /**
   * Check if a file/directory name should be excluded
   * @param {string} name - File or directory name
   * @param {string} relativePath - Relative path
   * @returns {boolean}
   * @private
   */
  isExcluded(name, relativePath) {
    // Check if name starts with dot (hidden files)
    if (name.startsWith('.') && name !== '.' && name !== '..') {
      return true;
    }

    // Check against exclusion list
    for (const pattern of this.options.exclude) {
      if (name === pattern || relativePath.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if an extension matches the allowed list
   * @param {string} ext - File extension (with dot)
   * @returns {boolean}
   * @private
   */
  matchesExtension(ext) {
    if (this.options.extensions.includes('*')) {
      return true;
    }
    return this.options.extensions.some(allowed => 
      allowed === ext || allowed === ext.slice(1) // Support both '.md' and 'md'
    );
  }

  /**
   * Format byte size for display
   * @param {number} bytes - Size in bytes
   * @returns {string}
   * @private
   */
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Get the aggregated context as a formatted string
   * @param {'xml'|'markdown'|'json'} [format='xml'] - Output format
   * @returns {string}
   */
  getFormattedContext(format = 'xml') {
    this.ensureLoaded();

    switch (format) {
      case 'xml':
        return this.formatAsXml();
      case 'markdown':
        return this.formatAsMarkdown();
      case 'json':
        return this.formatAsJson();
      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  /**
   * Format context as XML
   * @returns {string}
   * @private
   */
  formatAsXml() {
    const lines = ['<context>'];
    
    for (const file of this.bundle.files) {
      lines.push(`  <file path="${this.escapeXml(file.path)}" extension="${file.extension}" size="${file.size}">`);
      lines.push(this.escapeXml(file.content));
      lines.push('  </file>');
    }
    
    lines.push('</context>');
    return lines.join('\n');
  }

  /**
   * Format context as Markdown
   * @returns {string}
   * @private
   */
  formatAsMarkdown() {
    const lines = ['# Context Files', ''];
    
    for (const file of this.bundle.files) {
      lines.push(`## ${file.path}`);
      lines.push('');
      
      // Determine language hint for code block
      const langMap = {
        '.js': 'javascript',
        '.ts': 'typescript',
        '.py': 'python',
        '.json': 'json',
        '.md': 'markdown',
        '.html': 'html',
        '.css': 'css',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.sh': 'bash',
        '.sql': 'sql'
      };
      const lang = langMap[file.extension] || '';
      
      lines.push('```' + lang);
      lines.push(file.content);
      lines.push('```');
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * Format context as JSON
   * @returns {string}
   * @private
   */
  formatAsJson() {
    return JSON.stringify({
      files: this.bundle.files.map(f => ({
        path: f.path,
        extension: f.extension,
        size: f.size,
        content: f.content
      })),
      metadata: this.bundle.metadata
    }, null, 2);
  }

  /**
   * Escape special characters for XML
   * @param {string} str - String to escape
   * @returns {string}
   * @private
   */
  escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get metadata about loaded context
   * @returns {ContextMetadata}
   */
  getMetadata() {
    this.ensureLoaded();
    return this.bundle.metadata;
  }

  /**
   * Get the raw bundle
   * @returns {ContextBundle}
   */
  getBundle() {
    this.ensureLoaded();
    return this.bundle;
  }

  /**
   * Get files by extension
   * @param {string} ext - Extension to filter by (with or without dot)
   * @returns {ContextFile[]}
   */
  getFilesByExtension(ext) {
    this.ensureLoaded();
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    return this.bundle.files.filter(f => f.extension === normalizedExt);
  }

  /**
   * Ensure context is loaded
   * @throws {Error} If context not loaded
   * @private
   */
  ensureLoaded() {
    if (!this.loaded) {
      throw new Error('Context not loaded. Call load() first.');
    }
  }
}

export default ContextLoader;
