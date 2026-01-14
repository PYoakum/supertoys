/**
 * @fileoverview Sandbox Manager for isolated workspace management
 * @module sandbox-manager
 */

import { mkdir, rm, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative, sep } from 'path';

/**
 * @typedef {Object} SandboxConfig
 * @property {string} baseDir - Base directory for all sandboxes
 * @property {number} [maxFileSize=10485760] - Maximum file size in bytes (10MB)
 * @property {number} [maxTotalSize=104857600] - Maximum total sandbox size (100MB)
 */

/**
 * @typedef {Object} SandboxStats
 * @property {number} totalSandboxes - Number of active sandboxes
 * @property {number} totalSize - Total size across all sandboxes
 * @property {Object.<string, number>} sandboxSizes - Size per sandbox
 */

const DEFAULT_CONFIG = {
  maxFileSize: 10 * 1024 * 1024,      // 10MB
  maxTotalSize: 100 * 1024 * 1024,    // 100MB
  defaultSandboxId: 'default'
};

/**
 * Manages isolated sandbox workspaces for file operations
 */
export class SandboxManager {
  /**
   * @param {SandboxConfig} config
   */
  constructor(config) {
    if (!config.baseDir) {
      throw new Error('baseDir is required for SandboxManager');
    }

    /** @type {string} */
    this.baseDir = resolve(config.baseDir);

    /** @type {number} */
    this.maxFileSize = config.maxFileSize || DEFAULT_CONFIG.maxFileSize;

    /** @type {number} */
    this.maxTotalSize = config.maxTotalSize || DEFAULT_CONFIG.maxTotalSize;

    /** @type {string} */
    this.defaultSandboxId = config.defaultSandboxId || DEFAULT_CONFIG.defaultSandboxId;

    /** @type {Map<string, number>} */
    this.sandboxSizes = new Map();
  }

  /**
   * Get the sandbox directory path for a session
   * @param {string} [sessionId] - Session ID (uses default if not provided)
   * @returns {string} Absolute path to sandbox directory
   */
  getSandboxPath(sessionId) {
    const id = sessionId || this.defaultSandboxId;
    // Sanitize session ID to prevent path traversal
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.baseDir, safeId);
  }

  /**
   * Ensure sandbox directory exists
   * @param {string} [sessionId] - Session ID
   * @returns {Promise<string>} Path to sandbox directory
   */
  async ensureSandbox(sessionId) {
    const sandboxPath = this.getSandboxPath(sessionId);
    if (!existsSync(sandboxPath)) {
      await mkdir(sandboxPath, { recursive: true });
    }
    return sandboxPath;
  }

  /**
   * Resolve a relative path safely within a sandbox
   * @param {string} [sessionId] - Session ID
   * @param {string} relativePath - Relative path within sandbox
   * @returns {Promise<string>} Absolute path within sandbox
   * @throws {Error} If path escapes sandbox bounds
   */
  async resolvePath(sessionId, relativePath) {
    const sandboxPath = await this.ensureSandbox(sessionId);

    // Normalize and resolve the path
    const resolvedPath = resolve(sandboxPath, relativePath);

    // Security check: ensure resolved path is within sandbox
    if (!this.isPathWithinSandbox(sandboxPath, resolvedPath)) {
      const error = new Error(`Path traversal detected: ${relativePath}`);
      error.code = 'PATH_TRAVERSAL';
      throw error;
    }

    return resolvedPath;
  }

  /**
   * Check if a path is within the sandbox bounds
   * @param {string} sandboxPath - Sandbox root path
   * @param {string} targetPath - Path to check
   * @returns {boolean}
   */
  isPathWithinSandbox(sandboxPath, targetPath) {
    const relativePath = relative(sandboxPath, targetPath);

    // Check if path escapes sandbox (starts with .. or is absolute)
    if (relativePath.startsWith('..') || relativePath.startsWith(sep)) {
      return false;
    }

    // Additional check: resolved path must start with sandbox path
    const normalizedSandbox = sandboxPath.endsWith(sep) ? sandboxPath : sandboxPath + sep;
    const normalizedTarget = targetPath.endsWith(sep) ? targetPath : targetPath + sep;

    return targetPath === sandboxPath || normalizedTarget.startsWith(normalizedSandbox);
  }

  /**
   * Ensure parent directory exists for a file path
   * @param {string} filePath - Absolute file path
   * @returns {Promise<void>}
   */
  async ensureParentDir(filePath) {
    const parentDir = join(filePath, '..');
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }
  }

  /**
   * Validate file size against limits
   * @param {number} size - File size in bytes
   * @param {string} [sessionId] - Session ID for quota check
   * @throws {Error} If size exceeds limits
   */
  validateFileSize(size, sessionId) {
    if (size > this.maxFileSize) {
      const error = new Error(
        `File size ${size} bytes exceeds maximum ${this.maxFileSize} bytes`
      );
      error.code = 'FILE_SIZE_EXCEEDED';
      throw error;
    }

    // Check sandbox quota
    const currentSize = this.sandboxSizes.get(sessionId || this.defaultSandboxId) || 0;
    if (currentSize + size > this.maxTotalSize) {
      const error = new Error(
        `Sandbox quota exceeded. Current: ${currentSize}, Adding: ${size}, Max: ${this.maxTotalSize}`
      );
      error.code = 'SANDBOX_QUOTA_EXCEEDED';
      throw error;
    }
  }

  /**
   * Update sandbox size tracking
   * @param {string} [sessionId] - Session ID
   * @param {number} sizeDelta - Size change (positive or negative)
   */
  updateSandboxSize(sessionId, sizeDelta) {
    const id = sessionId || this.defaultSandboxId;
    const currentSize = this.sandboxSizes.get(id) || 0;
    const newSize = Math.max(0, currentSize + sizeDelta);
    this.sandboxSizes.set(id, newSize);
  }

  /**
   * Calculate actual sandbox size from filesystem
   * @param {string} [sessionId] - Session ID
   * @returns {Promise<number>} Total size in bytes
   */
  async calculateSandboxSize(sessionId) {
    const sandboxPath = this.getSandboxPath(sessionId);

    if (!existsSync(sandboxPath)) {
      return 0;
    }

    let totalSize = 0;

    const calculateDirSize = async (dirPath) => {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await calculateDirSize(entryPath);
        } else if (entry.isFile()) {
          const stats = await stat(entryPath);
          totalSize += stats.size;
        }
      }
    };

    await calculateDirSize(sandboxPath);

    // Update cached size
    this.sandboxSizes.set(sessionId || this.defaultSandboxId, totalSize);

    return totalSize;
  }

  /**
   * Clean up a sandbox (remove all files)
   * @param {string} [sessionId] - Session ID
   * @returns {Promise<void>}
   */
  async cleanup(sessionId) {
    const sandboxPath = this.getSandboxPath(sessionId);

    if (existsSync(sandboxPath)) {
      await rm(sandboxPath, { recursive: true, force: true });
    }

    this.sandboxSizes.delete(sessionId || this.defaultSandboxId);
  }

  /**
   * Clean up all sandboxes
   * @returns {Promise<void>}
   */
  async cleanupAll() {
    if (existsSync(this.baseDir)) {
      await rm(this.baseDir, { recursive: true, force: true });
    }
    this.sandboxSizes.clear();
  }

  /**
   * Get statistics about sandboxes
   * @returns {Promise<SandboxStats>}
   */
  async getStats() {
    const sandboxSizes = {};
    let totalSize = 0;

    if (existsSync(this.baseDir)) {
      const entries = await readdir(this.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const size = await this.calculateSandboxSize(entry.name);
          sandboxSizes[entry.name] = size;
          totalSize += size;
        }
      }
    }

    return {
      totalSandboxes: Object.keys(sandboxSizes).length,
      totalSize,
      sandboxSizes,
      limits: {
        maxFileSize: this.maxFileSize,
        maxTotalSize: this.maxTotalSize
      }
    };
  }

  /**
   * List all sandbox IDs
   * @returns {Promise<string[]>}
   */
  async listSandboxes() {
    if (!existsSync(this.baseDir)) {
      return [];
    }

    const entries = await readdir(this.baseDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }
}

/**
 * Create a SandboxManager instance
 * @param {SandboxConfig} config
 * @returns {SandboxManager}
 */
export function createSandboxManager(config) {
  return new SandboxManager(config);
}

export default SandboxManager;
