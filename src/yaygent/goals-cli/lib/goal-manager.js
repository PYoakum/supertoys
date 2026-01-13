/**
 * @fileoverview GoalManager class for loading and validating goal definitions
 * @module goal-manager
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { GoalsFileError, ValidationError, ErrorCodes } from './errors.js';

/**
 * @typedef {Object} Goal
 * @property {string} id - Unique identifier (kebab-case)
 * @property {string} objective - Clear statement of what should be accomplished
 * @property {number} [priority=5] - Priority level (1-10)
 * @property {GoalCriteria} [criteria] - Success and acceptance criteria
 * @property {string[]} [constraints] - Limitations or restrictions
 * @property {string[]} [dependencies] - IDs of goals that must complete first
 * @property {Object.<string, string>} [context] - Goal-specific context
 */

/**
 * @typedef {Object} GoalCriteria
 * @property {string[]} [success] - Conditions that define success
 * @property {string[]} [acceptance] - Minimum requirements for acceptance
 * @property {'manual'|'automated'|'hybrid'} [validation='manual'] - How success will be validated
 */

/**
 * @typedef {Object} GoalsDefinition
 * @property {string} version - Schema version
 * @property {Object} [metadata] - Goals metadata
 * @property {Goal[]} goals - Array of goal definitions
 * @property {Object.<string, string>} [globalContext] - Global context key-value pairs
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {string[]} errors - Array of error messages
 * @property {string[]} warnings - Array of warning messages
 */

/**
 * GoalManager class for managing goal definitions
 */
export class GoalManager {
  /**
   * @param {string} goalsPath - Path to the goals JSON file
   */
  constructor(goalsPath) {
    /** @type {string} */
    this.goalsPath = goalsPath;
    
    /** @type {GoalsDefinition|null} */
    this.definition = null;
    
    /** @type {boolean} */
    this.loaded = false;
  }

  /**
   * Load and validate goals from the configured path
   * @returns {Promise<GoalsDefinition>}
   * @throws {GoalsFileError}
   */
  async load() {
    // Check file exists
    if (!existsSync(this.goalsPath)) {
      throw new GoalsFileError(
        `Goals file not found: ${this.goalsPath}`,
        ErrorCodes.GOALS_FILE_NOT_FOUND,
        { path: this.goalsPath }
      );
    }

    // Read file content
    let content;
    try {
      content = await readFile(this.goalsPath, 'utf-8');
    } catch (err) {
      throw new GoalsFileError(
        `Failed to read goals file: ${err.message}`,
        ErrorCodes.GOALS_FILE_NOT_FOUND,
        { path: this.goalsPath, originalError: err.message }
      );
    }

    // Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new GoalsFileError(
        `Goals file is not valid JSON: ${err.message}`,
        ErrorCodes.GOALS_FILE_INVALID_JSON,
        { path: this.goalsPath, parseError: err.message }
      );
    }

    // Validate structure
    const validation = this.validate(parsed);
    if (!validation.valid) {
      throw new GoalsFileError(
        `Goals file fails validation: ${validation.errors.join('; ')}`,
        ErrorCodes.GOALS_FILE_SCHEMA_INVALID,
        { path: this.goalsPath, validationErrors: validation.errors }
      );
    }

    // Apply defaults
    this.definition = this.applyDefaults(parsed);
    this.loaded = true;

    return this.definition;
  }

  /**
   * Get all goals
   * @returns {Goal[]}
   * @throws {Error} If goals not loaded
   */
  getGoals() {
    this.ensureLoaded();
    return this.definition.goals;
  }

  /**
   * Get a specific goal by ID
   * @param {string} goalId - Goal identifier
   * @returns {Goal|undefined}
   */
  getGoal(goalId) {
    this.ensureLoaded();
    return this.definition.goals.find(g => g.id === goalId);
  }

  /**
   * Get goals sorted by priority
   * @returns {Goal[]}
   */
  getGoalsByPriority() {
    this.ensureLoaded();
    return [...this.definition.goals].sort((a, b) => 
      (a.priority || 5) - (b.priority || 5)
    );
  }

  /**
   * Get the complete definition
   * @returns {GoalsDefinition}
   */
  getDefinition() {
    this.ensureLoaded();
    return this.definition;
  }

  /**
   * Get global context
   * @returns {Object.<string, string>}
   */
  getGlobalContext() {
    this.ensureLoaded();
    return this.definition.globalContext || {};
  }

  /**
   * Get metadata
   * @returns {Object}
   */
  getMetadata() {
    this.ensureLoaded();
    return this.definition.metadata || {};
  }

  /**
   * Validate a goals definition object
   * @param {Object} definition - Object to validate
   * @returns {ValidationResult}
   */
  validate(definition) {
    const errors = [];
    const warnings = [];

    // Check required fields
    if (!definition || typeof definition !== 'object') {
      errors.push('Goals definition must be an object');
      return { valid: false, errors, warnings };
    }

    if (!definition.version) {
      errors.push('Missing required field: version');
    } else if (!/^\d+\.\d+$/.test(definition.version)) {
      errors.push(`Invalid version format: ${definition.version}. Expected format: X.Y (e.g., '1.0')`);
    }

    if (!definition.goals) {
      errors.push('Missing required field: goals');
    } else if (!Array.isArray(definition.goals)) {
      errors.push('Field "goals" must be an array');
    } else if (definition.goals.length === 0) {
      errors.push('Goals array must contain at least one goal');
    } else {
      // Validate each goal
      const goalIds = new Set();
      
      for (let i = 0; i < definition.goals.length; i++) {
        const goal = definition.goals[i];
        const prefix = `goals[${i}]`;
        
        // Validate goal structure
        const goalErrors = this.validateGoal(goal, prefix, goalIds);
        errors.push(...goalErrors);
      }

      // Validate dependencies reference valid goal IDs
      for (const goal of definition.goals) {
        if (goal.dependencies) {
          for (const depId of goal.dependencies) {
            if (!goalIds.has(depId)) {
              errors.push(`Goal "${goal.id}" has dependency on non-existent goal: "${depId}"`);
            }
            if (depId === goal.id) {
              errors.push(`Goal "${goal.id}" cannot depend on itself`);
            }
          }
        }
      }

      // Check for circular dependencies
      const circularCheck = this.checkCircularDependencies(definition.goals);
      if (circularCheck.hasCircular) {
        errors.push(`Circular dependency detected: ${circularCheck.cycle.join(' -> ')}`);
      }
    }

    // Validate globalContext if present
    if (definition.globalContext !== undefined) {
      if (typeof definition.globalContext !== 'object' || Array.isArray(definition.globalContext)) {
        errors.push('Field "globalContext" must be an object');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate a single goal object
   * @param {Object} goal - Goal to validate
   * @param {string} prefix - Error message prefix
   * @param {Set<string>} goalIds - Set of goal IDs for uniqueness check
   * @returns {string[]} Array of error messages
   * @private
   */
  validateGoal(goal, prefix, goalIds) {
    const errors = [];

    if (!goal || typeof goal !== 'object') {
      errors.push(`${prefix}: Must be an object`);
      return errors;
    }

    // Required fields
    if (!goal.id) {
      errors.push(`${prefix}: Missing required field "id"`);
    } else {
      if (typeof goal.id !== 'string') {
        errors.push(`${prefix}.id: Must be a string`);
      } else if (!/^[a-z][a-z0-9-]*$/.test(goal.id)) {
        errors.push(`${prefix}.id: Must be kebab-case starting with a letter (got: "${goal.id}")`);
      } else if (goalIds.has(goal.id)) {
        errors.push(`${prefix}.id: Duplicate goal ID "${goal.id}"`);
      } else {
        goalIds.add(goal.id);
      }
    }

    if (!goal.objective) {
      errors.push(`${prefix}: Missing required field "objective"`);
    } else if (typeof goal.objective !== 'string') {
      errors.push(`${prefix}.objective: Must be a string`);
    } else if (goal.objective.length < 10) {
      errors.push(`${prefix}.objective: Must be at least 10 characters (got: ${goal.objective.length})`);
    }

    // Optional fields with type checking
    if (goal.priority !== undefined) {
      if (typeof goal.priority !== 'number' || !Number.isInteger(goal.priority)) {
        errors.push(`${prefix}.priority: Must be an integer`);
      } else if (goal.priority < 1 || goal.priority > 10) {
        errors.push(`${prefix}.priority: Must be between 1 and 10 (got: ${goal.priority})`);
      }
    }

    if (goal.constraints !== undefined) {
      if (!Array.isArray(goal.constraints)) {
        errors.push(`${prefix}.constraints: Must be an array`);
      } else {
        for (let i = 0; i < goal.constraints.length; i++) {
          if (typeof goal.constraints[i] !== 'string') {
            errors.push(`${prefix}.constraints[${i}]: Must be a string`);
          }
        }
      }
    }

    if (goal.dependencies !== undefined) {
      if (!Array.isArray(goal.dependencies)) {
        errors.push(`${prefix}.dependencies: Must be an array`);
      } else {
        for (let i = 0; i < goal.dependencies.length; i++) {
          if (typeof goal.dependencies[i] !== 'string') {
            errors.push(`${prefix}.dependencies[${i}]: Must be a string`);
          }
        }
      }
    }

    if (goal.criteria !== undefined) {
      const criteriaErrors = this.validateCriteria(goal.criteria, `${prefix}.criteria`);
      errors.push(...criteriaErrors);
    }

    if (goal.context !== undefined) {
      if (typeof goal.context !== 'object' || Array.isArray(goal.context)) {
        errors.push(`${prefix}.context: Must be an object`);
      }
    }

    return errors;
  }

  /**
   * Validate criteria object
   * @param {Object} criteria - Criteria to validate
   * @param {string} prefix - Error message prefix
   * @returns {string[]} Array of error messages
   * @private
   */
  validateCriteria(criteria, prefix) {
    const errors = [];

    if (typeof criteria !== 'object' || Array.isArray(criteria)) {
      errors.push(`${prefix}: Must be an object`);
      return errors;
    }

    if (criteria.success !== undefined) {
      if (!Array.isArray(criteria.success)) {
        errors.push(`${prefix}.success: Must be an array`);
      }
    }

    if (criteria.acceptance !== undefined) {
      if (!Array.isArray(criteria.acceptance)) {
        errors.push(`${prefix}.acceptance: Must be an array`);
      }
    }

    if (criteria.validation !== undefined) {
      const validTypes = ['manual', 'automated', 'hybrid'];
      if (!validTypes.includes(criteria.validation)) {
        errors.push(`${prefix}.validation: Must be one of: ${validTypes.join(', ')}`);
      }
    }

    return errors;
  }

  /**
   * Check for circular dependencies in goals
   * @param {Goal[]} goals - Array of goals
   * @returns {{hasCircular: boolean, cycle: string[]}}
   * @private
   */
  checkCircularDependencies(goals) {
    const goalMap = new Map(goals.map(g => [g.id, g]));
    const visited = new Set();
    const recursionStack = new Set();

    const detectCycle = (goalId, path = []) => {
      if (recursionStack.has(goalId)) {
        return { hasCircular: true, cycle: [...path, goalId] };
      }
      
      if (visited.has(goalId)) {
        return { hasCircular: false, cycle: [] };
      }

      visited.add(goalId);
      recursionStack.add(goalId);

      const goal = goalMap.get(goalId);
      if (goal && goal.dependencies) {
        for (const depId of goal.dependencies) {
          const result = detectCycle(depId, [...path, goalId]);
          if (result.hasCircular) {
            return result;
          }
        }
      }

      recursionStack.delete(goalId);
      return { hasCircular: false, cycle: [] };
    };

    for (const goal of goals) {
      const result = detectCycle(goal.id, []);
      if (result.hasCircular) {
        return result;
      }
    }

    return { hasCircular: false, cycle: [] };
  }

  /**
   * Apply default values to the definition
   * @param {Object} definition - Raw definition
   * @returns {GoalsDefinition}
   * @private
   */
  applyDefaults(definition) {
    const result = { ...definition };
    
    result.goals = definition.goals.map(goal => ({
      ...goal,
      priority: goal.priority ?? 5,
      constraints: goal.constraints ?? [],
      dependencies: goal.dependencies ?? [],
      criteria: goal.criteria ?? { success: [], acceptance: [], validation: 'manual' },
      context: goal.context ?? {}
    }));

    result.globalContext = definition.globalContext ?? {};
    result.metadata = definition.metadata ?? {};

    return result;
  }

  /**
   * Ensure goals are loaded
   * @throws {Error} If goals not loaded
   * @private
   */
  ensureLoaded() {
    if (!this.loaded) {
      throw new Error('Goals not loaded. Call load() first.');
    }
  }
}

export default GoalManager;
