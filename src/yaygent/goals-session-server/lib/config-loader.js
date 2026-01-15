/**
 * @fileoverview Multi-format configuration loader
 * @module config-loader
 *
 * Supports loading configuration from:
 * - JSON files (.json)
 * - JavaScript/ES modules (.js, .mjs, .cjs)
 * - Python scripts (.py) - executes and parses JSON output
 * - Remote URLs (HTTP/HTTPS)
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, extname } from 'path';
import { pathToFileURL } from 'url';

/**
 * @typedef {Object} LoadOptions
 * @property {number} [timeout=30000] - Timeout for URL fetches in ms
 * @property {Object} [headers] - Additional headers for URL fetches
 * @property {boolean} [cacheBust=true] - Add cache-busting param to JS imports
 */

/**
 * Load an object from a file (JSON, JS, or Python)
 * @param {string} filePath - Path to the file
 * @param {LoadOptions} [options={}] - Load options
 * @returns {Promise<Object>} Loaded configuration object
 * @throws {Error} If file not found or invalid format
 */
export async function loadObjectFromFile(filePath, options = {}) {
  const { cacheBust = true } = options;
  const abs = resolve(process.cwd(), filePath);

  if (!existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }

  const ext = extname(abs).toLowerCase();

  // JSON files - direct parsing
  if (ext === '.json') {
    const content = readFileSync(abs, 'utf-8');
    try {
      return JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to parse JSON file ${abs}: ${err.message}`);
    }
  }

  // JavaScript/ES Modules - dynamic import
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    try {
      const url = pathToFileURL(abs);
      // Add cache buster to force re-import
      if (cacheBust) {
        url.searchParams.set('t', String(Date.now()));
      }
      const mod = await import(url.href);
      const obj = mod?.default ?? mod;

      if (obj == null || typeof obj !== 'object') {
        throw new Error(`JS config did not export an object: ${abs}`);
      }
      return obj;
    } catch (err) {
      if (err.message.includes('did not export')) {
        throw err;
      }
      throw new Error(`Failed to import JS config ${abs}: ${err.message}`);
    }
  }

  // Python files - spawn subprocess, capture JSON output
  if (ext === '.py') {
    return loadFromPython(abs);
  }

  throw new Error(`Unsupported config file type: ${ext}. Supported: .json, .js, .mjs, .cjs, .py`);
}

/**
 * Load configuration from a Python script
 * The script must print valid JSON to stdout
 * @param {string} absPath - Absolute path to Python file
 * @returns {Promise<Object>}
 */
async function loadFromPython(absPath) {
  // Check if Bun.spawn is available (Bun runtime)
  if (typeof Bun !== 'undefined' && Bun.spawn) {
    const proc = Bun.spawn({
      cmd: ['python3', absPath],
      stdout: 'pipe',
      stderr: 'pipe'
    });

    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;

    if (code !== 0) {
      throw new Error(`Python config failed (exit ${code}): ${err || 'Unknown error'}`);
    }

    try {
      return JSON.parse(out);
    } catch (parseErr) {
      throw new Error(`Python config did not output valid JSON: ${parseErr.message}`);
    }
  }

  // Fallback for Node.js
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [absPath]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python config failed (exit ${code}): ${stderr || 'Unknown error'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseErr) {
        reject(new Error(`Python config did not output valid JSON: ${parseErr.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to execute Python: ${err.message}`));
    });
  });
}

/**
 * Load an object from a URL
 * @param {string} url - URL to fetch
 * @param {LoadOptions} [options={}] - Load options
 * @returns {Promise<Object>} Loaded configuration object
 */
export async function loadObjectFromUrl(url, options = {}) {
  const { timeout = 30000, headers = {} } = options;

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Ensure HTTPS (upgrade HTTP to HTTPS)
  if (parsedUrl.protocol === 'http:') {
    parsedUrl.protocol = 'https:';
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(parsedUrl.href, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...headers
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      console.warn(`Warning: URL returned content-type "${contentType}", expected JSON`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`URL did not return valid JSON: ${parseErr.message}`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`URL fetch timed out after ${timeout}ms: ${url}`);
    }
    throw new Error(`Failed to fetch URL ${url}: ${err.message}`);
  }
}

/**
 * Load configuration from either file or URL
 * @param {string} source - File path or URL
 * @param {LoadOptions} [options={}] - Load options
 * @returns {Promise<Object>}
 */
export async function loadObject(source, options = {}) {
  // Detect if source is a URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return loadObjectFromUrl(source, options);
  }

  // Otherwise treat as file path
  return loadObjectFromFile(source, options);
}

/**
 * Default project template
 * @returns {Object}
 */
export function defaultProjectTemplate() {
  return {
    version: '1.0',
    metadata: {
      name: '',
      description: '',
      author: '',
      tags: [],
      createdAt: new Date().toISOString()
    },
    globalContext: {}
  };
}

/**
 * Coerce various config formats to standard {project, goals} structure
 * @param {Object} obj - Raw config object
 * @returns {{project: Object, goals: Object[]}}
 * @throws {Error} If config cannot be coerced
 */
export function coerceConfigToProjectGoals(obj) {
  if (obj == null || typeof obj !== 'object') {
    throw new Error('Config must be an object');
  }

  if (!Array.isArray(obj.goals)) {
    throw new Error('Config must include "goals": []');
  }

  // Priority 1: Direct project structure
  if (obj.project && typeof obj.project === 'object') {
    return { project: obj.project, goals: obj.goals };
  }

  // Priority 2: Template-based structure
  if (obj.template && typeof obj.template === 'object') {
    return { project: obj.template, goals: obj.goals };
  }

  // Priority 3: Metadata-based (auto-creates project template)
  if (obj.metadata && typeof obj.metadata === 'object' && !obj.version && !obj.globalContext) {
    const project = defaultProjectTemplate();
    project.metadata = { ...project.metadata, ...obj.metadata };
    return { project, goals: obj.goals };
  }

  // Priority 4: Goals-only format (from goals-cli)
  // Structure: { version, goals: [], globalContext?, metadata? }
  if (obj.version && !obj.project) {
    const project = defaultProjectTemplate();
    project.version = obj.version;
    if (obj.metadata) {
      project.metadata = { ...project.metadata, ...obj.metadata };
    }
    if (obj.globalContext) {
      project.globalContext = obj.globalContext;
    }
    return { project, goals: obj.goals };
  }

  // Fallback: Rest of object becomes project
  const { goals, ...rest } = obj;
  return { project: rest, goals };
}

/**
 * Merge goals from source into target
 * @param {Object[]} targetGoals - Existing goals
 * @param {Object[]} sourceGoals - Goals to merge
 * @param {Object} [options={}] - Merge options
 * @param {boolean} [options.replace=false] - Replace matching goals by ID
 * @returns {Object[]} Merged goals array
 */
export function mergeGoals(targetGoals, sourceGoals, options = {}) {
  const { replace = false } = options;

  if (!Array.isArray(targetGoals)) targetGoals = [];
  if (!Array.isArray(sourceGoals)) sourceGoals = [];

  if (replace) {
    // Replace mode: source goals with matching IDs replace target goals
    const targetMap = new Map(targetGoals.map(g => [g.id, g]));
    for (const goal of sourceGoals) {
      targetMap.set(goal.id, goal);
    }
    return Array.from(targetMap.values());
  }

  // Append mode: add source goals that don't exist in target
  const existingIds = new Set(targetGoals.map(g => g.id));
  const newGoals = sourceGoals.filter(g => !existingIds.has(g.id));
  return [...targetGoals, ...newGoals];
}

/**
 * Validate a goals structure
 * @param {Object} goalsObj - Goals object to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateGoalsStructure(goalsObj) {
  const errors = [];

  if (!goalsObj || typeof goalsObj !== 'object') {
    errors.push('Goals must be an object');
    return { valid: false, errors };
  }

  if (!goalsObj.version) {
    errors.push('Goals must have a version');
  }

  if (!Array.isArray(goalsObj.goals)) {
    errors.push('Goals must have a goals array');
    return { valid: false, errors };
  }

  goalsObj.goals.forEach((goal, i) => {
    if (!goal.id) {
      errors.push(`Goal at index ${i} must have an id`);
    }
    if (!goal.objective) {
      errors.push(`Goal at index ${i} must have an objective`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export default {
  loadObjectFromFile,
  loadObjectFromUrl,
  loadObject,
  defaultProjectTemplate,
  coerceConfigToProjectGoals,
  mergeGoals,
  validateGoalsStructure
};
