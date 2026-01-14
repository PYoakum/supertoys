/**
 * @fileoverview File Create Tool for creating files from various input types
 * @module file-create-tool
 */

import { writeFile, stat, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';

/**
 * @typedef {Object} FileCreateOptions
 * @property {boolean} [overwrite=false] - Overwrite if file exists
 * @property {boolean} [createDirectories=true] - Create parent directories
 * @property {string} [mode='0644'] - File permissions (octal)
 * @property {number} [jsonIndent=2] - JSON indentation spaces
 */

/**
 * @typedef {Object} StreamOptions
 * @property {string} url - URL to fetch content from
 * @property {Object} [headers] - HTTP headers for URL fetch
 * @property {number} [maxSize] - Maximum bytes to read from stream
 * @property {number} [timeout=30000] - Stream timeout in milliseconds
 */

/**
 * File Create Tool for creating files from various input types
 */
export class FileCreateTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   * @param {string[]} [config.allowedStreamHosts] - Allowlist of hosts for stream URLs
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for FileCreateTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {string[]} */
    this.allowedStreamHosts = config.allowedStreamHosts || ['*'];

    /** @type {number} */
    this.defaultStreamTimeout = config.defaultStreamTimeout || 30000;

    /** @type {number} */
    this.maxStreamSize = config.maxStreamSize || 10 * 1024 * 1024; // 10MB
  }

  /**
   * Main entry point - create a file from various input types
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const {
      sessionId,
      path,
      inputType = 'string',
      data,
      options = {},
      streamOptions
    } = args;

    if (!path) {
      throw new Error('path is required');
    }
    if (data === undefined && inputType !== 'stream') {
      throw new Error('data is required');
    }
    if (inputType === 'stream' && !streamOptions?.url) {
      throw new Error('streamOptions.url is required for stream input type');
    }

    // Resolve path within sandbox
    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    // Check if file exists
    const fileExists = existsSync(absPath);
    if (fileExists && !options.overwrite) {
      const error = new Error(`File already exists: ${path}`);
      error.code = 'FILE_EXISTS';
      throw error;
    }

    // Get content based on input type
    let buffer;
    switch (inputType) {
      case 'string':
        buffer = this.processString(data);
        break;
      case 'buffer':
        buffer = this.processBuffer(data);
        break;
      case 'base64':
        buffer = this.processBase64(data);
        break;
      case 'json':
        buffer = this.processJson(data, options.jsonIndent);
        break;
      case 'stream':
        buffer = await this.processStream(streamOptions);
        break;
      default:
        throw new Error(`Unknown input type: ${inputType}. Valid types: string, buffer, base64, json, stream`);
    }

    // Validate size
    this.sandboxManager.validateFileSize(buffer.length, sessionId);

    // Ensure parent directory exists
    if (options.createDirectories !== false) {
      await this.sandboxManager.ensureParentDir(absPath);
    }

    // Write file
    await writeFile(absPath, buffer);

    // Set permissions if specified
    if (options.mode) {
      const mode = parseInt(options.mode, 8);
      await chmod(absPath, mode);
    }

    // Update size tracking
    const existingSize = fileExists ? (await stat(absPath).catch(() => ({ size: 0 }))).size : 0;
    this.sandboxManager.updateSandboxSize(sessionId, buffer.length - existingSize);

    // Calculate checksum
    const checksum = this.calculateChecksum(buffer);

    const stats = await stat(absPath);

    return this.formatResponse({
      success: true,
      path,
      size: stats.size,
      checksum: `sha256:${checksum}`,
      created: stats.birthtime.toISOString(),
      inputType
    });
  }

  /**
   * Process string input
   * @param {string} data
   * @returns {Buffer}
   */
  processString(data) {
    if (typeof data !== 'string') {
      throw new Error('Data must be a string for inputType "string"');
    }
    return Buffer.from(data, 'utf-8');
  }

  /**
   * Process buffer input (array of bytes)
   * @param {number[]} data
   * @returns {Buffer}
   */
  processBuffer(data) {
    if (!Array.isArray(data)) {
      throw new Error('Data must be an array of bytes for inputType "buffer"');
    }
    // Validate each byte is 0-255
    for (let i = 0; i < data.length; i++) {
      if (typeof data[i] !== 'number' || data[i] < 0 || data[i] > 255) {
        throw new Error(`Invalid byte value at index ${i}: ${data[i]}`);
      }
    }
    return Buffer.from(data);
  }

  /**
   * Process base64 input
   * @param {string} data
   * @returns {Buffer}
   */
  processBase64(data) {
    if (typeof data !== 'string') {
      throw new Error('Data must be a base64 string for inputType "base64"');
    }
    // Validate base64 format
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(data)) {
      throw new Error('Invalid base64 encoding');
    }
    return Buffer.from(data, 'base64');
  }

  /**
   * Process JSON input
   * @param {Object} data
   * @param {number} [indent=2]
   * @returns {Buffer}
   */
  processJson(data, indent = 2) {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Data must be an object for inputType "json"');
    }
    const jsonStr = JSON.stringify(data, null, indent);
    return Buffer.from(jsonStr, 'utf-8');
  }

  /**
   * Process stream input (fetch from URL)
   * @param {StreamOptions} streamOptions
   * @returns {Promise<Buffer>}
   */
  async processStream(streamOptions) {
    const { url, headers = {}, maxSize, timeout } = streamOptions;

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Check allowlist
    if (!this.isHostAllowed(parsedUrl.hostname)) {
      const error = new Error(`Host not allowed: ${parsedUrl.hostname}`);
      error.code = 'STREAM_HOST_NOT_ALLOWED';
      throw error;
    }

    // Fetch with timeout
    const controller = new AbortController();
    const timeoutMs = timeout || this.defaultStreamTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
      }

      // Check content-length if available
      const contentLength = response.headers.get('content-length');
      const effectiveMaxSize = maxSize || this.maxStreamSize;

      if (contentLength && parseInt(contentLength, 10) > effectiveMaxSize) {
        throw new Error(`Content too large: ${contentLength} bytes exceeds max ${effectiveMaxSize} bytes`);
      }

      // Read response with size limit
      const chunks = [];
      let totalSize = 0;

      // Use arrayBuffer for simplicity (works in both Node and Bun)
      const arrayBuffer = await response.arrayBuffer();
      totalSize = arrayBuffer.byteLength;

      if (totalSize > effectiveMaxSize) {
        throw new Error(`Content too large: ${totalSize} bytes exceeds max ${effectiveMaxSize} bytes`);
      }

      return Buffer.from(arrayBuffer);
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        const error = new Error(`Stream timeout after ${timeoutMs}ms`);
        error.code = 'STREAM_TIMEOUT';
        throw error;
      }

      const error = new Error(`Stream error: ${err.message}`);
      error.code = 'STREAM_ERROR';
      throw error;
    }
  }

  /**
   * Check if host is in allowlist
   * @param {string} hostname
   * @returns {boolean}
   */
  isHostAllowed(hostname) {
    if (this.allowedStreamHosts.includes('*')) {
      return true;
    }
    return this.allowedStreamHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        // Wildcard subdomain matching
        const domain = allowed.slice(2);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === allowed;
    });
  }

  /**
   * Calculate SHA256 checksum
   * @param {Buffer} buffer
   * @returns {string}
   */
  calculateChecksum(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
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
      'file_create',
      this.execute.bind(this),
      {
        name: 'file_create',
        description: 'Create files from various input types (string, buffer, base64, json, stream/URL) in the sandbox.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional, uses "default" if not provided)'
            },
            path: {
              type: 'string',
              description: 'Relative path for the new file within the sandbox'
            },
            inputType: {
              type: 'string',
              enum: ['string', 'buffer', 'base64', 'json', 'stream'],
              default: 'string',
              description: 'Type of input data'
            },
            data: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 } },
                { type: 'object' }
              ],
              description: 'The content to write (string for string/base64, array for buffer, object for json)'
            },
            options: {
              type: 'object',
              description: 'File creation options',
              properties: {
                overwrite: {
                  type: 'boolean',
                  default: false,
                  description: 'Overwrite if file exists'
                },
                createDirectories: {
                  type: 'boolean',
                  default: true,
                  description: 'Create parent directories if needed'
                },
                mode: {
                  type: 'string',
                  pattern: '^[0-7]{3,4}$',
                  default: '0644',
                  description: 'File permissions (octal)'
                },
                jsonIndent: {
                  type: 'integer',
                  minimum: 0,
                  maximum: 8,
                  default: 2,
                  description: 'JSON indentation spaces (for json inputType)'
                }
              }
            },
            streamOptions: {
              type: 'object',
              description: 'Options for stream input type',
              properties: {
                url: {
                  type: 'string',
                  format: 'uri',
                  description: 'URL to fetch content from'
                },
                headers: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                  description: 'HTTP headers for URL fetch'
                },
                maxSize: {
                  type: 'integer',
                  description: 'Maximum bytes to read from stream'
                },
                timeout: {
                  type: 'integer',
                  default: 30000,
                  description: 'Stream timeout in milliseconds'
                }
              }
            }
          },
          required: ['path']
        }
      }
    );
  }
}

/**
 * Create a FileCreateTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {FileCreateTool}
 */
export function createFileCreateTool(sandboxManager, config) {
  return new FileCreateTool(sandboxManager, config);
}

export default FileCreateTool;
