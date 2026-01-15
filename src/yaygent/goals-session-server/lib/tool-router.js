/**
 * @fileoverview Tool Router integration for the Goals Session Server
 * @module tool-router
 */

import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { SandboxManager } from './sandbox-manager.js';
import { CodeEditorTool } from './code-editor-tool.js';
import { FileCreateTool } from './file-create-tool.js';
import { JavaScriptExecuteTool } from './javascript-execute-tool.js';
import { SQLiteTool } from './sqlite-tool.js';
import { HttpRequestTool } from './http-request-tool.js';
import { TcpConnectTool } from './tcp-connect-tool.js';
import { BrowserRequestTool } from './browser-request-tool.js';

/**
 * Tool Router Class
 * Manages available tools and provides manifest for task binding
 */
export class ToolRouter {
  constructor() {
    /** @type {Map<string, {handler: Function, schema: Object}>} */
    this.tools = new Map();
  }

  /**
   * Register a tool
   * @param {string} name - Tool name
   * @param {Function} handler - Tool handler function
   * @param {Object} schema - Tool schema
   */
  registerTool(name, handler, schema) {
    this.tools.set(name, { handler, schema });
  }

  /**
   * Get a tool by name
   * @param {string} name - Tool name
   * @returns {Object|undefined}
   */
  getTool(name) {
    return this.tools.get(name);
  }

  /**
   * Get all tool schemas
   * @returns {Object[]}
   */
  getAllTools() {
    return Array.from(this.tools.values()).map(tool => tool.schema);
  }

  /**
   * Execute a tool
   * @param {string} name - Tool name
   * @param {Object} args - Tool arguments
   * @returns {Promise<Object>}
   */
  async executeTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.handler(args);
  }

  /**
   * Check if a tool exists
   * @param {string} name - Tool name
   * @returns {boolean}
   */
  hasTool(name) {
    return this.tools.has(name);
  }

  /**
   * Get tool manifest for LLM consumption
   * @returns {Object}
   */
  getManifest() {
    return {
      serverName: 'goals-session-server',
      serverVersion: '1.0.0',
      tools: this.getAllTools(),
      toolCount: this.tools.size
    };
  }
}

/**
 * Notepad Tool Implementation
 * Provides file creation, reading, writing capabilities
 */
export class NotepadTool {
  /**
   * @param {string} [baseDir='./notes'] - Base directory for notes
   */
  constructor(baseDir = './notes') {
    /** @type {string} */
    this.baseDir = baseDir;
    this.ensureBaseDir();
  }

  /**
   * Ensure base directory exists
   * @private
   */
  async ensureBaseDir() {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  /**
   * Get safe file path
   * @param {string} filename
   * @returns {string}
   * @private
   */
  getFilePath(filename) {
    // Sanitize filename to prevent directory traversal
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.baseDir, safeName);
  }

  /**
   * Create a new note
   * @param {Object} args
   * @param {string} args.filename - Note filename
   * @param {string} [args.content] - Initial content
   * @returns {Promise<Object>}
   */
  async create(args) {
    const { filename, content } = args;
    if (!filename) {
      throw new Error('filename is required');
    }

    const filePath = this.getFilePath(filename);
    await this.ensureBaseDir();
    await writeFile(filePath, content || '', 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: `Successfully created note: ${filename}\nPath: ${filePath}`
        }
      ]
    };
  }

  /**
   * Write or append to a note
   * @param {Object} args
   * @param {string} args.filename - Note filename
   * @param {string} args.content - Content to write
   * @param {boolean} [args.append=false] - Append to existing content
   * @returns {Promise<Object>}
   */
  async write(args) {
    const { filename, content, append = false } = args;
    if (!filename) {
      throw new Error('filename is required');
    }
    if (content === undefined) {
      throw new Error('content is required');
    }

    const filePath = this.getFilePath(filename);

    if (append && existsSync(filePath)) {
      const existing = await readFile(filePath, 'utf-8');
      await writeFile(filePath, existing + content, 'utf-8');
    } else {
      await writeFile(filePath, content, 'utf-8');
    }

    return {
      content: [
        {
          type: 'text',
          text: `Successfully ${append ? 'appended to' : 'wrote'} note: ${filename}`
        }
      ]
    };
  }

  /**
   * Read a note
   * @param {Object} args
   * @param {string} args.filename - Note filename
   * @returns {Promise<Object>}
   */
  async read(args) {
    const { filename } = args;
    if (!filename) {
      throw new Error('filename is required');
    }

    const filePath = this.getFilePath(filename);
    if (!existsSync(filePath)) {
      throw new Error(`Note not found: ${filename}`);
    }

    const content = await readFile(filePath, 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: content
        }
      ]
    };
  }

  /**
   * List all notes
   * @returns {Promise<Object>}
   */
  async list() {
    await this.ensureBaseDir();
    const files = await readdir(this.baseDir);
    const fileList = files.join('\n');

    return {
      content: [
        {
          type: 'text',
          text: fileList || 'No notes found'
        }
      ]
    };
  }

  /**
   * Delete a note
   * @param {Object} args
   * @param {string} args.filename - Note filename
   * @returns {Promise<Object>}
   */
  async delete(args) {
    const { filename } = args;
    if (!filename) {
      throw new Error('filename is required');
    }

    const filePath = this.getFilePath(filename);
    if (!existsSync(filePath)) {
      throw new Error(`Note not found: ${filename}`);
    }

    // Use fs/promises unlink which works in both Node.js and Bun
    const { unlink } = await import('fs/promises');
    await unlink(filePath);

    return {
      content: [
        {
          type: 'text',
          text: `Successfully deleted note: ${filename}`
        }
      ]
    };
  }

  /**
   * Register all notepad tools with the router
   * @param {ToolRouter} router
   */
  registerTools(router) {
    // Create note
    router.registerTool(
      'notepad_create',
      this.create.bind(this),
      {
        name: 'notepad_create',
        description: 'Create a new note file',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name of the note file'
            },
            content: {
              type: 'string',
              description: 'Initial content of the note (optional)'
            }
          },
          required: ['filename']
        }
      }
    );

    // Write to note
    router.registerTool(
      'notepad_write',
      this.write.bind(this),
      {
        name: 'notepad_write',
        description: 'Write or append content to a note',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name of the note file'
            },
            content: {
              type: 'string',
              description: 'Content to write'
            },
            append: {
              type: 'boolean',
              description: 'Whether to append to existing content (default: false)'
            }
          },
          required: ['filename', 'content']
        }
      }
    );

    // Read note
    router.registerTool(
      'notepad_read',
      this.read.bind(this),
      {
        name: 'notepad_read',
        description: 'Read the content of a note',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name of the note file to read'
            }
          },
          required: ['filename']
        }
      }
    );

    // List notes
    router.registerTool(
      'notepad_list',
      this.list.bind(this),
      {
        name: 'notepad_list',
        description: 'List all available notes',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    );

    // Delete note
    router.registerTool(
      'notepad_delete',
      this.delete.bind(this),
      {
        name: 'notepad_delete',
        description: 'Delete a note file',
        inputSchema: {
          type: 'object',
          properties: {
            filename: {
              type: 'string',
              description: 'Name of the note file to delete'
            }
          },
          required: ['filename']
        }
      }
    );
  }
}

/**
 * Create and initialize the tool router with default tools
 * @param {Object} [options={}]
 * @param {string} [options.notepadDir='./notes']
 * @param {string} [options.sandboxDir='./sandbox']
 * @param {string[]} [options.httpAllowedHosts=[]] - Allowed hosts for http_request
 * @param {number} [options.httpTimeout=30000] - Default timeout for http_request
 * @param {number} [options.httpMaxResponseSize] - Max response size for http_request
 * @param {string[]} [options.tcpAllowedHosts=[]] - Allowed hosts for tcp_connect
 * @param {number[]} [options.tcpAllowedPorts=[]] - Allowed ports for tcp_connect
 * @param {number} [options.tcpTimeout=10000] - Default timeout for tcp_connect
 * @param {string[]} [options.browserAllowedHosts=[]] - Allowed hosts for browser_request
 * @param {number} [options.browserTimeout=30000] - Default timeout for browser_request
 * @param {boolean} [options.browserHeadless=true] - Run browser in headless mode
 * @returns {ToolRouter}
 */
export function createToolRouter(options = {}) {
  const router = new ToolRouter();

  // Initialize and register notepad tool
  const notepad = new NotepadTool(options.notepadDir || './notes');
  notepad.registerTools(router);

  // Initialize sandbox manager (shared by code_editor, file_create, javascript_execute)
  const sandboxManager = new SandboxManager({
    baseDir: options.sandboxDir || './sandbox',
    maxFileSize: options.maxFileSize,
    maxTotalSize: options.maxTotalSize
  });

  // Initialize and register code editor tool
  const codeEditor = new CodeEditorTool(sandboxManager);
  codeEditor.registerTools(router);

  // Initialize and register file create tool
  const fileCreate = new FileCreateTool(sandboxManager, {
    allowedStreamHosts: options.allowedStreamHosts || ['*'],
    maxStreamSize: options.maxStreamSize
  });
  fileCreate.registerTools(router);

  // Initialize and register JavaScript execute tool
  const jsExecute = new JavaScriptExecuteTool(sandboxManager, {
    nodeEnabled: options.nodeEnabled !== false,
    bunEnabled: options.bunEnabled !== false,
    workerdEnabled: options.workerdEnabled !== false
  });
  jsExecute.registerTools(router);

  // Initialize and register SQLite tools
  const sqliteTool = new SQLiteTool(sandboxManager, {
    maxResultRows: options.maxResultRows || 1000,
    queryTimeout: options.queryTimeout || 30000
  });
  sqliteTool.registerTools(router);

  // Initialize and register HTTP request tool
  const httpRequest = new HttpRequestTool({
    allowedHosts: options.httpAllowedHosts || [],
    defaultTimeout: options.httpTimeout || 30000,
    maxResponseSize: options.httpMaxResponseSize || 10 * 1024 * 1024
  });
  httpRequest.registerTools(router);

  // Initialize and register TCP connect tool
  const tcpConnect = new TcpConnectTool({
    allowedHosts: options.tcpAllowedHosts || [],
    allowedPorts: options.tcpAllowedPorts || [],
    defaultTimeout: options.tcpTimeout || 10000
  });
  tcpConnect.registerTools(router);

  // Initialize and register browser request tool
  const browserRequest = new BrowserRequestTool({
    allowedHosts: options.browserAllowedHosts || [],
    defaultTimeout: options.browserTimeout || 30000,
    headless: options.browserHeadless !== false
  });
  browserRequest.registerTools(router);

  // Store sandbox manager reference for other tools to use
  router.sandboxManager = sandboxManager;

  return router;
}

export default { ToolRouter, NotepadTool, CodeEditorTool, FileCreateTool, JavaScriptExecuteTool, SQLiteTool, HttpRequestTool, TcpConnectTool, BrowserRequestTool, SandboxManager, createToolRouter };
