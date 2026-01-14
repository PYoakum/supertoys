/**
 * @fileoverview Directory Watcher for monitoring goals file creation
 * @module directory-watcher
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { DirectoryNotFoundError } from './errors.js';

/**
 * @typedef {Object} WatcherOptions
 * @property {number} [pollIntervalMs=1000] - Polling interval in milliseconds
 * @property {string} [filePattern='*.json'] - File pattern to watch for
 * @property {boolean} [recursive=false] - Watch subdirectories
 * @property {string[]} [ignorePatterns=[]] - Patterns to ignore
 * @property {number} [stabilityThresholdMs=2000] - Time file must be stable before processing
 */

/**
 * @typedef {Object} DetectedFile
 * @property {string} path - Full file path
 * @property {string} filename - File name
 * @property {number} size - File size in bytes
 * @property {Date} detectedAt - When file was first detected
 * @property {Date} modifiedAt - Last modification time
 * @property {boolean} stable - Whether file has stabilized
 */

/**
 * Directory Watcher class
 * Polls a directory for new files matching a pattern
 */
export class DirectoryWatcher extends EventEmitter {
  /**
   * @param {string} watchPath - Directory to watch
   * @param {WatcherOptions} [options={}]
   */
  constructor(watchPath, options = {}) {
    super();
    
    this.watchPath = watchPath;
    this.pollIntervalMs = options.pollIntervalMs || 1000;
    this.filePattern = options.filePattern || '*.json';
    this.recursive = options.recursive || false;
    this.ignorePatterns = options.ignorePatterns || ['_processed', '_failed'];
    this.stabilityThresholdMs = options.stabilityThresholdMs || 2000;
    
    this.running = false;
    this.pollTimer = null;
    
    /** @type {Map<string, DetectedFile>} */
    this.knownFiles = new Map();
    
    /** @type {Set<string>} */
    this.processedFiles = new Set();
  }

  /**
   * Start watching the directory
   */
  async start() {
    if (this.running) {
      return;
    }

    // Validate directory exists
    if (!existsSync(this.watchPath)) {
      throw new DirectoryNotFoundError(this.watchPath);
    }

    this.running = true;
    this.emit('started', { watchPath: this.watchPath });
    
    // Initial scan
    await this.scan();
    
    // Start polling
    this.schedulePoll();
  }

  /**
   * Stop watching
   */
  stop() {
    this.running = false;
    
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    
    this.emit('stopped');
  }

  /**
   * Schedule next poll
   * @private
   */
  schedulePoll() {
    if (!this.running) return;
    
    this.pollTimer = setTimeout(async () => {
      try {
        await this.scan();
      } catch (err) {
        this.emit('error', err);
      }
      this.schedulePoll();
    }, this.pollIntervalMs);
  }

  /**
   * Scan directory for files
   * @private
   */
  async scan() {
    const files = await this.listMatchingFiles(this.watchPath);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = file.path;
      
      // Skip already processed files
      if (this.processedFiles.has(filePath)) {
        continue;
      }
      
      // Check if file is known
      const known = this.knownFiles.get(filePath);
      
      if (!known) {
        // New file detected
        const detected = {
          path: filePath,
          filename: file.filename,
          size: file.size,
          detectedAt: new Date(),
          modifiedAt: file.modifiedAt,
          stable: false
        };
        
        this.knownFiles.set(filePath, detected);
        this.emit('detected', detected);
        
      } else {
        // Check if file has changed
        if (file.size !== known.size || file.modifiedAt.getTime() !== known.modifiedAt.getTime()) {
          // File still changing
          known.size = file.size;
          known.modifiedAt = file.modifiedAt;
          known.stable = false;
          
        } else if (!known.stable) {
          // Check stability threshold
          const timeSinceModified = now - known.modifiedAt.getTime();
          
          if (timeSinceModified >= this.stabilityThresholdMs) {
            known.stable = true;
            this.emit('stable', known);
          }
        }
      }
    }
    
    // Check for removed files
    for (const [filePath, known] of this.knownFiles) {
      if (!files.some(f => f.path === filePath)) {
        this.knownFiles.delete(filePath);
        this.emit('removed', known);
      }
    }
  }

  /**
   * List files matching pattern
   * @param {string} dir
   * @returns {Promise<Object[]>}
   * @private
   */
  async listMatchingFiles(dir) {
    const results = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        // Check ignore patterns
        if (this.shouldIgnore(entry.name)) {
          continue;
        }
        
        if (entry.isFile() && this.matchesPattern(entry.name)) {
          const stats = await stat(fullPath);
          results.push({
            path: fullPath,
            filename: entry.name,
            size: stats.size,
            modifiedAt: stats.mtime
          });
          
        } else if (entry.isDirectory() && this.recursive) {
          const subFiles = await this.listMatchingFiles(fullPath);
          results.push(...subFiles);
        }
      }
    } catch (err) {
      this.emit('error', err);
    }
    
    return results;
  }

  /**
   * Check if filename matches pattern
   * @param {string} filename
   * @returns {boolean}
   * @private
   */
  matchesPattern(filename) {
    // Simple glob pattern matching
    const pattern = this.filePattern;

    if (pattern === '*') return true;
    if (pattern === '*.json') return filename.endsWith('.json');
    if (pattern === '*.md') return filename.endsWith('.md');
    if (pattern === '*.goals.json') return filename.endsWith('.goals.json');

    // Handle brace expansion like *.{json,md}
    if (pattern.includes('{') && pattern.includes('}')) {
      const braceMatch = pattern.match(/\{([^}]+)\}/);
      if (braceMatch) {
        const extensions = braceMatch[1].split(',').map(e => e.trim());
        const prefix = pattern.slice(0, pattern.indexOf('{'));
        const suffix = pattern.slice(pattern.indexOf('}') + 1);

        return extensions.some(ext => {
          const expandedPattern = prefix + ext + suffix;
          return this.matchesSinglePattern(filename, expandedPattern);
        });
      }
    }

    return this.matchesSinglePattern(filename, pattern);
  }

  /**
   * Check if filename matches a single pattern (no brace expansion)
   * @param {string} filename
   * @param {string} pattern
   * @returns {boolean}
   * @private
   */
  matchesSinglePattern(filename, pattern) {
    // Simple extension check
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // Get .json, .md, etc.
      return filename.endsWith(ext);
    }

    // Convert glob to regex
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(filename);
  }

  /**
   * Check if path should be ignored
   * @param {string} name
   * @returns {boolean}
   * @private
   */
  shouldIgnore(name) {
    return this.ignorePatterns.some(pattern => {
      if (pattern.startsWith('_')) {
        return name.startsWith(pattern);
      }
      return name === pattern || name.includes(pattern);
    });
  }

  /**
   * Mark file as processed
   * @param {string} filePath
   */
  markProcessed(filePath) {
    this.processedFiles.add(filePath);
    this.knownFiles.delete(filePath);
  }

  /**
   * Get pending stable files
   * @returns {DetectedFile[]}
   */
  getPendingFiles() {
    return Array.from(this.knownFiles.values())
      .filter(f => f.stable && !this.processedFiles.has(f.path));
  }

  /**
   * Get watcher status
   * @returns {Object}
   */
  getStatus() {
    return {
      running: this.running,
      watchPath: this.watchPath,
      knownFiles: this.knownFiles.size,
      processedFiles: this.processedFiles.size,
      pendingFiles: this.getPendingFiles().length
    };
  }
}

export default DirectoryWatcher;