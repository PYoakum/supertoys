/**
 * @fileoverview Path expression utilities for dynamic value access
 * @module path-utils
 *
 * Supports dot notation and bracket notation for accessing nested values:
 * - "project.metadata.name"
 * - "goals[0].objective"
 * - "goals[1].criteria.success[0]"
 */

/**
 * Parse a path expression into tokens
 * @param {string} expr - Path expression (e.g., "goals[0].objective")
 * @returns {Array<string|number>} Array of tokens
 * @throws {Error} If path expression is invalid
 *
 * @example
 * parsePathExpr("goals[0].objective")
 * // => ["goals", 0, "objective"]
 */
export function parsePathExpr(expr) {
  if (!expr || typeof expr !== 'string') {
    throw new Error('Path expression must be a non-empty string');
  }

  const tokens = [];
  let i = 0;

  while (i < expr.length) {
    // Skip dots
    if (expr[i] === '.') {
      i++;
      continue;
    }

    // Array indexing: [0], [1], etc.
    if (expr[i] === '[') {
      const close = expr.indexOf(']', i);
      if (close === -1) {
        throw new Error(`Invalid path (missing ]): ${expr}`);
      }
      const inside = expr.slice(i + 1, close);
      const idx = Number(inside);
      if (!Number.isInteger(idx) || idx < 0) {
        throw new Error(`Invalid array index in path: ${expr}`);
      }
      tokens.push(idx);
      i = close + 1;
      continue;
    }

    // Property names
    let j = i;
    while (j < expr.length && expr[j] !== '.' && expr[j] !== '[') {
      j++;
    }
    if (j > i) {
      tokens.push(expr.slice(i, j));
    }
    i = j;
  }

  if (tokens.length === 0) {
    throw new Error(`Empty path expression: ${expr}`);
  }

  return tokens;
}

/**
 * Get a value from an object using a path expression
 * @param {Object} obj - Object to access
 * @param {string} expr - Path expression
 * @returns {*} Value at path, or undefined if not found
 *
 * @example
 * getByPath({ goals: [{ objective: "test" }] }, "goals[0].objective")
 * // => "test"
 */
export function getByPath(obj, expr) {
  const tokens = parsePathExpr(expr);
  let current = obj;

  for (const token of tokens) {
    if (current == null) {
      return undefined;
    }
    current = current[token];
  }

  return current;
}

/**
 * Set a value in an object using a path expression
 * Creates intermediate objects/arrays as needed
 * @param {Object} obj - Object to modify
 * @param {string} expr - Path expression
 * @param {*} value - Value to set
 * @returns {Object} The modified object
 *
 * @example
 * setByPath({}, "goals[0].objective", "test")
 * // => { goals: [{ objective: "test" }] }
 */
export function setByPath(obj, expr, value) {
  const tokens = parsePathExpr(expr);
  if (tokens.length === 0) {
    throw new Error('Empty path expression');
  }

  let current = obj;

  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    if (current[token] == null) {
      // Create array if next token is a number, otherwise object
      current[token] = typeof nextToken === 'number' ? [] : {};
    }
    current = current[token];
  }

  current[tokens[tokens.length - 1]] = value;
  return obj;
}

/**
 * Delete a value from an object using a path expression
 * @param {Object} obj - Object to modify
 * @param {string} expr - Path expression
 * @returns {boolean} True if value was deleted
 */
export function deleteByPath(obj, expr) {
  const tokens = parsePathExpr(expr);
  if (tokens.length === 0) {
    return false;
  }

  let current = obj;

  for (let i = 0; i < tokens.length - 1; i++) {
    if (current == null) {
      return false;
    }
    current = current[tokens[i]];
  }

  if (current == null) {
    return false;
  }

  const lastToken = tokens[tokens.length - 1];
  if (Array.isArray(current) && typeof lastToken === 'number') {
    current.splice(lastToken, 1);
  } else {
    delete current[lastToken];
  }

  return true;
}

/**
 * Check if a path exists in an object
 * @param {Object} obj - Object to check
 * @param {string} expr - Path expression
 * @returns {boolean}
 */
export function hasPath(obj, expr) {
  try {
    const value = getByPath(obj, expr);
    return value !== undefined;
  } catch {
    return false;
  }
}

/**
 * Convert a glob pattern to a RegExp
 * @param {string} glob - Glob pattern (e.g., "goals[*].objective")
 * @returns {RegExp}
 *
 * @example
 * globToRegExp("goals[*].objective")
 * // matches: "goals[0].objective", "goals[123].objective"
 */
export function globToRegExp(glob) {
  // Escape special regex characters except * and ?
  // Include [ and ] in the escape list
  let escaped = glob.replace(/[-/\\^$+.()|{}\[\]]/g, '\\$&');

  // Handle bracket expressions for array indices
  // [*] matches any array index
  escaped = escaped.replace(/\\\[\\\*\\\]/g, '\\[\\d+\\]');

  // Replace remaining wildcards
  escaped = escaped.replace(/\*/g, '.*');
  escaped = escaped.replace(/\?/g, '.');

  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a path matches any of the given glob patterns
 * @param {string[]} globs - Array of glob patterns
 * @param {string} pathStr - Path to check
 * @returns {boolean}
 */
export function matchAny(globs, pathStr) {
  for (const glob of globs) {
    const re = globToRegExp(glob);
    if (re.test(pathStr)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter a path based on include/exclude glob patterns
 * @param {string} pathStr - Path to check
 * @param {string[]} [includeGlobs] - Include patterns (if empty, include all)
 * @param {string[]} [excludeGlobs] - Exclude patterns (takes priority)
 * @returns {boolean} True if path should be included
 */
export function shouldIncludePath(pathStr, includeGlobs, excludeGlobs) {
  // Exclusions take priority
  if (excludeGlobs && excludeGlobs.length > 0 && matchAny(excludeGlobs, pathStr)) {
    return false;
  }

  // If no include list, include by default
  if (!includeGlobs || includeGlobs.length === 0) {
    return true;
  }

  // Must match at least one include pattern
  return matchAny(includeGlobs, pathStr);
}

/**
 * Collect all string paths from an object recursively
 * @param {Object} obj - Object to traverse
 * @param {string} [prefix=''] - Current path prefix
 * @returns {string[]} Array of paths to string values
 */
export function collectStringPaths(obj, prefix = '') {
  const paths = [];

  if (obj == null || typeof obj !== 'object') {
    return paths;
  }

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      paths.push(currentPath);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const arrayPath = `${currentPath}[${index}]`;
        if (typeof item === 'string') {
          paths.push(arrayPath);
        } else if (item && typeof item === 'object') {
          paths.push(...collectStringPaths(item, arrayPath));
        }
      });
    } else if (value && typeof value === 'object') {
      paths.push(...collectStringPaths(value, currentPath));
    }
  }

  return paths;
}

/**
 * Collect editable content string paths from project/goals structure
 * @param {Object} project - Project metadata
 * @param {Object[]} goals - Goals array
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeContext=false] - Include goal context fields
 * @returns {string[]} Array of editable paths
 */
export function collectContentStringPaths(project, goals, options = {}) {
  const { includeContext = false } = options;
  const paths = [];

  // Project metadata paths
  if (project?.metadata) {
    const meta = project.metadata;
    if (typeof meta.name === 'string') paths.push('project.metadata.name');
    if (typeof meta.description === 'string') paths.push('project.metadata.description');
    if (typeof meta.author === 'string') paths.push('project.metadata.author');
    if (Array.isArray(meta.tags)) {
      meta.tags.forEach((v, i) => {
        if (typeof v === 'string') paths.push(`project.metadata.tags[${i}]`);
      });
    }
  }

  // Goal paths
  if (Array.isArray(goals)) {
    goals.forEach((goal, gi) => {
      if (typeof goal.objective === 'string') {
        paths.push(`goals[${gi}].objective`);
      }

      if (Array.isArray(goal.constraints)) {
        goal.constraints.forEach((v, i) => {
          if (typeof v === 'string') paths.push(`goals[${gi}].constraints[${i}]`);
        });
      }

      if (goal.criteria) {
        if (Array.isArray(goal.criteria.success)) {
          goal.criteria.success.forEach((v, i) => {
            if (typeof v === 'string') paths.push(`goals[${gi}].criteria.success[${i}]`);
          });
        }
        if (Array.isArray(goal.criteria.acceptance)) {
          goal.criteria.acceptance.forEach((v, i) => {
            if (typeof v === 'string') paths.push(`goals[${gi}].criteria.acceptance[${i}]`);
          });
        }
        if (typeof goal.criteria.validation === 'string') {
          paths.push(`goals[${gi}].criteria.validation`);
        }
      }

      // Optional: include goal-specific context
      if (includeContext && goal.context && typeof goal.context === 'object') {
        for (const [k, v] of Object.entries(goal.context)) {
          const base = `goals[${gi}].context.${k}`;
          if (typeof v === 'string') {
            paths.push(base);
          } else if (Array.isArray(v)) {
            v.forEach((vv, i) => {
              if (typeof vv === 'string') paths.push(`${base}[${i}]`);
            });
          }
        }
      }
    });
  }

  return paths;
}

export default {
  parsePathExpr,
  getByPath,
  setByPath,
  deleteByPath,
  hasPath,
  globToRegExp,
  matchAny,
  shouldIncludePath,
  collectStringPaths,
  collectContentStringPaths
};
