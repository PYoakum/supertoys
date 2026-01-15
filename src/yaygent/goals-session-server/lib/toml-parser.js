/**
 * @fileoverview Simple TOML parser for task generation responses
 * @module toml-parser
 *
 * This parser handles the specific TOML format used for task generation.
 * It's designed to be resilient to truncation - partial output still parses.
 */

/**
 * Parse a TOML task generation response
 * @param {string} content - TOML content from LLM
 * @returns {Object} - Parsed task list { tasks: [], unboundTasks: [] }
 */
export function parseTaskToml(content) {
  const tasks = [];
  const unboundTasks = [];

  // Split into lines for processing
  const lines = content.split('\n');

  let currentTask = null;
  let currentSection = null; // 'task', 'parameters', 'dependencies', 'unbound'
  let multilineKey = null;
  let multilineValue = [];
  let inMultiline = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    // Check for multiline string end
    if (inMultiline) {
      if (trimmed === "'''" || trimmed === '"""') {
        // End of multiline string
        if (currentTask && multilineKey) {
          setNestedValue(currentTask, multilineKey, multilineValue.join('\n'));
        }
        inMultiline = false;
        multilineKey = null;
        multilineValue = [];
        continue;
      }
      // Add line to multiline value (preserve original indentation relative to content)
      multilineValue.push(line);
      continue;
    }

    // Check for new task array entry
    if (trimmed === '[[tasks]]') {
      // Save previous task if exists
      if (currentTask && currentTask.id) {
        tasks.push(finalizeTask(currentTask));
      }
      currentTask = {};
      currentSection = 'task';
      continue;
    }

    // Check for unbound task array entry
    if (trimmed === '[[unboundTasks]]') {
      if (currentTask && currentTask.id) {
        tasks.push(finalizeTask(currentTask));
      }
      currentTask = {};
      currentSection = 'unbound';
      continue;
    }

    // Check for subsection headers
    if (trimmed.startsWith('[tasks.')) {
      const subsection = trimmed.match(/\[tasks\.(\w+)\]/);
      if (subsection) {
        currentSection = subsection[1];
      }
      continue;
    }

    // Check for dependencies array within task
    if (trimmed === '[[tasks.dependencies]]') {
      if (!currentTask.dependencies) {
        currentTask.dependencies = [];
      }
      currentTask.dependencies.push({});
      continue;
    }

    // Parse key = value pairs
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.*)$/);
    if (kvMatch && currentTask) {
      const key = kvMatch[1];
      let value = kvMatch[2];

      // Check for multiline string on same line ('''content''')
      if ((value.startsWith("'''") && value.endsWith("'''") && value.length > 6) ||
          (value.startsWith('"""') && value.endsWith('"""') && value.length > 6)) {
        value = value.slice(3, -3);
      }
      // Check for multiline string start (''' alone or '''content on first line)
      else if (value.startsWith("'''") || value.startsWith('"""')) {
        inMultiline = true;
        multilineKey = currentSection === 'parameters' ? `parameters.${key}` : key;
        // If there's content after the opening quotes, start with it
        const afterQuotes = value.slice(3);
        multilineValue = afterQuotes ? [afterQuotes] : [];
        continue;
      }
      // Parse regular value
      else {
        value = parseTomlValue(value);
      }

      // Set value based on current section
      if (currentSection === 'parameters') {
        if (!currentTask.parameters) currentTask.parameters = {};
        currentTask.parameters[key] = value;
      } else if (currentSection === 'dependencies' && currentTask.dependencies?.length > 0) {
        const lastDep = currentTask.dependencies[currentTask.dependencies.length - 1];
        lastDep[key] = value;
      } else if (currentSection === 'unbound') {
        currentTask[key] = value;
      } else {
        currentTask[key] = value;
      }
    }
  }

  // Don't forget the last task
  if (currentTask) {
    if (currentSection === 'unbound' && currentTask.goalId) {
      unboundTasks.push(currentTask);
    } else if (currentTask.id) {
      tasks.push(finalizeTask(currentTask));
    }
  }

  return { tasks, unboundTasks };
}

/**
 * Parse a TOML value (string, number, boolean, array)
 * @param {string} value - Raw value string
 * @returns {*} - Parsed value
 */
function parseTomlValue(value) {
  value = value.trim();

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  // Simple array (inline)
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(v => parseTomlValue(v.trim()));
  }

  // Unquoted string (shouldn't happen in valid TOML but handle gracefully)
  return value;
}

/**
 * Set a nested value using dot notation
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-separated path
 * @param {*} value - Value to set
 */
function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part]) current[part] = {};
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Finalize a task object into the expected format
 * @param {Object} raw - Raw parsed task
 * @returns {Object} - Formatted task
 */
function finalizeTask(raw) {
  return {
    id: raw.id,
    goalId: raw.goalId,
    sequenceNumber: raw.sequenceNumber || 0,
    title: raw.title || '',
    description: raw.description || '',
    dependencies: (raw.dependencies || []).map(d => ({
      taskId: d.taskId,
      type: d.type || 'completion'
    })),
    tool: {
      toolName: raw.toolName,
      toolDescription: raw.toolDescription || '',
      command: {
        action: raw.action || raw.toolName,
        parameters: raw.parameters || {},
        expectedOutput: raw.expectedOutput || ''
      },
      fallbackTool: raw.fallbackTool || null
    },
    effort: {
      estimatedMinutes: raw.estimatedMinutes || 5,
      complexity: raw.complexity || 'medium'
    }
  };
}

/**
 * Validate parsed task response
 * @param {Object} parsed - Parsed TOML response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTaskTomlResponse(parsed) {
  const errors = [];

  if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
    errors.push('Missing or invalid tasks array');
  } else {
    for (let i = 0; i < parsed.tasks.length; i++) {
      const task = parsed.tasks[i];
      if (!task.id) errors.push(`Task ${i}: missing id`);
      if (!task.goalId) errors.push(`Task ${i}: missing goalId`);
      if (!task.title) errors.push(`Task ${i}: missing title`);
      if (!task.tool?.toolName) errors.push(`Task ${i}: missing toolName`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default { parseTaskToml, validateTaskTomlResponse };
