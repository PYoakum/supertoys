/**
 * @fileoverview Read File Tool
 * @module read-file-tool
 *
 * Allows reading external files and adding them to the session context
 * for additional runtime context during task execution.
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, extname } from 'path';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  maxFileSize: 1024 * 1024,  // 1MB max file size
  maxFiles: 50               // Max files per session
};

/**
 * Read File Tool
 * Reads files from the filesystem and adds them to session context
 */
export class ReadFileTool {
  /**
   * @param {import('./session-manager.js').SessionManager} sessionManager
   * @param {Object} [config]
   */
  constructor(sessionManager, config = {}) {
    if (!sessionManager) {
      throw new Error('SessionManager is required for ReadFileTool');
    }

    /** @type {import('./session-manager.js').SessionManager} */
    this.sessionManager = sessionManager;

    /** @type {number} */
    this.maxFileSize = config.maxFileSize || DEFAULT_LIMITS.maxFileSize;

    /** @type {number} */
    this.maxFiles = config.maxFiles || DEFAULT_LIMITS.maxFiles;

    /** @type {string[]} */
    this.allowedPaths = config.allowedPaths || [];

    /** @type {boolean} */
    this.allowAbsolutePaths = config.allowAbsolutePaths !== false;
  }

  /**
   * Read a file and add it to session context
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const { sessionId, path: filePath, alias } = args;

    // Validate required fields
    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    if (!filePath) {
      return this.formatError('path is required');
    }

    // Resolve the file path
    const resolvedPath = this.allowAbsolutePaths && filePath.startsWith('/')
      ? filePath
      : resolve(process.cwd(), filePath);

    // Check if path is allowed (if restrictions are set)
    if (this.allowedPaths.length > 0) {
      const isAllowed = this.allowedPaths.some(allowed =>
        resolvedPath.startsWith(resolve(process.cwd(), allowed))
      );
      if (!isAllowed) {
        return this.formatError(`Path not allowed: ${filePath}`);
      }
    }

    // Check if file exists
    if (!existsSync(resolvedPath)) {
      return this.formatError(`File not found: ${filePath}`);
    }

    try {
      // Check file size
      const stats = await stat(resolvedPath);
      if (stats.size > this.maxFileSize) {
        return this.formatError(
          `File too large: ${stats.size} bytes (max: ${this.maxFileSize} bytes)`
        );
      }

      // Read file content
      const content = await readFile(resolvedPath, 'utf-8');
      const fileName = alias || basename(resolvedPath);
      const extension = extname(resolvedPath).slice(1) || 'txt';

      // Get session and add to context
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        return this.formatError(`Session not found: ${sessionId}`);
      }

      // Check max files limit
      const currentFileCount = session.context?.files?.length || 0;
      if (currentFileCount >= this.maxFiles) {
        return this.formatError(
          `Maximum files reached: ${this.maxFiles}. Cannot add more files to context.`
        );
      }

      // Create file entry
      const fileEntry = {
        path: `runtime/${fileName}`,
        content,
        extension,
        size: stats.size,
        addedAt: new Date().toISOString(),
        source: 'read_file_tool',
        originalPath: filePath
      };

      // Add to session context
      if (!session.context) {
        session.context = { files: [], metadata: {} };
      }
      if (!session.context.files) {
        session.context.files = [];
      }

      // Check for duplicate (same path)
      const existingIndex = session.context.files.findIndex(
        f => f.path === fileEntry.path
      );
      if (existingIndex >= 0) {
        // Update existing
        session.context.files[existingIndex] = fileEntry;
      } else {
        // Add new
        session.context.files.push(fileEntry);
      }

      // Update formatted content
      session.context.formattedContent = this._formatContextAsXml(session.context.files);

      return this.formatResponse({
        success: true,
        action: 'read_file',
        file: {
          path: fileEntry.path,
          originalPath: filePath,
          size: stats.size,
          extension
        },
        contextFiles: session.context.files.length,
        message: `File added to session context: ${fileName}`
      });

    } catch (err) {
      return this.formatError(`Failed to read file: ${err.message}`);
    }
  }

  /**
   * List files in session context
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async list(args) {
    const { sessionId } = args;

    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return this.formatError(`Session not found: ${sessionId}`);
    }

    const files = session.context?.files || [];
    const runtimeFiles = files.filter(f => f.source === 'read_file_tool');

    return this.formatResponse({
      success: true,
      action: 'list',
      totalContextFiles: files.length,
      runtimeFiles: runtimeFiles.map(f => ({
        path: f.path,
        originalPath: f.originalPath,
        size: f.size,
        addedAt: f.addedAt
      }))
    });
  }

  /**
   * Remove a runtime file from context
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async remove(args) {
    const { sessionId, path: filePath } = args;

    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    if (!filePath) {
      return this.formatError('path is required');
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return this.formatError(`Session not found: ${sessionId}`);
    }

    const files = session.context?.files || [];
    const targetPath = filePath.startsWith('runtime/') ? filePath : `runtime/${filePath}`;
    const index = files.findIndex(f => f.path === targetPath);

    if (index < 0) {
      return this.formatError(`File not found in context: ${filePath}`);
    }

    // Only allow removing runtime files
    if (files[index].source !== 'read_file_tool') {
      return this.formatError('Cannot remove non-runtime context files');
    }

    const removed = files.splice(index, 1)[0];

    // Update formatted content
    session.context.formattedContent = this._formatContextAsXml(files);

    return this.formatResponse({
      success: true,
      action: 'remove',
      removed: {
        path: removed.path,
        originalPath: removed.originalPath
      },
      contextFiles: files.length,
      message: `File removed from context: ${removed.path}`
    });
  }

  /**
   * Format context files as XML
   * @param {Object[]} files
   * @returns {string}
   * @private
   */
  _formatContextAsXml(files) {
    const lines = ['<context>'];

    for (const file of files) {
      const ext = file.extension || 'txt';
      lines.push(`  <file path="${this._escapeXml(file.path)}" extension="${ext}">`);
      lines.push(`    <content><![CDATA[${file.content}]]></content>`);
      lines.push('  </file>');
    }

    lines.push('</context>');
    return lines.join('\n');
  }

  /**
   * Escape XML special characters
   * @param {string} str
   * @returns {string}
   * @private
   */
  _escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Format success response
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
   * Format error response
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message })
        }
      ],
      isError: true
    };
  }

  /**
   * Register tools with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    // Read file and add to context
    router.registerTool(
      'read_file',
      this.execute.bind(this),
      {
        name: 'read_file',
        description: `Read an external file and add its content to the session context for additional runtime context during task execution.

Use this tool when you need to:
- Import reference documentation into the session
- Add configuration files for context
- Include example files for comparison
- Load templates or snippets for use in other tasks

The file content becomes available to subsequent tasks in the same session.`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            },
            path: {
              type: 'string',
              description: 'Path to the file to read (relative to working directory or absolute)'
            },
            alias: {
              type: 'string',
              description: 'Optional alias name for the file in context (defaults to filename)'
            }
          },
          required: ['sessionId', 'path']
        }
      }
    );

    // List context files
    router.registerTool(
      'read_file_list',
      this.list.bind(this),
      {
        name: 'read_file_list',
        description: 'List all files in the session context, showing which were added via read_file tool',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            }
          },
          required: ['sessionId']
        }
      }
    );

    // Remove file from context
    router.registerTool(
      'read_file_remove',
      this.remove.bind(this),
      {
        name: 'read_file_remove',
        description: 'Remove a runtime-added file from the session context',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            },
            path: {
              type: 'string',
              description: 'Path of the file to remove (as shown in read_file_list)'
            }
          },
          required: ['sessionId', 'path']
        }
      }
    );
  }
}

/**
 * Create a ReadFileTool instance
 * @param {import('./session-manager.js').SessionManager} sessionManager
 * @param {Object} [config]
 * @returns {ReadFileTool}
 */
export function createReadFileTool(sessionManager, config) {
  return new ReadFileTool(sessionManager, config);
}

export default ReadFileTool;
