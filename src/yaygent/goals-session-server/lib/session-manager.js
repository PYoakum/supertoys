/**
 * @fileoverview Session Manager for session lifecycle management
 * @module session-manager
 */

import { randomUUID } from 'crypto';
import { SessionStore } from './session-store.js';
import { 
  ValidationError, 
  SessionInvalidStateError,
  SessionNotFoundError 
} from './errors.js';

/**
 * Session states
 * @readonly
 * @enum {string}
 */
export const SessionState = {
  CREATED: 'CREATED',
  LOADED: 'LOADED',
  EVALUATED: 'EVALUATED',
  GENERATED: 'GENERATED',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR'
};

/**
 * Goal states
 * @readonly
 * @enum {string}
 */
export const GoalState = {
  PENDING: 'pending',
  BLOCKED: 'blocked',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

/**
 * Valid state transitions
 * @type {Object.<string, string[]>}
 */
const STATE_TRANSITIONS = {
  [SessionState.CREATED]: [SessionState.LOADED, SessionState.ERROR],
  [SessionState.LOADED]: [SessionState.EVALUATED, SessionState.ERROR],
  [SessionState.EVALUATED]: [SessionState.GENERATED, SessionState.ERROR],
  [SessionState.GENERATED]: [SessionState.COMPLETE, SessionState.ERROR],
  [SessionState.COMPLETE]: [],
  [SessionState.ERROR]: [SessionState.LOADED] // Allow retry from error
};

/**
 * Session Manager class
 */
export class SessionManager {
  /**
   * @param {Object} [options={}]
   * @param {Object} [options.storeOptions] - Options for the session store
   */
  constructor(options = {}) {
    /** @type {SessionStore} */
    this.store = new SessionStore(options.storeOptions);
  }

  /**
   * Create a new session with goals and context
   * @param {Object} params
   * @param {Object} params.goals - Goals definition
   * @param {Object} params.context - Context bundle
   * @param {Object} [params.metadata] - Additional metadata
   * @param {Object} [params.llmRouting] - LLM routing configuration for per-task inference
   * @returns {Object} Created session
   */
  createSession({ goals, context, metadata = {}, llmRouting = null }) {
    // Validate goals
    this.validateGoals(goals);

    // Validate context
    this.validateContext(context);

    const sessionId = randomUUID();

    // Transform goals into checklist format
    const goalsChecklist = this.transformGoalsToChecklist(goals);

    // Process context bundle
    const contextBundle = this.processContext(context);

    // Build LLM routing config from environment if not provided
    const llmConfig = llmRouting || this._buildLLMRoutingFromEnv();

    const session = {
      id: sessionId,
      state: SessionState.LOADED,
      goals: goalsChecklist,
      context: contextBundle,
      evaluation: null,
      taskList: null,
      llmRouting: llmConfig,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
        sourceIp: metadata.sourceIp || null,
        userAgent: metadata.userAgent || null
      },
      error: null
    };

    return this.store.create(session);
  }

  /**
   * Build LLM routing configuration from environment variables
   * @returns {Object}
   * @private
   */
  _buildLLMRoutingFromEnv() {
    const tiers = ['PRIMARY', 'SECONDARY', 'TERTIARY', 'QUATERNARY', 'QUINARY'];
    const routing = {
      defaultTier: 'PRIMARY',
      tiers: {}
    };

    for (const tier of tiers) {
      const provider = process.env[`${tier}_LLM_PROVIDER`] || (tier === 'PRIMARY' ? process.env.LLM_PROVIDER : '');
      const apiKey = process.env[`${tier}_LLM_API_KEY`] || (tier === 'PRIMARY' ? process.env.LLM_API_KEY : '');
      const endpoint = process.env[`${tier}_LLM_ENDPOINT`] || (tier === 'PRIMARY' ? process.env.LLM_ENDPOINT : '');
      const model = process.env[`${tier}_LLM_MODEL`] || (tier === 'PRIMARY' ? process.env.LLM_MODEL : '');

      if (apiKey) {
        routing.tiers[tier] = {
          provider: provider || 'anthropic',
          endpoint: endpoint || '',
          model: model || '',
          configured: true
        };
      }
    }

    return routing;
  }

  /**
   * Get a session by ID
   * @param {string} sessionId
   * @returns {Object}
   */
  getSession(sessionId) {
    return this.store.get(sessionId);
  }

  /**
   * List sessions
   * @param {Object} [options]
   * @returns {{sessions: Object[], pagination: Object}}
   */
  listSessions(options) {
    return this.store.list(options);
  }

  /**
   * Delete a session
   * @param {string} sessionId
   * @returns {boolean}
   */
  deleteSession(sessionId) {
    // Verify it exists first
    this.store.get(sessionId);
    return this.store.delete(sessionId);
  }

  /**
   * Update session state
   * @param {string} sessionId
   * @param {string} newState
   * @param {Object} [additionalData={}]
   * @returns {Object}
   */
  updateState(sessionId, newState, additionalData = {}) {
    const session = this.store.get(sessionId);
    
    // Validate state transition
    const validTransitions = STATE_TRANSITIONS[session.state] || [];
    if (!validTransitions.includes(newState)) {
      throw new SessionInvalidStateError(
        sessionId,
        session.state,
        newState
      );
    }
    
    return this.store.update(sessionId, {
      state: newState,
      ...additionalData
    });
  }

  /**
   * Set evaluation result
   * @param {string} sessionId
   * @param {Object} evaluationResult
   * @returns {Object}
   */
  setEvaluation(sessionId, evaluationResult) {
    const session = this.store.get(sessionId);
    
    if (session.state !== SessionState.LOADED) {
      throw new SessionInvalidStateError(
        sessionId,
        session.state,
        SessionState.LOADED
      );
    }
    
    // Update goals with inferred dependencies and execution order
    const updatedGoals = this.applyEvaluationToGoals(
      session.goals,
      evaluationResult
    );
    
    return this.store.update(sessionId, {
      state: SessionState.EVALUATED,
      goals: updatedGoals,
      evaluation: evaluationResult
    });
  }

  /**
   * Set task list
   * @param {string} sessionId
   * @param {Object} taskList
   * @returns {Object}
   */
  setTaskList(sessionId, taskList) {
    const session = this.store.get(sessionId);

    // Allow setting tasks when EVALUATED (first time) or GENERATED (editing)
    if (session.state !== SessionState.EVALUATED && session.state !== SessionState.GENERATED) {
      throw new SessionInvalidStateError(
        sessionId,
        session.state,
        `${SessionState.EVALUATED} or ${SessionState.GENERATED}`
      );
    }

    return this.store.update(sessionId, {
      state: SessionState.GENERATED,
      taskList
    });
  }

  /**
   * Update a goal's status
   * @param {string} sessionId
   * @param {string} goalId
   * @param {Object} updates
   * @returns {Object}
   */
  updateGoal(sessionId, goalId, updates) {
    const session = this.store.get(sessionId);
    
    const goalIndex = session.goals.items.findIndex(g => g.id === goalId);
    if (goalIndex === -1) {
      throw new ValidationError(`Goal not found: ${goalId}`, 'goalId');
    }
    
    // Update the goal
    const updatedItems = [...session.goals.items];
    updatedItems[goalIndex] = {
      ...updatedItems[goalIndex],
      status: {
        ...updatedItems[goalIndex].status,
        ...updates.status
      },
      notes: updates.notes ?? updatedItems[goalIndex].notes,
      completedAt: updates.status?.state === GoalState.COMPLETED 
        ? new Date().toISOString() 
        : updatedItems[goalIndex].completedAt
    };
    
    return this.store.update(sessionId, {
      goals: {
        ...session.goals,
        items: updatedItems
      }
    });
  }

  /**
   * Update a task's status
   * @param {string} sessionId
   * @param {string} taskId
   * @param {Object} updates
   * @returns {Object}
   */
  updateTask(sessionId, taskId, updates) {
    const session = this.store.get(sessionId);
    
    if (!session.taskList) {
      throw new ValidationError('Session has no task list', 'taskList');
    }
    
    const taskIndex = session.taskList.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      throw new ValidationError(`Task not found: ${taskId}`, 'taskId');
    }
    
    // Update the task
    const updatedTasks = [...session.taskList.tasks];
    updatedTasks[taskIndex] = {
      ...updatedTasks[taskIndex],
      state: updates.state ?? updatedTasks[taskIndex].state,
      result: updates.result ?? updatedTasks[taskIndex].result
    };
    
    // Update summary
    const tasksByState = {};
    for (const task of updatedTasks) {
      tasksByState[task.state] = (tasksByState[task.state] || 0) + 1;
    }
    
    return this.store.update(sessionId, {
      taskList: {
        ...session.taskList,
        tasks: updatedTasks,
        summary: {
          ...session.taskList.summary,
          tasksByState
        }
      }
    });
  }

  /**
   * Set error state
   * @param {string} sessionId
   * @param {Error} error
   * @returns {Object}
   */
  setError(sessionId, error) {
    return this.store.update(sessionId, {
      state: SessionState.ERROR,
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        timestamp: new Date().toISOString(),
        details: error.details || {}
      }
    });
  }

  /**
   * Validate goals object
   * @param {Object} goals
   * @throws {ValidationError}
   * @private
   */
  validateGoals(goals) {
    if (!goals || typeof goals !== 'object') {
      throw new ValidationError('Goals must be an object', 'goals');
    }
    
    if (!goals.version) {
      throw new ValidationError('Goals must have a version', 'goals.version');
    }
    
    if (!goals.goals || !Array.isArray(goals.goals)) {
      throw new ValidationError('Goals must have a goals array', 'goals.goals');
    }
    
    if (goals.goals.length === 0) {
      throw new ValidationError('Goals array must not be empty', 'goals.goals');
    }
    
    // Validate each goal
    for (let i = 0; i < goals.goals.length; i++) {
      const goal = goals.goals[i];
      
      if (!goal.id) {
        throw new ValidationError(`Goal at index ${i} must have an id`, `goals.goals[${i}].id`);
      }
      
      if (!goal.objective) {
        throw new ValidationError(`Goal at index ${i} must have an objective`, `goals.goals[${i}].objective`);
      }
    }
  }

  /**
   * Validate context object
   * @param {Object} context
   * @throws {ValidationError}
   * @private
   */
  validateContext(context) {
    if (!context || typeof context !== 'object') {
      throw new ValidationError('Context must be an object', 'context');
    }
    
    if (!context.files || !Array.isArray(context.files)) {
      throw new ValidationError('Context must have a files array', 'context.files');
    }
  }

  /**
   * Transform goals into checklist format
   * @param {Object} goals
   * @returns {Object}
   * @private
   */
  transformGoalsToChecklist(goals) {
    return {
      version: goals.version,
      metadata: {
        ...goals.metadata,
        loadedAt: new Date().toISOString()
      },
      items: goals.goals.map((goal, index) => ({
        id: goal.id,
        objective: goal.objective,
        priority: goal.priority ?? 5,
        criteria: goal.criteria ?? { success: [], acceptance: [], validation: 'manual' },
        constraints: goal.constraints ?? [],
        context: goal.context ?? {},
        
        // Checklist-specific fields
        status: {
          state: GoalState.PENDING,
          progress: 0,
          completedCriteria: [],
          blockers: []
        },
        dependencies: {
          declaredDependencies: goal.dependencies?.declaredDependencies ?? [],
          inferredDependencies: [],
          allDependencies: goal.dependencies?.declaredDependencies ?? [],
          dependencyStatus: []
        },
        executionIndex: null,
        assignedAt: null,
        completedAt: null,
        notes: null
      })),
      globalContext: goals.globalContext ?? {},
      dependencyGraph: null,
      executionOrder: null
    };
  }

  /**
   * Process context into bundle format
   * @param {Object} context
   * @returns {Object}
   * @private
   */
  processContext(context) {
    // Generate content hash
    const contentHash = this.hashContent(
      context.files.map(f => f.content).join('')
    );
    
    // Format context for LLM consumption
    const formattedContent = this.formatContextAsXml(context.files);
    
    return {
      files: context.files.map(f => ({
        path: f.path,
        content: f.content,
        extension: f.extension || this.getExtension(f.path),
        size: f.size || f.content.length,
        contentHash: this.hashContent(f.content)
      })),
      metadata: context.metadata || {
        totalFiles: context.files.length,
        totalSize: context.files.reduce((sum, f) => sum + (f.size || f.content.length), 0)
      },
      formattedContent,
      contentHash
    };
  }

  /**
   * Apply evaluation results to goals
   * @param {Object} goals
   * @param {Object} evaluation
   * @returns {Object}
   * @private
   */
  applyEvaluationToGoals(goals, evaluation) {
    const { executionOrder, inferredDependencies } = evaluation;
    
    // Build dependency map
    const inferredDepsMap = new Map();
    for (const dep of inferredDependencies || []) {
      if (!inferredDepsMap.has(dep.goalId)) {
        inferredDepsMap.set(dep.goalId, []);
      }
      inferredDepsMap.get(dep.goalId).push(dep.dependsOn);
    }
    
    // Update items with execution order and inferred dependencies
    const updatedItems = goals.items.map(item => {
      const inferredDeps = inferredDepsMap.get(item.id) || [];
      const declaredDeps = Array.isArray(item.dependencies?.declaredDependencies)
        ? item.dependencies.declaredDependencies
        : [];
      const allDeps = [...new Set([...declaredDeps, ...inferredDeps])];
      
      // Calculate execution index
      const execIndex = executionOrder ? executionOrder.indexOf(item.id) : null;
      
      // Determine if blocked
      const isBlocked = allDeps.some(depId => {
        const depGoal = goals.items.find(g => g.id === depId);
        return depGoal && depGoal.status.state !== GoalState.COMPLETED;
      });
      
      return {
        ...item,
        dependencies: {
          ...item.dependencies,
          inferredDependencies: inferredDeps,
          allDependencies: allDeps,
          dependencyStatus: allDeps.map(depId => ({
            goalId: depId,
            satisfied: false,
            satisfiedAt: null
          }))
        },
        executionIndex: execIndex !== -1 ? execIndex : null,
        status: {
          ...item.status,
          state: isBlocked ? GoalState.BLOCKED : GoalState.PENDING
        }
      };
    });
    
    return {
      ...goals,
      items: updatedItems,
      executionOrder,
      dependencyGraph: this.buildDependencyGraph(updatedItems)
    };
  }

  /**
   * Build dependency graph
   * @param {Object[]} items
   * @returns {Object}
   * @private
   */
  buildDependencyGraph(items) {
    const graph = {
      nodes: items.map(i => i.id),
      edges: []
    };
    
    for (const item of items) {
      for (const depId of item.dependencies.allDependencies) {
        graph.edges.push({
          from: depId,
          to: item.id
        });
      }
    }
    
    return graph;
  }

  /**
   * Format context files as XML
   * @param {Object[]} files
   * @returns {string}
   * @private
   */
  formatContextAsXml(files) {
    const lines = ['<context>'];
    
    for (const file of files) {
      const ext = file.extension || this.getExtension(file.path);
      lines.push(`  <file path="${this.escapeXml(file.path)}" extension="${ext}">`);
      lines.push(this.escapeXml(file.content));
      lines.push('  </file>');
    }
    
    lines.push('</context>');
    return lines.join('\n');
  }

  /**
   * Get file extension
   * @param {string} path
   * @returns {string}
   * @private
   */
  getExtension(path) {
    const match = path.match(/\.([^.]+)$/);
    return match ? `.${match[1]}` : '';
  }

  /**
   * Escape XML special characters
   * @param {string} str
   * @returns {string}
   * @private
   */
  escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Simple hash function for content
   * @param {string} content
   * @returns {string}
   * @private
   */
  hashContent(content) {
    // Simple hash for demonstration - in production use crypto
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Get store statistics
   * @returns {Object}
   */
  getStats() {
    return this.store.getStats();
  }

  /**
   * Shutdown the session manager
   */
  shutdown() {
    this.store.stopCleanup();
  }
}

export default SessionManager;
