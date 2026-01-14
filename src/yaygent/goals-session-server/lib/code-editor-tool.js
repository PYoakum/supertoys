/**
 * @fileoverview Code Editor Tool for sandboxed file operations
 * @module code-editor-tool
 */

import { readFile, writeFile, unlink, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';

/**
 * @typedef {Object} PatchLineRange
 * @property {'line_range'} type
 * @property {number} startLine - Starting line number (1-indexed)
 * @property {number} endLine - Ending line number (inclusive)
 * @property {string} replacement - Replacement content
 */

/**
 * @typedef {Object} PatchSearchReplace
 * @property {'search_replace'} type
 * @property {string} search - Text or regex pattern to find
 * @property {string} replacement - Replacement text
 * @property {boolean} [replaceAll=false] - Replace all occurrences
 */

/**
 * Code Editor Tool for file operations within a sandbox
 */
export class CodeEditorTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   */
  constructor(sandboxManager) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for CodeEditorTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;
  }

  /**
   * Main entry point - routes to appropriate operation
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const { operation, sessionId, ...rest } = args;

    if (!operation) {
      throw new Error('operation is required');
    }

    const operations = {
      create: () => this.create(sessionId, rest),
      read: () => this.read(sessionId, rest),
      write: () => this.write(sessionId, rest),
      patch: () => this.patch(sessionId, rest),
      delete: () => this.delete(sessionId, rest),
      list: () => this.list(sessionId, rest),
      stat: () => this.stat(sessionId, rest)
    };

    const op = operations[operation];
    if (!op) {
      throw new Error(`Unknown operation: ${operation}. Valid operations: ${Object.keys(operations).join(', ')}`);
    }

    return await op();
  }

  /**
   * Create a new file
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} args.path - Relative path
   * @param {string} [args.content=''] - Initial content
   * @param {string} [args.encoding='utf-8'] - Content encoding
   * @returns {Promise<Object>}
   */
  async create(sessionId, { path, content = '', encoding = 'utf-8' }) {
    if (!path) {
      throw new Error('path is required for create operation');
    }

    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    // Check if file already exists
    if (existsSync(absPath)) {
      const error = new Error(`File already exists: ${path}`);
      error.code = 'FILE_EXISTS';
      throw error;
    }

    // Validate size
    const contentBuffer = this.encodeContent(content, encoding);
    this.sandboxManager.validateFileSize(contentBuffer.length, sessionId);

    // Ensure parent directory exists
    await this.sandboxManager.ensureParentDir(absPath);

    // Write file
    await writeFile(absPath, contentBuffer);

    // Update size tracking
    this.sandboxManager.updateSandboxSize(sessionId, contentBuffer.length);

    const stats = await stat(absPath);

    return this.formatResponse({
      success: true,
      operation: 'create',
      path,
      size: stats.size,
      created: stats.birthtime.toISOString()
    });
  }

  /**
   * Read file contents
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} args.path - Relative path
   * @param {string} [args.encoding='utf-8'] - Content encoding
   * @returns {Promise<Object>}
   */
  async read(sessionId, { path, encoding = 'utf-8' }) {
    if (!path) {
      throw new Error('path is required for read operation');
    }

    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    if (!existsSync(absPath)) {
      const error = new Error(`File not found: ${path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }

    const stats = await stat(absPath);
    if (stats.isDirectory()) {
      throw new Error(`Cannot read directory: ${path}`);
    }

    const buffer = await readFile(absPath);
    const content = this.decodeContent(buffer, encoding);

    return this.formatResponse({
      success: true,
      operation: 'read',
      path,
      content,
      encoding,
      size: stats.size
    });
  }

  /**
   * Write/overwrite file contents
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} args.path - Relative path
   * @param {string} args.content - Content to write
   * @param {string} [args.encoding='utf-8'] - Content encoding
   * @returns {Promise<Object>}
   */
  async write(sessionId, { path, content, encoding = 'utf-8' }) {
    if (!path) {
      throw new Error('path is required for write operation');
    }
    if (content === undefined) {
      throw new Error('content is required for write operation');
    }

    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    // Get existing size for quota calculation
    let existingSize = 0;
    const fileExists = existsSync(absPath);
    if (fileExists) {
      const existingStats = await stat(absPath);
      existingSize = existingStats.size;
    }

    // Validate new size (accounting for size change)
    const contentBuffer = this.encodeContent(content, encoding);
    const sizeDelta = contentBuffer.length - existingSize;
    if (sizeDelta > 0) {
      this.sandboxManager.validateFileSize(contentBuffer.length, sessionId);
    }

    // Ensure parent directory exists
    await this.sandboxManager.ensureParentDir(absPath);

    // Write file
    await writeFile(absPath, contentBuffer);

    // Update size tracking
    this.sandboxManager.updateSandboxSize(sessionId, sizeDelta);

    const stats = await stat(absPath);

    return this.formatResponse({
      success: true,
      operation: 'write',
      path,
      size: stats.size,
      [fileExists ? 'modified' : 'created']: stats.mtime.toISOString()
    });
  }

  /**
   * Apply a patch to a file
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} args.path - Relative path
   * @param {PatchLineRange|PatchSearchReplace} args.patch - Patch specification
   * @returns {Promise<Object>}
   */
  async patch(sessionId, { path, patch }) {
    if (!path) {
      throw new Error('path is required for patch operation');
    }
    if (!patch) {
      throw new Error('patch is required for patch operation');
    }
    if (!patch.type) {
      throw new Error('patch.type is required (line_range or search_replace)');
    }

    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    if (!existsSync(absPath)) {
      const error = new Error(`File not found: ${path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }

    // Read current content
    const currentContent = await readFile(absPath, 'utf-8');
    let newContent;
    let linesChanged = 0;

    if (patch.type === 'line_range') {
      const result = this.applyLineRangePatch(currentContent, patch);
      newContent = result.content;
      linesChanged = result.linesChanged;
    } else if (patch.type === 'search_replace') {
      const result = this.applySearchReplacePatch(currentContent, patch);
      newContent = result.content;
      linesChanged = result.replacements;
    } else {
      throw new Error(`Unknown patch type: ${patch.type}`);
    }

    // Check size change
    const sizeDelta = Buffer.byteLength(newContent, 'utf-8') - Buffer.byteLength(currentContent, 'utf-8');
    if (sizeDelta > 0) {
      this.sandboxManager.validateFileSize(Buffer.byteLength(newContent, 'utf-8'), sessionId);
    }

    // Write patched content
    await writeFile(absPath, newContent, 'utf-8');

    // Update size tracking
    this.sandboxManager.updateSandboxSize(sessionId, sizeDelta);

    const stats = await stat(absPath);

    return this.formatResponse({
      success: true,
      operation: 'patch',
      path,
      patchType: patch.type,
      linesChanged,
      size: stats.size
    });
  }

  /**
   * Apply line range patch
   * @param {string} content - Original content
   * @param {PatchLineRange} patch - Patch specification
   * @returns {{content: string, linesChanged: number}}
   */
  applyLineRangePatch(content, patch) {
    const { startLine, endLine, replacement } = patch;

    if (!startLine || startLine < 1) {
      throw new Error('patch.startLine must be a positive integer');
    }
    if (!endLine || endLine < startLine) {
      throw new Error('patch.endLine must be >= startLine');
    }
    if (replacement === undefined) {
      throw new Error('patch.replacement is required');
    }

    const lines = content.split('\n');

    if (startLine > lines.length) {
      throw new Error(`startLine ${startLine} exceeds file length ${lines.length}`);
    }

    // Adjust endLine if it exceeds file length
    const actualEndLine = Math.min(endLine, lines.length);

    // Replace lines (1-indexed to 0-indexed)
    const replacementLines = replacement.split('\n');
    const removedCount = actualEndLine - startLine + 1;

    lines.splice(startLine - 1, removedCount, ...replacementLines);

    return {
      content: lines.join('\n'),
      linesChanged: removedCount
    };
  }

  /**
   * Apply search/replace patch
   * @param {string} content - Original content
   * @param {PatchSearchReplace} patch - Patch specification
   * @returns {{content: string, replacements: number}}
   */
  applySearchReplacePatch(content, patch) {
    const { search, replacement, replaceAll = false } = patch;

    if (!search) {
      throw new Error('patch.search is required');
    }
    if (replacement === undefined) {
      throw new Error('patch.replacement is required');
    }

    let replacements = 0;
    let newContent;

    if (replaceAll) {
      // Count occurrences
      const regex = new RegExp(this.escapeRegex(search), 'g');
      const matches = content.match(regex);
      replacements = matches ? matches.length : 0;
      newContent = content.split(search).join(replacement);
    } else {
      // Replace first occurrence
      const index = content.indexOf(search);
      if (index !== -1) {
        newContent = content.slice(0, index) + replacement + content.slice(index + search.length);
        replacements = 1;
      } else {
        newContent = content;
      }
    }

    return {
      content: newContent,
      replacements
    };
  }

  /**
   * Escape special regex characters
   * @param {string} str
   * @returns {string}
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Delete a file
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} args.path - Relative path
   * @returns {Promise<Object>}
   */
  async delete(sessionId, { path }) {
    if (!path) {
      throw new Error('path is required for delete operation');
    }

    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    if (!existsSync(absPath)) {
      const error = new Error(`File not found: ${path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }

    const stats = await stat(absPath);
    if (stats.isDirectory()) {
      throw new Error(`Cannot delete directory: ${path}. Use a dedicated directory removal tool.`);
    }

    const fileSize = stats.size;

    await unlink(absPath);

    // Update size tracking
    this.sandboxManager.updateSandboxSize(sessionId, -fileSize);

    return this.formatResponse({
      success: true,
      operation: 'delete',
      path,
      deleted: true
    });
  }

  /**
   * List files in sandbox
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} [args.pattern] - Glob pattern, defaults to all files
   * @returns {Promise<Object>}
   */
  async list(sessionId, { pattern = '**' } = {}) {
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);

    const files = [];

    const walkDir = async (dirPath, relativeBase = '') => {
      if (!existsSync(dirPath)) {
        return;
      }

      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryRelPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
        const entryAbsPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          await walkDir(entryAbsPath, entryRelPath);
        } else if (entry.isFile()) {
          // Check if matches pattern
          if (this.matchesPattern(entryRelPath, pattern)) {
            const stats = await stat(entryAbsPath);
            files.push({
              path: entryRelPath,
              size: stats.size,
              modified: stats.mtime.toISOString()
            });
          }
        }
      }
    };

    await walkDir(sandboxPath);

    // Sort by path
    files.sort((a, b) => a.path.localeCompare(b.path));

    return this.formatResponse({
      success: true,
      operation: 'list',
      pattern,
      files,
      count: files.length
    });
  }

  /**
   * Simple glob pattern matching
   * @param {string} path - Path to test
   * @param {string} pattern - Glob pattern
   * @returns {boolean}
   */
  matchesPattern(path, pattern) {
    // Convert glob to regex using placeholders to avoid replacement conflicts
    let regexStr = pattern
      // Escape regex special chars (except * and ?)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // Use placeholders to avoid replacement conflicts
      .replace(/\*\*/g, '\x00GLOBSTAR\x00')
      .replace(/\*/g, '\x00STAR\x00')
      .replace(/\?/g, '\x00QUESTION\x00')
      // Now replace placeholders with actual regex
      .replace(/\x00GLOBSTAR\x00/g, '.*')
      .replace(/\x00STAR\x00/g, '[^/]*')
      .replace(/\x00QUESTION\x00/g, '.');

    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(path);
  }

  /**
   * Get file/directory statistics
   * @param {string} [sessionId]
   * @param {Object} args
   * @param {string} args.path - Relative path
   * @returns {Promise<Object>}
   */
  async stat(sessionId, { path }) {
    if (!path) {
      throw new Error('path is required for stat operation');
    }

    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    if (!existsSync(absPath)) {
      const error = new Error(`Path not found: ${path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }

    const stats = await stat(absPath);

    return this.formatResponse({
      success: true,
      operation: 'stat',
      path,
      size: stats.size,
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      accessed: stats.atime.toISOString(),
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      mode: stats.mode.toString(8)
    });
  }

  /**
   * Encode content to buffer
   * @param {string} content
   * @param {string} encoding
   * @returns {Buffer}
   */
  encodeContent(content, encoding) {
    if (encoding === 'base64') {
      return Buffer.from(content, 'base64');
    }
    return Buffer.from(content, 'utf-8');
  }

  /**
   * Decode buffer to string
   * @param {Buffer} buffer
   * @param {string} encoding
   * @returns {string}
   */
  decodeContent(buffer, encoding) {
    if (encoding === 'base64') {
      return buffer.toString('base64');
    }
    return buffer.toString('utf-8');
  }

  /**
   * Format response in MCP-compatible format
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'code_editor',
      this.execute.bind(this),
      {
        name: 'code_editor',
        description: 'Edit code files in a sandboxed workspace. Supports create, read, write, patch, delete, list, and stat operations.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional, uses "default" if not provided)'
            },
            operation: {
              type: 'string',
              enum: ['create', 'read', 'write', 'patch', 'delete', 'list', 'stat'],
              description: 'The operation to perform'
            },
            path: {
              type: 'string',
              description: 'Relative path within the sandbox (required for all operations except list)'
            },
            content: {
              type: 'string',
              description: 'File content (for create/write operations)'
            },
            encoding: {
              type: 'string',
              enum: ['utf-8', 'base64'],
              default: 'utf-8',
              description: 'Content encoding'
            },
            patch: {
              type: 'object',
              description: 'Patch specification (for patch operation)',
              properties: {
                type: {
                  type: 'string',
                  enum: ['line_range', 'search_replace'],
                  description: 'Type of patch to apply'
                },
                startLine: {
                  type: 'integer',
                  description: 'Starting line number, 1-indexed (for line_range)'
                },
                endLine: {
                  type: 'integer',
                  description: 'Ending line number, inclusive (for line_range)'
                },
                replacement: {
                  type: 'string',
                  description: 'Replacement content'
                },
                search: {
                  type: 'string',
                  description: 'Text to find (for search_replace)'
                },
                replaceAll: {
                  type: 'boolean',
                  default: false,
                  description: 'Replace all occurrences (for search_replace)'
                }
              }
            },
            pattern: {
              type: 'string',
              default: '**',
              description: 'Glob pattern for list operation (** matches all files)'
            }
          },
          required: ['operation']
        }
      }
    );
  }
}

/**
 * Create a CodeEditorTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @returns {CodeEditorTool}
 */
export function createCodeEditorTool(sandboxManager) {
  return new CodeEditorTool(sandboxManager);
}

export default CodeEditorTool;
