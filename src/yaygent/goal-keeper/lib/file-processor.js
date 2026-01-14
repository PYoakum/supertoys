/**
 * @fileoverview File Processor for validating and processing goals files
 * @module file-processor
 */

import { readFile, rename, mkdir, writeFile } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { existsSync } from 'fs';
import { decode as toonDecode } from '@toon-format/toon';
import { FileValidationError, ProcessingError } from './errors.js';

/**
 * @typedef {Object} ProcessorOptions
 * @property {string} [processedDir] - Directory for processed files
 * @property {string} [failedDir] - Directory for failed files
 * @property {boolean} [moveProcessed=true] - Move files after processing
 * @property {boolean} [includeContext=true] - Look for context directory
 * @property {string} [contextDirName='context'] - Name of context directory
 */

/**
 * @typedef {Object} GoalsPayload
 * @property {Object} goals - Parsed goals object
 * @property {Object} context - Context bundle
 * @property {string} sourcePath - Original file path
 */

/**
 * File Processor class
 */
export class FileProcessor {
  /**
   * @param {ProcessorOptions} [options={}]
   */
  constructor(options = {}) {
    this.processedDir = options.processedDir || '_processed';
    this.failedDir = options.failedDir || '_failed';
    this.moveProcessed = options.moveProcessed !== false;
    this.includeContext = options.includeContext !== false;
    this.contextDirName = options.contextDirName || 'context';
  }

  /**
   * Process a goals file (JSON or TOON/Markdown)
   * @param {string} filePath
   * @returns {Promise<GoalsPayload>}
   */
  async process(filePath) {
    // Validate file exists
    if (!existsSync(filePath)) {
      throw new FileValidationError('File not found', filePath);
    }

    // Read file content
    const content = await readFile(filePath, 'utf-8');
    const ext = extname(filePath).toLowerCase();

    // Parse based on file type
    let goals;
    try {
      if (ext === '.md') {
        // Parse as TOON markdown file
        goals = this.parseToonMarkdown(content, filePath);
      } else {
        // Parse as JSON
        goals = JSON.parse(content);
      }
    } catch (err) {
      const format = ext === '.md' ? 'TOON markdown' : 'JSON';
      throw new FileValidationError(`Failed to parse ${format}: ${err.message}`, filePath);
    }

    // Validate goals structure
    this.validateGoals(goals, filePath);

    // Load context if available
    const context = await this.loadContext(filePath);

    return {
      goals,
      context,
      sourcePath: filePath
    };
  }

  /**
   * Parse TOON content from a markdown file
   * @param {string} content - Markdown file content
   * @param {string} filePath - File path for error messages
   * @returns {Object} Parsed goals object
   * @private
   */
  parseToonMarkdown(content, filePath) {
    // Extract TOON content from markdown code blocks
    // Look for ```toon ... ``` blocks
    const toonBlockRegex = /```toon\n([\s\S]*?)```/g;
    const matches = [...content.matchAll(toonBlockRegex)];

    if (matches.length === 0) {
      throw new Error('No TOON code blocks found in markdown file');
    }

    // The main content block is typically the last/largest one
    // or the one under "## Content" heading
    let mainToonContent = null;

    // Check if there's a Content section
    const contentSectionMatch = content.match(/## Content\s*\n+```toon\n([\s\S]*?)```/);
    if (contentSectionMatch) {
      mainToonContent = contentSectionMatch[1].trim();
    } else {
      // Use the last TOON block (which typically contains the full data)
      mainToonContent = matches[matches.length - 1][1].trim();
    }

    // Decode TOON to JSON
    return toonDecode(mainToonContent);
  }

  /**
   * Validate goals structure
   * @param {Object} goals
   * @param {string} filePath
   * @private
   */
  validateGoals(goals, filePath) {
    const errors = [];

    if (!goals.version) {
      errors.push('Missing required field: version');
    }

    if (!goals.goals || !Array.isArray(goals.goals)) {
      errors.push('Missing or invalid field: goals (must be array)');
    } else if (goals.goals.length === 0) {
      errors.push('Goals array must have at least one goal');
    } else {
      // Validate each goal
      goals.goals.forEach((goal, index) => {
        if (!goal.id) {
          errors.push(`Goal[${index}]: missing required field 'id'`);
        }
        if (!goal.objective) {
          errors.push(`Goal[${index}]: missing required field 'objective'`);
        }
      });
    }

    if (errors.length > 0) {
      throw new FileValidationError(
        `Goals validation failed: ${errors.join('; ')}`,
        filePath,
        { errors }
      );
    }
  }

  /**
   * Load context files from adjacent directory
   * @param {string} goalsFilePath
   * @returns {Promise<Object>}
   * @private
   */
  async loadContext(goalsFilePath) {
    if (!this.includeContext) {
      return { files: [], metadata: { totalFiles: 0, totalSize: 0 } };
    }

    const dir = dirname(goalsFilePath);
    const contextDir = join(dir, this.contextDirName);

    // Also check for context dir named after the goals file
    // e.g., goals.json -> goals-context/
    const goalsBaseName = basename(goalsFilePath, '.json');
    const altContextDir = join(dir, `${goalsBaseName}-context`);

    let targetContextDir = null;
    if (existsSync(contextDir)) {
      targetContextDir = contextDir;
    } else if (existsSync(altContextDir)) {
      targetContextDir = altContextDir;
    }

    if (!targetContextDir) {
      return { files: [], metadata: { totalFiles: 0, totalSize: 0 } };
    }

    return await this.loadContextDirectory(targetContextDir);
  }

  /**
   * Load all files from context directory
   * @param {string} contextDir
   * @returns {Promise<Object>}
   * @private
   */
  async loadContextDirectory(contextDir) {
    const { readdir, stat } = await import('fs/promises');
    const files = [];
    let totalSize = 0;

    const entries = await readdir(contextDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = join(contextDir, entry.name);
        const stats = await stat(filePath);
        const content = await readFile(filePath, 'utf-8');

        files.push({
          path: entry.name,
          content,
          extension: entry.name.includes('.') ? '.' + entry.name.split('.').pop() : '',
          size: stats.size
        });

        totalSize += stats.size;
      }
    }

    // Format context for session server
    const formattedContent = files.map(f => 
      `<file name="${f.path}">\n${f.content}\n</file>`
    ).join('\n\n');

    return {
      files,
      metadata: {
        totalFiles: files.length,
        totalSize
      },
      formattedContent
    };
  }

  /**
   * Mark file as processed (move to processed directory)
   * @param {string} filePath
   * @param {Object} result - Processing result to save
   * @returns {Promise<string>} New file path
   */
  async markProcessed(filePath, result = null) {
    if (!this.moveProcessed) {
      return filePath;
    }

    const dir = dirname(filePath);
    const filename = basename(filePath);
    const processedDir = join(dir, this.processedDir);

    // Ensure processed directory exists
    if (!existsSync(processedDir)) {
      await mkdir(processedDir, { recursive: true });
    }

    // Generate timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const newFilename = `${timestamp}_${filename}`;
    const newPath = join(processedDir, newFilename);

    // Move file
    await rename(filePath, newPath);

    // Save result if provided
    if (result) {
      const resultPath = join(processedDir, `${timestamp}_${filename.replace('.json', '')}_result.json`);
      await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');
    }

    return newPath;
  }

  /**
   * Mark file as failed (move to failed directory)
   * @param {string} filePath
   * @param {Error} error
   * @returns {Promise<string>} New file path
   */
  async markFailed(filePath, error) {
    if (!this.moveProcessed) {
      return filePath;
    }

    const dir = dirname(filePath);
    const filename = basename(filePath);
    const failedDir = join(dir, this.failedDir);

    // Ensure failed directory exists
    if (!existsSync(failedDir)) {
      await mkdir(failedDir, { recursive: true });
    }

    // Generate timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const newFilename = `${timestamp}_${filename}`;
    const newPath = join(failedDir, newFilename);

    // Move file
    await rename(filePath, newPath);

    // Save error details
    const errorPath = join(failedDir, `${timestamp}_${filename.replace('.json', '')}_error.json`);
    await writeFile(errorPath, JSON.stringify({
      originalPath: filePath,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details
      },
      failedAt: new Date().toISOString()
    }, null, 2), 'utf-8');

    return newPath;
  }
}

export default FileProcessor;