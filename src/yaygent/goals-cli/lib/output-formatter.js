/**
 * @fileoverview Output formatting utilities for various output formats
 * @module output-formatter
 */

import { encode as toonEncode } from '@toon-format/toon';

/**
 * @typedef {Object} FormatOptions
 * @property {boolean} [prettyPrint=true] - Whether to pretty-print JSON
 * @property {number} [indentSize=2] - Indentation size for pretty printing
 */

/**
 * Default format options
 * @type {FormatOptions}
 */
const DEFAULT_OPTIONS = {
  prettyPrint: true,
  indentSize: 2
};

/**
 * Available formatters by type
 * @type {Object.<string, function>}
 */
const formatters = {
  /**
   * Format data as JSON
   * @param {*} data - Data to format
   * @param {FormatOptions} options - Format options
   * @returns {string}
   */
  json: (data, options = {}) => {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    if (opts.prettyPrint) {
      return JSON.stringify(data, null, opts.indentSize);
    }
    return JSON.stringify(data);
  },

  /**
   * Format data as Markdown
   * @param {*} data - Data to format
   * @param {FormatOptions} options - Format options
   * @returns {string}
   */
  markdown: (data, options = {}) => {
    const lines = [];
    
    // Handle different data types
    if (data.goals) {
      lines.push(formatGoalsAsMarkdown(data));
    } else if (data.response) {
      lines.push(formatResponseAsMarkdown(data));
    } else {
      lines.push(formatGenericAsMarkdown(data));
    }
    
    return lines.join('\n');
  },

  /**
   * Format data as plain text
   * @param {*} data - Data to format
   * @param {FormatOptions} options - Format options
   * @returns {string}
   */
  text: (data, options = {}) => {
    if (typeof data === 'string') {
      return data;
    }

    if (data.response?.content) {
      return data.response.content;
    }

    if (data.goals) {
      return formatGoalsAsText(data);
    }

    return formatGenericAsText(data);
  },

  /**
   * Format data as TOON (Token-Oriented Object Notation)
   * Produces a markdown file with TOON-encoded content
   * @param {*} data - Data to format
   * @param {FormatOptions} options - Format options
   * @returns {string}
   */
  toon: (data, options = {}) => {
    const lines = [];

    // Extract goals definition from full result object if needed
    // The full result has: { success, session, goals, context, response }
    // We only want to encode the goals definition for goal-keeper consumption
    let goalsData = data;
    let sessionInfo = null;

    if (data.goals && data.response) {
      // This is a full execution result - extract just the goals
      goalsData = data.goals;
      sessionInfo = data.session;
    }

    // Add markdown header
    lines.push('# Goals Definition');
    lines.push('');
    lines.push('> This file contains goals in TOON format.');
    lines.push('> TOON (Token-Oriented Object Notation) is a compact, human-readable encoding.');
    lines.push('');

    // Add session info if present
    if (sessionInfo) {
      lines.push('## Session');
      lines.push('');
      lines.push('```toon');
      lines.push(toonEncode(sessionInfo));
      lines.push('```');
      lines.push('');
    }

    // Add metadata section if present
    if (goalsData.metadata) {
      lines.push('## Metadata');
      lines.push('');
      lines.push('```toon');
      lines.push(toonEncode(goalsData.metadata));
      lines.push('```');
      lines.push('');
    }

    // Add main TOON content (goals definition)
    lines.push('## Content');
    lines.push('');
    lines.push('```toon');
    lines.push(toonEncode(goalsData));
    lines.push('```');
    lines.push('');

    // Add generation timestamp
    lines.push('---');
    lines.push(`Generated: ${new Date().toISOString()}`);

    return lines.join('\n');
  }
};

/**
 * Format goals data as Markdown
 * @param {Object} data - Goals data
 * @returns {string}
 */
function formatGoalsAsMarkdown(data) {
  const lines = [];
  
  // Header
  lines.push('# Goals Summary');
  lines.push('');
  
  // Metadata if present
  if (data.metadata) {
    lines.push('## Metadata');
    lines.push('');
    if (data.metadata.name) lines.push(`- **Name:** ${data.metadata.name}`);
    if (data.metadata.description) lines.push(`- **Description:** ${data.metadata.description}`);
    if (data.metadata.author) lines.push(`- **Author:** ${data.metadata.author}`);
    if (data.metadata.created) lines.push(`- **Created:** ${data.metadata.created}`);
    if (data.metadata.tags?.length) lines.push(`- **Tags:** ${data.metadata.tags.join(', ')}`);
    lines.push('');
  }
  
  // Goals
  lines.push('## Goals');
  lines.push('');
  
  for (const goal of data.goals) {
    lines.push(`### ${goal.id}`);
    lines.push('');
    lines.push(`**Objective:** ${goal.objective}`);
    lines.push('');
    
    if (goal.priority) {
      lines.push(`**Priority:** ${goal.priority}`);
      lines.push('');
    }
    
    if (goal.criteria?.success?.length) {
      lines.push('**Success Criteria:**');
      for (const criterion of goal.criteria.success) {
        lines.push(`- ${criterion}`);
      }
      lines.push('');
    }
    
    if (goal.constraints?.length) {
      lines.push('**Constraints:**');
      for (const constraint of goal.constraints) {
        lines.push(`- ${constraint}`);
      }
      lines.push('');
    }
    
    if (goal.dependencies?.length) {
      lines.push(`**Dependencies:** ${goal.dependencies.join(', ')}`);
      lines.push('');
    }
  }
  
  // Global context if present
  if (data.globalContext && Object.keys(data.globalContext).length > 0) {
    lines.push('## Global Context');
    lines.push('');
    for (const [key, value] of Object.entries(data.globalContext)) {
      lines.push(`- **${key}:** ${value}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Format response data as Markdown
 * @param {Object} data - Response data with response field
 * @returns {string}
 */
function formatResponseAsMarkdown(data) {
  const lines = [];
  
  lines.push('# Execution Result');
  lines.push('');
  
  if (data.response.content) {
    lines.push('## Response');
    lines.push('');
    lines.push(data.response.content);
    lines.push('');
  }
  
  if (data.response.usage) {
    lines.push('## Token Usage');
    lines.push('');
    lines.push(`- **Input Tokens:** ${data.response.usage.inputTokens || 'N/A'}`);
    lines.push(`- **Output Tokens:** ${data.response.usage.outputTokens || 'N/A'}`);
    lines.push(`- **Total Tokens:** ${data.response.usage.totalTokens || 'N/A'}`);
    lines.push('');
  }
  
  if (data.session) {
    lines.push('## Session Info');
    lines.push('');
    lines.push(`- **Session ID:** ${data.session.id || 'N/A'}`);
    lines.push(`- **Timestamp:** ${data.session.timestamp || new Date().toISOString()}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Format generic data as Markdown
 * @param {Object} data - Any data object
 * @returns {string}
 */
function formatGenericAsMarkdown(data) {
  const lines = ['# Output', '', '```json'];
  lines.push(JSON.stringify(data, null, 2));
  lines.push('```');
  return lines.join('\n');
}

/**
 * Format goals as plain text
 * @param {Object} data - Goals data
 * @returns {string}
 */
function formatGoalsAsText(data) {
  const lines = [];
  
  lines.push('GOALS SUMMARY');
  lines.push('='.repeat(50));
  lines.push('');
  
  for (let i = 0; i < data.goals.length; i++) {
    const goal = data.goals[i];
    lines.push(`[${i + 1}] ${goal.id}`);
    lines.push(`    Objective: ${goal.objective}`);
    if (goal.priority) lines.push(`    Priority: ${goal.priority}`);
    if (goal.dependencies?.length) {
      lines.push(`    Dependencies: ${goal.dependencies.join(', ')}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Format generic data as plain text
 * @param {Object} data - Any data object
 * @returns {string}
 */
function formatGenericAsText(data) {
  const lines = [];
  
  function formatValue(value, indent = '') {
    if (value === null || value === undefined) {
      return 'N/A';
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const subLines = [];
      for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'object') {
          subLines.push(`${indent}${k}:`);
          subLines.push(formatValue(v, indent + '  '));
        } else {
          subLines.push(`${indent}${k}: ${v}`);
        }
      }
      return subLines.join('\n');
    }
    if (Array.isArray(value)) {
      return value.map(v => `${indent}- ${v}`).join('\n');
    }
    return String(value);
  }
  
  lines.push(formatValue(data));
  return lines.join('\n');
}

/**
 * Format data using the specified format type
 * @param {*} data - Data to format
 * @param {'json'|'markdown'|'text'} formatType - Output format
 * @param {FormatOptions} [options={}] - Format options
 * @returns {string}
 * @throws {Error} If format type is unknown
 */
export function format(data, formatType, options = {}) {
  const formatter = formatters[formatType];
  if (!formatter) {
    throw new Error(`Unknown format: ${formatType}. Available formats: ${Object.keys(formatters).join(', ')}`);
  }
  return formatter(data, options);
}

/**
 * Get list of available format types
 * @returns {string[]}
 */
export function getAvailableFormats() {
  return Object.keys(formatters);
}

/**
 * Check if a format type is valid
 * @param {string} formatType - Format type to check
 * @returns {boolean}
 */
export function isValidFormat(formatType) {
  return formatType in formatters;
}

/**
 * Format validation summary for dry-run mode
 * @param {Object} summary - Validation summary
 * @returns {string}
 */
export function formatValidationSummary(summary) {
  const lines = [];
  
  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════════════╗');
  lines.push('║                    VALIDATION SUMMARY                          ║');
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  
  // Goals validation
  lines.push('║ Goals:                                                         ║');
  lines.push(`║   ✓ File: ${summary.goals.path.padEnd(51)}║`);
  lines.push(`║   ✓ Goals found: ${String(summary.goals.count).padEnd(44)}║`);
  lines.push(`║   ✓ Version: ${summary.goals.version.padEnd(49)}║`);
  
  // Context validation
  lines.push('║                                                                ║');
  lines.push('║ Context:                                                       ║');
  lines.push(`║   ✓ Directory: ${summary.context.path.padEnd(47)}║`);
  lines.push(`║   ✓ Files loaded: ${String(summary.context.fileCount).padEnd(43)}║`);
  lines.push(`║   ✓ Total size: ${summary.context.totalSize.padEnd(45)}║`);
  
  // Config validation
  lines.push('║                                                                ║');
  lines.push('║ Configuration:                                                 ║');
  lines.push(`║   ✓ Endpoint: ${summary.config.endpoint.padEnd(48)}║`);
  lines.push(`║   ✓ Model: ${summary.config.model.padEnd(51)}║`);
  lines.push(`║   ✓ Auth: ${summary.config.authType.padEnd(52)}║`);
  
  lines.push('║                                                                ║');
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  lines.push('║  Status: VALID - Ready for execution                           ║');
  lines.push('╚════════════════════════════════════════════════════════════════╝');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Format error for display
 * @param {Error} error - Error to format
 * @param {boolean} [verbose=false] - Include stack trace
 * @returns {string}
 */
export function formatError(error, verbose = false) {
  const lines = [];
  
  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════════════╗');
  lines.push('║                         ERROR                                  ║');
  lines.push('╠════════════════════════════════════════════════════════════════╣');
  
  // Error type and code
  const errorType = error.name || 'Error';
  const errorCode = error.code || 'UNKNOWN';
  lines.push(`║ Type: ${errorType.padEnd(56)}║`);
  lines.push(`║ Code: ${errorCode.padEnd(56)}║`);
  
  // Error message (may span multiple lines)
  lines.push('║                                                                ║');
  lines.push('║ Message:                                                       ║');
  
  const msgLines = wrapText(error.message, 60);
  for (const line of msgLines) {
    lines.push(`║   ${line.padEnd(60)}║`);
  }
  
  // Details if present
  if (error.details && Object.keys(error.details).length > 0) {
    lines.push('║                                                                ║');
    lines.push('║ Details:                                                       ║');
    for (const [key, value] of Object.entries(error.details)) {
      const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
      const detailLines = wrapText(`${key}: ${valueStr}`, 58);
      for (const line of detailLines) {
        lines.push(`║   ${line.padEnd(60)}║`);
      }
    }
  }
  
  // Stack trace if verbose
  if (verbose && error.stack) {
    lines.push('║                                                                ║');
    lines.push('║ Stack Trace:                                                   ║');
    const stackLines = error.stack.split('\n').slice(1, 6);
    for (const line of stackLines) {
      const trimmed = line.trim().substring(0, 58);
      lines.push(`║   ${trimmed.padEnd(60)}║`);
    }
  }
  
  lines.push('╚════════════════════════════════════════════════════════════════╝');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Wrap text to specified width
 * @param {string} text - Text to wrap
 * @param {number} width - Maximum line width
 * @returns {string[]}
 */
function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word.length > width ? word.substring(0, width) : word;
    }
  }
  
  if (currentLine) lines.push(currentLine);
  return lines.length ? lines : [''];
}

export default { format, getAvailableFormats, isValidFormat, formatValidationSummary, formatError };
