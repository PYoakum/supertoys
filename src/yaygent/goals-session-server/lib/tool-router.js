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
import { MakeGoalsTool } from './make-goals-tool.js';
import { BashCommandTool } from './bash-command-tool.js';
import { PythonRunnerTool } from './python-runner-tool.js';
import { NetToolsTool } from './net-tools-tool.js';
import { ProjectScaffoldTool } from './project-scaffold-tool.js';
import { FrameworkExecTool } from './framework-exec-tool.js';
import { DocxMdTool } from './docx-md-tool.js';
import { TokenReplaceTool } from './token-replace-tool.js';
import { MdDocxTool } from './md-docx-tool.js';
import { PdfExportTool } from './pdf-export-tool.js';
import { ComposeEmailTool } from './compose-email-tool.js';
import { GolangExecTool } from './golang-exec-tool.js';
import { ContextResearchBrowserTool } from './context-research-browser-tool.js';
import { TablemakerTool } from './tablemaker-tool.js';
import { PersonaComposeTool } from './persona-compose-tool.js';
import { ReadFileTool } from './read-file-tool.js';

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
   * @param {string} [sessionId] - Optional session ID for session-specific directory
   * @private
   */
  async ensureBaseDir(sessionId) {
    const dir = sessionId ? join(this.baseDir, sessionId) : this.baseDir;
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Get safe file path
   * @param {string} filename
   * @param {string} [sessionId] - Optional session ID for session-specific storage
   * @returns {string}
   * @private
   */
  getFilePath(filename, sessionId) {
    // Sanitize filename to prevent directory traversal
    let safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Auto-add .txt extension if no extension present
    if (!safeName.includes('.')) {
      safeName += '.txt';
    }
    const dir = sessionId ? join(this.baseDir, sessionId) : this.baseDir;
    return join(dir, safeName);
  }

  /**
   * Create a new note
   * @param {Object} args
   * @param {string} args.filename - Note filename
   * @param {string} [args.content] - Initial content
   * @param {string} [args.sessionId] - Session ID for isolation
   * @returns {Promise<Object>}
   */
  async create(args) {
    const { filename, content, sessionId } = args;
    if (!filename) {
      throw new Error('filename is required');
    }

    const filePath = this.getFilePath(filename, sessionId);
    await this.ensureBaseDir(sessionId);
    await writeFile(filePath, content || '', 'utf-8');

    return {
      content: [
        {
          type: 'text',
          text: `Successfully created note: ${filename}${sessionId ? ` (session: ${sessionId.slice(0, 8)}...)` : ''}`
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
   * @param {string} [args.sessionId] - Session ID for isolation
   * @returns {Promise<Object>}
   */
  async write(args) {
    const { filename, content, append = false, sessionId } = args;
    if (!filename) {
      throw new Error('filename is required');
    }
    if (content === undefined) {
      throw new Error('content is required');
    }

    await this.ensureBaseDir(sessionId);
    const filePath = this.getFilePath(filename, sessionId);

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
   * @param {string} [args.sessionId] - Session ID for isolation
   * @returns {Promise<Object>}
   */
  async read(args) {
    const { filename, sessionId } = args;
    if (!filename) {
      throw new Error('filename is required');
    }

    const filePath = this.getFilePath(filename, sessionId);
    if (!existsSync(filePath)) {
      throw new Error(`Note not found: ${filename}${sessionId ? ` (session: ${sessionId.slice(0, 8)}...)` : ''}`);
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
   * @param {Object} [args]
   * @param {string} [args.sessionId] - Session ID for isolation
   * @returns {Promise<Object>}
   */
  async list(args = {}) {
    const { sessionId } = args;
    const dir = await this.ensureBaseDir(sessionId);
    const files = await readdir(dir);
    // Filter out directories (session subdirs) if listing root
    const noteFiles = [];
    for (const file of files) {
      const filePath = join(dir, file);
      const stats = await import('fs').then(fs => fs.statSync(filePath));
      if (stats.isFile()) {
        noteFiles.push(file);
      }
    }
    const fileList = noteFiles.join('\n');

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
   * @param {string} [args.sessionId] - Session ID for isolation
   * @returns {Promise<Object>}
   */
  async delete(args) {
    const { filename, sessionId } = args;
    if (!filename) {
      throw new Error('filename is required');
    }

    const filePath = this.getFilePath(filename, sessionId);
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
        description: 'Create a new note file. Notes are session-scoped when sessionId is provided.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for note isolation (notes are stored per-session)'
            },
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
        description: 'Write or append content to a note. Notes are session-scoped when sessionId is provided.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for note isolation (notes are stored per-session)'
            },
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
        description: 'Read the content of a note. Notes are session-scoped when sessionId is provided.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for note isolation (notes are stored per-session)'
            },
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
        description: 'List all available notes in the session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for note isolation (lists notes in the session)'
            }
          }
        }
      }
    );

    // Delete note
    router.registerTool(
      'notepad_delete',
      this.delete.bind(this),
      {
        name: 'notepad_delete',
        description: 'Delete a note file.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for note isolation'
            },
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
 * @param {import('./llm-client.js').LLMClient} [options.llmClient] - LLM client for make_goals tool
 * @param {number} [options.makeGoalsMaxTokens=8192] - Max tokens for make_goals LLM response
 * @param {number} [options.makeGoalsTemperature=0.3] - Temperature for make_goals LLM
 * @param {boolean} [options.bashEnabled=true] - Enable bash_command tool
 * @param {boolean} [options.bashAllowSudo=false] - Allow sudo in bash commands
 * @param {string[]} [options.bashAllowedCommands] - Allowlist of bash commands (null = all)
 * @param {boolean} [options.pythonEnabled=true] - Enable python_runner tool
 * @param {string} [options.pythonPath='python3'] - Path to Python executable
 * @param {string[]} [options.pythonAllowedPackages] - Allowlist of pip packages (null = all)
 * @param {boolean} [options.netToolsEnabled=true] - Enable net_tools tool
 * @param {string[]} [options.netToolsAllowedHosts=[]] - Allowed hosts for network tools
 * @param {boolean} [options.netToolsAllowAllHosts=false] - Allow all hosts for network tools
 * @param {boolean} [options.netToolsCaptureEnabled=false] - Enable packet capture
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

  // Initialize and register make_goals tool (requires llmClient)
  if (options.llmClient) {
    const makeGoals = new MakeGoalsTool(options.llmClient, sandboxManager, {
      maxTokens: options.makeGoalsMaxTokens || 8192,
      temperature: options.makeGoalsTemperature || 0.3
    });
    makeGoals.registerTools(router);
  }

  // Initialize and register bash_command tool
  if (options.bashEnabled !== false) {
    const bashCommand = new BashCommandTool(sandboxManager, {
      allowSudo: options.bashAllowSudo === true,
      allowedCommands: options.bashAllowedCommands || null
    });
    bashCommand.registerTools(router);
  }

  // Initialize and register python_runner tool
  if (options.pythonEnabled !== false) {
    const pythonRunner = new PythonRunnerTool(sandboxManager, {
      pythonPath: options.pythonPath || 'python3',
      pipPackages: options.pythonAllowedPackages || []
    });
    pythonRunner.registerTools(router);
  }

  // Initialize and register net_tools tool
  if (options.netToolsEnabled !== false) {
    const netTools = new NetToolsTool(sandboxManager, {
      allowedHosts: options.netToolsAllowedHosts || [],
      allowAllHosts: options.netToolsAllowAllHosts === true,
      captureEnabled: options.netToolsCaptureEnabled === true
    });
    netTools.registerTools(router);
  }

  // Initialize and register project scaffold tool
  const projectScaffold = new ProjectScaffoldTool(sandboxManager, {
    timeout: options.scaffoldTimeout || 300000,
    preferredRuntime: options.scaffoldRuntime || 'bun'
  });
  projectScaffold.registerTools(router);

  // Initialize and register framework execution tool (Bun-based)
  const frameworkExec = new FrameworkExecTool(sandboxManager, {
    timeout: options.frameworkExecTimeout || 120000
  });
  frameworkExec.registerTools(router);

  // Initialize and register document conversion tools
  const docxMd = new DocxMdTool(sandboxManager, {
    extractImages: options.docxExtractImages !== false
  });
  docxMd.registerTools(router);

  const mdDocx = new MdDocxTool(sandboxManager, {
    defaultFont: options.docxDefaultFont || 'Arial'
  });
  mdDocx.registerTools(router);

  // Initialize and register token replacement tool
  const tokenReplace = new TokenReplaceTool(sandboxManager, {
    delimiter: options.tokenDelimiter || '{{}}'
  });
  tokenReplace.registerTools(router);

  // Initialize and register PDF export tool
  const pdfExport = new PdfExportTool(sandboxManager, {
    fontSize: options.pdfFontSize || 12,
    pageSize: options.pdfPageSize || 'letter'
  });
  pdfExport.registerTools(router);

  // Initialize and register email composition tool
  // Pass notepad tool for cross-tool access (email_draft can be read via notepad_read)
  const composeEmail = new ComposeEmailTool(sandboxManager, {
    defaultAddresses: options.emailPlaceholders,
    notepadTool: notepad
  });
  composeEmail.registerTools(router);

  // Initialize and register Go execution tool
  const golangExec = new GolangExecTool(sandboxManager, {
    goPath: options.goPath || 'go',
    allowCGO: options.allowCGO === true
  });
  golangExec.registerTools(router);

  // Initialize and register context research browser tool
  const contextResearchBrowser = new ContextResearchBrowserTool(
    sandboxManager,
    options.sessionManager || null,
    {
      allowedHosts: options.researchAllowedHosts || ['*'],
      timeout: options.researchTimeout || 30000
    }
  );
  contextResearchBrowser.registerTools(router);

  // Initialize and register tablemaker tool
  const tablemaker = new TablemakerTool(sandboxManager);
  tablemaker.registerTools(router);

  // Initialize and register persona compose tool
  const personaCompose = new PersonaComposeTool(
    sandboxManager,
    options.llmClient || null,
    {
      defaultPersonasFile: options.personasFile || 'PERSONAS.yml',
      maxPersonasFileSize: options.maxPersonasFileSize || 1048576,
      maxOutputSize: options.maxOutputSize || 102400
    }
  );
  personaCompose.registerTools(router);

  // Initialize and register read file tool (requires sessionManager)
  if (options.sessionManager) {
    const readFile = new ReadFileTool(options.sessionManager, {
      maxFileSize: options.readFileMaxSize || 1024 * 1024,
      maxFiles: options.readFileMaxFiles || 50,
      allowedPaths: options.readFileAllowedPaths || [],
      allowAbsolutePaths: options.readFileAllowAbsolutePaths !== false
    });
    readFile.registerTools(router);
  }

  // Store sandbox manager reference for other tools to use
  router.sandboxManager = sandboxManager;

  return router;
}

export default { ToolRouter, NotepadTool, CodeEditorTool, FileCreateTool, JavaScriptExecuteTool, SQLiteTool, HttpRequestTool, TcpConnectTool, BrowserRequestTool, MakeGoalsTool, BashCommandTool, PythonRunnerTool, NetToolsTool, ProjectScaffoldTool, FrameworkExecTool, DocxMdTool, TokenReplaceTool, MdDocxTool, PdfExportTool, ComposeEmailTool, GolangExecTool, ContextResearchBrowserTool, TablemakerTool, PersonaComposeTool, ReadFileTool, SandboxManager, createToolRouter };
