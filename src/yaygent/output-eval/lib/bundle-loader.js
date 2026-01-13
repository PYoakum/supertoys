/**
 * @fileoverview Bundle Loader for loading and validating session bundles
 * @module bundle-loader
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { BundleNotFoundError, BundleIntegrityError } from './errors.js';

/**
 * Required files in a valid bundle
 */
const REQUIRED_FILES = [
  'manifest.json',
  'session/session.json',
  'session/goals.json',
  'session/tasks.json',
  'execution/execution-log.json'
];

/**
 * Bundle Loader class
 */
export class BundleLoader {
  /**
   * @param {string} bundlePath - Path to the bundle directory
   * @param {Object} [options={}]
   */
  constructor(bundlePath, options = {}) {
    this.bundlePath = bundlePath;
    this.validateIntegrity = options.validateIntegrity !== false;
    this.loaded = false;
    this.data = null;
  }

  /**
   * Load and validate the bundle
   * @returns {Promise<Object>}
   */
  async load() {
    if (!existsSync(this.bundlePath)) {
      throw new BundleNotFoundError(this.bundlePath);
    }

    // Validate integrity
    if (this.validateIntegrity) {
      await this.validateBundleIntegrity();
    }

    // Load manifest
    const manifest = await this.loadJson('manifest.json');

    // Load session data
    const session = await this.loadJson('session/session.json');
    const goals = await this.loadJson('session/goals.json');
    const tasks = await this.loadJson('session/tasks.json');

    // Load context files
    const context = await this.loadContextFiles();

    // Load execution data
    const executionLog = await this.loadJson('execution/execution-log.json');
    const taskOutputs = await this.loadTaskOutputs();
    const evaluations = await this.loadEvaluations();

    // Load artifacts list
    const artifacts = await this.listArtifacts();

    this.data = {
      manifest,
      session,
      goals,
      tasks,
      context,
      executionLog,
      taskOutputs,
      evaluations,
      artifacts
    };

    this.loaded = true;
    return this.data;
  }

  /**
   * Validate bundle integrity
   * @private
   */
  async validateBundleIntegrity() {
    const missing = [];

    for (const file of REQUIRED_FILES) {
      const filePath = join(this.bundlePath, file);
      if (!existsSync(filePath)) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      throw new BundleIntegrityError(
        `Bundle is missing required files: ${missing.join(', ')}`,
        missing
      );
    }
  }

  /**
   * Load a JSON file
   * @param {string} relativePath
   * @returns {Promise<Object>}
   * @private
   */
  async loadJson(relativePath) {
    const filePath = join(this.bundlePath, relativePath);
    if (!existsSync(filePath)) {
      return null;
    }
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Load a text file
   * @param {string} relativePath
   * @returns {Promise<string>}
   * @private
   */
  async loadText(relativePath) {
    const filePath = join(this.bundlePath, relativePath);
    if (!existsSync(filePath)) {
      return null;
    }
    return await readFile(filePath, 'utf-8');
  }

  /**
   * Load context files
   * @returns {Promise<Object>}
   * @private
   */
  async loadContextFiles() {
    const contextDir = join(this.bundlePath, 'session/context');
    const files = [];

    if (existsSync(contextDir)) {
      const entries = await readdir(contextDir);
      for (const entry of entries) {
        const filePath = join(contextDir, entry);
        const stats = await stat(filePath);
        if (stats.isFile()) {
          const content = await readFile(filePath, 'utf-8');
          files.push({
            path: entry,
            content,
            size: stats.size
          });
        }
      }
    }

    return { files };
  }

  /**
   * Load task output files
   * @returns {Promise<Object[]>}
   * @private
   */
  async loadTaskOutputs() {
    const tasksDir = join(this.bundlePath, 'execution/tasks');
    const outputs = [];

    if (existsSync(tasksDir)) {
      const files = await readdir(tasksDir);
      for (const file of files.sort()) {
        if (file.endsWith('.md')) {
          const content = await readFile(join(tasksDir, file), 'utf-8');
          // Extract task ID from filename (format: 001-task-id.md)
          const match = file.match(/^\d+-(.+)\.md$/);
          const taskId = match ? match[1] : file.replace('.md', '');
          
          outputs.push({
            taskId,
            filePath: `execution/tasks/${file}`,
            content,
            metadata: this.parseTaskOutputMetadata(content)
          });
        }
      }
    }

    return outputs;
  }

  /**
   * Parse metadata from task output markdown
   * @param {string} content
   * @returns {Object}
   * @private
   */
  parseTaskOutputMetadata(content) {
    const metadata = {};
    
    // Extract task ID
    const idMatch = content.match(/\*\*Task ID:\*\* (.+)/);
    if (idMatch) metadata.taskId = idMatch[1].trim();
    
    // Extract goal ID
    const goalMatch = content.match(/\*\*Goal ID:\*\* (.+)/);
    if (goalMatch) metadata.goalId = goalMatch[1].trim();
    
    // Extract duration
    const durationMatch = content.match(/\*\*Duration:\*\* (\d+)/);
    if (durationMatch) metadata.durationMs = parseInt(durationMatch[1], 10);
    
    return metadata;
  }

  /**
   * Load evaluation files
   * @returns {Promise<Object[]>}
   * @private
   */
  async loadEvaluations() {
    const evalsDir = join(this.bundlePath, 'execution/evaluations');
    const evaluations = [];

    if (existsSync(evalsDir)) {
      const files = await readdir(evalsDir);
      for (const file of files.sort()) {
        if (file.endsWith('.json')) {
          const content = await readFile(join(evalsDir, file), 'utf-8');
          evaluations.push(JSON.parse(content));
        }
      }
    }

    return evaluations;
  }

  /**
   * List artifact files
   * @returns {Promise<Object[]>}
   * @private
   */
  async listArtifacts() {
    const artifactsDir = join(this.bundlePath, 'artifacts');
    const artifacts = [];

    if (existsSync(artifactsDir)) {
      const files = await readdir(artifactsDir);
      for (const file of files) {
        const filePath = join(artifactsDir, file);
        const stats = await stat(filePath);
        if (stats.isFile()) {
          // Try to read content for text files
          let content = null;
          const ext = file.split('.').pop()?.toLowerCase();
          if (['txt', 'md', 'json', 'js', 'html', 'css', 'sql'].includes(ext)) {
            try {
              content = await readFile(filePath, 'utf-8');
            } catch (e) {
              // Ignore read errors for binary files
            }
          }
          
          artifacts.push({
            path: `artifacts/${file}`,
            type: ext || 'unknown',
            size: stats.size,
            createdBy: 'unknown', // Would need to track this during execution
            content
          });
        }
      }
    }

    return artifacts;
  }

  /**
   * Get loaded data
   * @returns {Object}
   */
  getData() {
    if (!this.loaded) {
      throw new Error('Bundle not loaded. Call load() first.');
    }
    return this.data;
  }

  /**
   * Get session ID
   * @returns {string}
   */
  getSessionId() {
    return this.data?.manifest?.sessionId || this.data?.session?.id;
  }
}

export default BundleLoader;
