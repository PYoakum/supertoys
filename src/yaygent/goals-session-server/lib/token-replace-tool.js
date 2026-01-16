/**
 * @fileoverview Token Replacement Tool
 * @module token-replace-tool
 *
 * Reads a .yaymap file (key-value format like .env) and performs
 * string replacements in target files. Keys in the input file are
 * replaced by their corresponding values.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Parse .yaymap file format (similar to .env)
 * Supports:
 * - KEY=value
 * - KEY="quoted value"
 * - KEY='single quoted value'
 * - # comments
 * - Empty lines
 *
 * @param {string} content - File content
 * @returns {Map<string, string>} Key-value map
 */
function parseYaymap(content) {
  const map = new Map();
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Parse KEY=VALUE
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Handle escape sequences in double-quoted strings
    if (trimmed.slice(eqIndex + 1).trim().startsWith('"')) {
      value = value.replace(/\\n/g, '\n');
      value = value.replace(/\\t/g, '\t');
      value = value.replace(/\\r/g, '\r');
      value = value.replace(/\\\\/g, '\\');
    }

    if (key) {
      map.set(key, value);
    }
  }

  return map;
}

/**
 * Token Replacement Tool
 */
export class TokenReplaceTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for TokenReplaceTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {string} */
    this.defaultDelimiter = config.delimiter || '{{}}';

    /** @type {boolean} */
    this.caseSensitive = config.caseSensitive !== false;
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      mapPath,
      inputPath,
      outputPath,
      inputContent,
      delimiter = this.defaultDelimiter,
      caseSensitive = this.caseSensitive,
      additionalTokens = {}
    } = args;

    // Validate required fields
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!mapPath && Object.keys(additionalTokens).length === 0) {
      return this.formatError('Either mapPath or additionalTokens is required');
    }

    if (!inputPath && !inputContent) {
      return this.formatError('Either inputPath or inputContent is required');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);

    try {
      // Load token map from .yaymap file
      let tokenMap = new Map();

      if (mapPath) {
        const absMapPath = join(sandboxPath, mapPath);

        if (!existsSync(absMapPath)) {
          return this.formatError(`Map file not found: ${mapPath}`);
        }

        const mapContent = await readFile(absMapPath, 'utf-8');
        tokenMap = parseYaymap(mapContent);
      }

      // Add/override with additional tokens
      for (const [key, value] of Object.entries(additionalTokens)) {
        tokenMap.set(key, value);
      }

      // Get input content
      let content;
      if (inputPath) {
        const absInputPath = join(sandboxPath, inputPath);

        if (!existsSync(absInputPath)) {
          return this.formatError(`Input file not found: ${inputPath}`);
        }

        content = await readFile(absInputPath, 'utf-8');
      } else {
        content = inputContent;
      }

      // Parse delimiter format (e.g., "{{}}" -> prefix "{{", suffix "}}")
      let prefix, suffix;
      if (delimiter.length % 2 === 0) {
        const half = delimiter.length / 2;
        prefix = delimiter.slice(0, half);
        suffix = delimiter.slice(half);
      } else {
        // Odd length - use entire string as both prefix and suffix
        prefix = delimiter;
        suffix = delimiter;
      }

      // Perform replacements
      let result = content;
      let replacementCount = 0;
      const replacements = [];

      for (const [key, value] of tokenMap) {
        const pattern = caseSensitive
          ? `${escapeRegex(prefix)}${escapeRegex(key)}${escapeRegex(suffix)}`
          : `${escapeRegex(prefix)}${escapeRegex(key)}${escapeRegex(suffix)}`;

        const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
        const matches = result.match(regex);

        if (matches && matches.length > 0) {
          result = result.replace(regex, value);
          replacementCount += matches.length;
          replacements.push({
            key,
            pattern: `${prefix}${key}${suffix}`,
            count: matches.length
          });
        }
      }

      // Write output if outputPath specified
      let outputWritten = false;
      if (outputPath) {
        const absOutputPath = join(sandboxPath, outputPath);
        await writeFile(absOutputPath, result, 'utf-8');
        outputWritten = true;
      } else if (inputPath && !inputContent) {
        // Overwrite input file if no output path and input was a file
        const absInputPath = join(sandboxPath, inputPath);
        await writeFile(absInputPath, result, 'utf-8');
        outputWritten = true;
      }

      return this.formatResponse({
        success: true,
        tokenCount: tokenMap.size,
        replacementCount,
        replacements,
        outputPath: outputPath || inputPath || '(in-memory)',
        outputWritten,
        resultLength: result.length,
        // Include result content if not written to file
        result: outputWritten ? undefined : result,
        sandboxPath
      });
    } catch (err) {
      return this.formatError(`Token replacement failed: ${err.message}`);
    }
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
    router.registerTool(
      'token_replace',
      this.execute.bind(this),
      {
        name: 'token_replace',
        description: 'Read a .yaymap file (KEY=value format) and perform string replacements in a target file or content. Tokens in the format {{KEY}} (or custom delimiter) are replaced with their values. Useful for template processing and configuration injection.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            mapPath: {
              type: 'string',
              description: 'Path to .yaymap file containing KEY=value pairs (relative to sandbox)'
            },
            inputPath: {
              type: 'string',
              description: 'Path to input file to process (relative to sandbox)'
            },
            outputPath: {
              type: 'string',
              description: 'Path for output file (optional, defaults to overwriting input file)'
            },
            inputContent: {
              type: 'string',
              description: 'Input content as string (alternative to inputPath)'
            },
            delimiter: {
              type: 'string',
              default: '{{}}',
              description: 'Token delimiter format. First half is prefix, second half is suffix. E.g., "{{}}" means {{KEY}}, "$$" means $KEY$'
            },
            caseSensitive: {
              type: 'boolean',
              default: true,
              description: 'Whether token matching is case-sensitive'
            },
            additionalTokens: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Additional key-value pairs to use (merged with .yaymap file)'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Escape special regex characters
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a TokenReplaceTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {TokenReplaceTool}
 */
export function createTokenReplaceTool(sandboxManager, config) {
  return new TokenReplaceTool(sandboxManager, config);
}

export default TokenReplaceTool;
