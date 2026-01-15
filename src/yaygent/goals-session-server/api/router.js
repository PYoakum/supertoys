/**
 * @fileoverview REST API router for Goals Session Server
 * @module api/router
 */

import { ServerError, ValidationError, ToolBindingError, ToolNotFoundError } from '../lib/errors.js';
import {
  buildEvaluationPrompt,
  buildTaskGenerationPrompt,
  parseJsonResponse,
  validateEvaluationResponse
} from '../prompts/templates.js';
import { parseTaskToml, validateTaskTomlResponse } from '../lib/toml-parser.js';
import { LLMLogger } from '../lib/llm-logger.js';
import {
  loadObjectFromFile,
  loadObjectFromUrl,
  coerceConfigToProjectGoals,
  mergeGoals,
  validateGoalsStructure
} from '../lib/config-loader.js';
import {
  getByPath,
  setByPath,
  collectContentStringPaths,
  shouldIncludePath
} from '../lib/path-utils.js';

/**
 * Simple router for HTTP request handling
 */
export class Router {
  constructor() {
    /** @type {Map<string, Map<string, Function>>} */
    this.routes = new Map();
    
    // Initialize method maps
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      this.routes.set(method, new Map());
    }
  }

  /**
   * Register a route
   * @param {string} method - HTTP method
   * @param {string} path - Route path (supports :param syntax)
   * @param {Function} handler - Route handler
   */
  register(method, path, handler) {
    const methodRoutes = this.routes.get(method.toUpperCase());
    if (methodRoutes) {
      methodRoutes.set(path, handler);
    }
  }

  /**
   * Convenience methods
   */
  get(path, handler) { this.register('GET', path, handler); }
  post(path, handler) { this.register('POST', path, handler); }
  put(path, handler) { this.register('PUT', path, handler); }
  delete(path, handler) { this.register('DELETE', path, handler); }
  patch(path, handler) { this.register('PATCH', path, handler); }

  /**
   * Match a request to a route
   * @param {string} method - HTTP method
   * @param {string} pathname - Request pathname
   * @returns {{handler: Function, params: Object}|null}
   */
  match(method, pathname) {
    const methodRoutes = this.routes.get(method.toUpperCase());
    if (!methodRoutes) return null;

    // Try exact match first
    const exactHandler = methodRoutes.get(pathname);
    if (exactHandler) {
      return { handler: exactHandler, params: {} };
    }

    // Try pattern matching
    for (const [pattern, handler] of methodRoutes) {
      const params = this.matchPattern(pattern, pathname);
      if (params) {
        return { handler, params };
      }
    }

    return null;
  }

  /**
   * Match a URL pattern to a pathname
   * @param {string} pattern - Route pattern
   * @param {string} pathname - Actual pathname
   * @returns {Object|null} - Matched parameters or null
   */
  matchPattern(pattern, pathname) {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) {
      return null;
    }

    const params = {};

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart.startsWith(':')) {
        // Parameter
        const paramName = patternPart.slice(1);
        params[paramName] = pathPart;
      } else if (patternPart !== pathPart) {
        // No match
        return null;
      }
    }

    return params;
  }
}

/**
 * Create request context from request
 * @param {Request} request
 * @param {Object} params - Route parameters
 * @returns {Promise<Object>}
 */
async function createContext(request, params) {
  const url = new URL(request.url);
  
  // Parse query parameters
  const query = Object.fromEntries(url.searchParams);
  
  // Parse body for POST/PUT/PATCH
  let body = null;
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await request.json();
      } catch (err) {
        throw new ValidationError('Invalid JSON body', 'body');
      }
    }
  }
  
  return {
    method: request.method,
    path: url.pathname,
    params,
    query,
    body,
    headers: Object.fromEntries(request.headers),
    ip: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown'
  };
}

/**
 * Create JSON response
 * @param {Object} data - Response data
 * @param {number} [status=200] - HTTP status code
 * @param {Object} [headers={}] - Additional headers
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

/**
 * Create error response
 * @param {Error} error
 * @returns {Response}
 */
export function errorResponse(error) {
  if (error instanceof ServerError) {
    return jsonResponse(error.toJSON(), error.statusCode);
  }
  
  // Generic error
  return jsonResponse({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: error.message
    }
  }, 500);
}

/**
 * Create the API handler
 * @param {Object} services - Injected services
 * @param {import('../lib/session-manager.js').SessionManager} services.sessionManager
 * @param {import('../lib/tool-router.js').ToolRouter} services.toolRouter
 * @param {import('../lib/llm-client.js').LLMClient} services.llmClient
 * @param {Object} services.config
 * @returns {Function}
 */
export function createApiHandler(services) {
  const router = new Router();
  const { sessionManager, toolRouter, llmClient, config } = services;

  // Initialize LLM logger
  const llmLogger = new LLMLogger({
    baseDir: config.logging?.llmLogDir || './llm-logs',
    enabled: config.logging?.llmLogging !== false
  });

  // Attach logger to LLM client
  if (llmClient) {
    llmClient.setLogger(llmLogger);
  }

  // Import route handlers
  const sessionRoutes = createSessionRoutes(sessionManager);
  const evaluateRoutes = createEvaluateRoutes(sessionManager, llmClient);
  const tasklistRoutes = createTasklistRoutes(sessionManager, toolRouter, llmClient);
  const toolRoutes = createToolRoutes(toolRouter);
  const importRoutes = createImportRoutes(sessionManager);
  const aiEditRoutes = createAiEditRoutes(sessionManager, llmClient);

  // Register routes

  // Sessions
  router.post('/api/sessions', sessionRoutes.create);
  router.get('/api/sessions', sessionRoutes.list);
  router.get('/api/sessions/ready', sessionRoutes.listReady);
  router.get('/api/sessions/:id', sessionRoutes.get);
  router.delete('/api/sessions/:id', sessionRoutes.delete);

  // Import
  router.post('/api/sessions/import', importRoutes.importGoals);

  // AI Edit
  router.post('/api/ai-edit', aiEditRoutes.edit);

  // Evaluation
  router.post('/api/evaluate', evaluateRoutes.evaluate);

  // Task list
  router.post('/api/tasklist/generate', tasklistRoutes.generate);

  // Tools
  router.get('/api/tools', toolRoutes.list);
  router.get('/api/tools/:name', toolRoutes.get);
  router.post('/api/tools/execute', toolRoutes.execute);

  // Health
  router.get('/health', async () => {
    const stats = sessionManager.getStats();
    const llmHealthy = llmClient ? await llmClient.healthCheck() : false;
    
    return jsonResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      components: {
        sessionStore: 'healthy',
        toolRouter: toolRouter ? 'healthy' : 'unavailable',
        llmClient: llmHealthy ? 'healthy' : 'unavailable'
      },
      stats: {
        activeSessions: stats.totalSessions,
        uptime: process.uptime ? Math.floor(process.uptime()) : 0
      }
    });
  });

  // Return handler function
  return async (request) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }

    const url = new URL(request.url);
    const match = router.match(request.method, url.pathname);

    if (!match) {
      return jsonResponse({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Route not found: ${request.method} ${url.pathname}`
        }
      }, 404);
    }

    try {
      const ctx = await createContext(request, match.params);
      const response = await match.handler(ctx);
      
      // Add CORS headers
      if (response instanceof Response) {
        response.headers.set('Access-Control-Allow-Origin', '*');
        return response;
      }
      
      return jsonResponse(response);
    } catch (error) {
      console.error('API Error:', error);
      return errorResponse(error);
    }
  };
}

/**
 * Create session route handlers
 */
function createSessionRoutes(sessionManager) {
  return {
    async create(ctx) {
      const { goals, context } = ctx.body || {};
      
      if (!goals) {
        throw new ValidationError('goals is required', 'goals');
      }
      if (!context) {
        throw new ValidationError('context is required', 'context');
      }
      
      const session = sessionManager.createSession({
        goals,
        context,
        metadata: {
          sourceIp: ctx.ip,
          userAgent: ctx.userAgent
        }
      });
      
      return jsonResponse({
        success: true,
        data: {
          sessionId: session.id,
          state: session.state,
          createdAt: session.metadata.createdAt,
          goalsCount: session.goals.items.length,
          contextFilesCount: session.context.files.length,
          links: {
            self: `/api/sessions/${session.id}`,
            evaluate: '/api/evaluate',
            generate: '/api/tasklist/generate'
          }
        }
      }, 201);
    },

    async list(ctx) {
      const result = sessionManager.listSessions({
        state: ctx.query.state,
        limit: parseInt(ctx.query.limit, 10) || 20,
        offset: parseInt(ctx.query.offset, 10) || 0,
        sortBy: ctx.query.sortBy || 'createdAt',
        sortOrder: ctx.query.sortOrder || 'desc'
      });

      return jsonResponse({
        success: true,
        data: result
      });
    },

    async listReady(ctx) {
      // Get sessions that are ready for action-plan execution (state = GENERATED)
      const result = sessionManager.listSessions({
        state: 'GENERATED',
        limit: parseInt(ctx.query.limit, 10) || 50,
        offset: parseInt(ctx.query.offset, 10) || 0,
        sortBy: ctx.query.sortBy || 'createdAt',
        sortOrder: ctx.query.sortOrder || 'asc'  // Oldest first by default
      });

      // Enrich with task count info
      const enrichedSessions = result.sessions.map(s => {
        try {
          const fullSession = sessionManager.getSession(s.id);
          return {
            ...s,
            tasksCount: fullSession.taskList?.tasks?.length || 0,
            tasksByState: fullSession.taskList?.summary?.tasksByState || {}
          };
        } catch {
          return s;
        }
      });

      return jsonResponse({
        success: true,
        data: {
          sessions: enrichedSessions,
          pagination: result.pagination
        }
      });
    },

    async get(ctx) {
      const session = sessionManager.getSession(ctx.params.id);
      
      const includeContext = ctx.query.includeContext === 'true';
      const includeTaskList = ctx.query.includeTaskList !== 'false';
      
      const data = {
        id: session.id,
        state: session.state,
        goals: session.goals,
        context: includeContext ? session.context : {
          metadata: session.context.metadata,
          fileCount: session.context.files.length
        },
        evaluation: session.evaluation,
        taskList: includeTaskList ? session.taskList : null,
        metadata: session.metadata,
        error: session.error
      };
      
      return jsonResponse({
        success: true,
        data
      });
    },

    async delete(ctx) {
      sessionManager.deleteSession(ctx.params.id);

      return jsonResponse({
        success: true,
        data: {
          deleted: true,
          sessionId: ctx.params.id
        }
      });
    }
  };
}

/**
 * Create import route handlers
 */
function createImportRoutes(sessionManager) {
  return {
    /**
     * Import goals from file or URL
     * POST /api/sessions/import
     * Body: { source: "file" | "url", path: string, context?: Object, options?: { replace?: boolean } }
     */
    async importGoals(ctx) {
      const { source, path, context, options = {} } = ctx.body || {};

      if (!source) {
        throw new ValidationError('source is required (file or url)', 'source');
      }
      if (!path) {
        throw new ValidationError('path is required', 'path');
      }

      // Load from source
      let imported;
      try {
        if (source === 'file') {
          imported = await loadObjectFromFile(path);
        } else if (source === 'url') {
          imported = await loadObjectFromUrl(path);
        } else {
          throw new ValidationError('source must be "file" or "url"', 'source');
        }
      } catch (err) {
        throw new ValidationError(`Failed to load from ${source}: ${err.message}`, 'path');
      }

      // Coerce to standard format
      const { project, goals: importedGoals } = coerceConfigToProjectGoals(imported);

      // Validate imported goals
      const validation = validateGoalsStructure({ version: project.version || '1.0', goals: importedGoals });
      if (!validation.valid) {
        throw new ValidationError(
          `Imported goals are invalid: ${validation.errors.join('; ')}`,
          'goals'
        );
      }

      // Build context if not provided
      const sessionContext = context || {
        files: [],
        formattedContent: '',
        metadata: { source: source === 'file' ? path : 'url', importedAt: new Date().toISOString() }
      };

      // Create session with imported goals
      const goalsDefinition = {
        version: project.version || '1.0',
        goals: importedGoals,
        metadata: project.metadata,
        globalContext: project.globalContext
      };

      const session = sessionManager.createSession({
        goals: goalsDefinition,
        context: sessionContext,
        metadata: {
          sourceIp: ctx.ip,
          userAgent: ctx.userAgent,
          importSource: source,
          importPath: path
        }
      });

      return jsonResponse({
        success: true,
        data: {
          sessionId: session.id,
          state: session.state,
          importedGoals: importedGoals.length,
          source,
          path,
          links: {
            self: `/api/sessions/${session.id}`,
            evaluate: '/api/evaluate'
          }
        }
      }, 201);
    }
  };
}

/**
 * Create AI edit route handlers
 */
function createAiEditRoutes(sessionManager, llmClient) {
  const AI_EDIT_SYSTEM_PROMPT = `You are an expert at improving goal definitions for clarity and actionability.

For each input text, provide an enhanced version that is:
- More specific and measurable
- Clearer in intent and expected outcome
- Better structured for task decomposition
- Free of ambiguity and vague language

Maintain the original meaning and intent. Do not add new requirements.
Keep improvements concise - similar length to the original when possible.

Respond with a JSON array of objects, each with "path" and "text" fields:
[
  {"path": "goals[0].objective", "text": "Enhanced text here"},
  {"path": "goals[0].criteria.success[0]", "text": "Enhanced criterion"}
]

Only include items that you've actually improved. Skip items that are already well-written.`;

  return {
    /**
     * AI-edit goals content
     * POST /api/ai-edit
     * Body: { sessionId: string, options?: { include?: string[], exclude?: string[], preview?: boolean } }
     */
    async edit(ctx) {
      if (!llmClient) {
        throw new ValidationError('LLM client not configured', 'llmClient');
      }

      const { sessionId, options = {} } = ctx.body || {};

      if (!sessionId) {
        throw new ValidationError('sessionId is required', 'sessionId');
      }

      const session = sessionManager.getSession(sessionId);
      const { include = [], exclude = [], preview = false, batchSize = 10 } = options;

      // Get goals from session
      const goals = session.goals.items || [];
      const project = { metadata: session.goals.metadata };

      // Collect editable paths
      const allPaths = collectContentStringPaths(project, goals, { includeContext: false });

      // Filter paths
      const filteredPaths = allPaths.filter(p =>
        shouldIncludePath(p, include.length > 0 ? include : null, exclude)
      );

      if (filteredPaths.length === 0) {
        return jsonResponse({
          success: true,
          data: {
            sessionId,
            edited: 0,
            message: 'No matching paths found to edit'
          }
        });
      }

      // Collect candidates with their text
      const wrapper = { project, goals };
      const candidates = filteredPaths
        .map(path => ({ path, text: getByPath(wrapper, path) }))
        .filter(c => typeof c.text === 'string' && c.text.trim().length > 0);

      // Build prompt
      const userPrompt = `Please improve the following goal-related text items:

${JSON.stringify(candidates.map(c => ({ path: c.path, text: c.text })), null, 2)}

Respond with a JSON array of improved items. Only include items you've actually changed.`;

      // Send to LLM
      const response = await llmClient.send({
        systemPrompt: AI_EDIT_SYSTEM_PROMPT,
        userPrompt,
        parameters: { temperature: 0.3, maxTokens: 4096 },
        sessionId,
        operation: 'ai-edit'
      });

      // Parse response
      let edits = [];
      try {
        const match = response.content.match(/\[[\s\S]*\]/);
        if (match) {
          edits = JSON.parse(match[0]);
        }
      } catch (err) {
        throw new ValidationError(`Failed to parse AI edit response: ${err.message}`, 'llmResponse');
      }

      // Preview mode - don't apply edits
      if (preview) {
        const previews = edits.map(edit => {
          const original = getByPath(wrapper, edit.path);
          return {
            path: edit.path,
            before: original,
            after: edit.text
          };
        });

        return jsonResponse({
          success: true,
          data: {
            sessionId,
            preview: true,
            edits: previews,
            totalCandidates: candidates.length,
            proposedEdits: edits.length
          }
        });
      }

      // Apply edits
      const appliedEdits = [];
      for (const edit of edits) {
        if (edit.path && edit.text) {
          try {
            setByPath(wrapper, edit.path, edit.text);
            appliedEdits.push(edit.path);
          } catch (err) {
            console.error(`Failed to apply edit at ${edit.path}: ${err.message}`);
          }
        }
      }

      // Update session goals
      if (appliedEdits.length > 0) {
        sessionManager.store.update(sessionId, {
          goals: {
            ...session.goals,
            items: wrapper.goals,
            metadata: {
              ...session.goals.metadata,
              lastAiEdit: new Date().toISOString()
            }
          }
        });
      }

      return jsonResponse({
        success: true,
        data: {
          sessionId,
          edited: appliedEdits.length,
          paths: appliedEdits,
          tokenUsage: response.usage
        }
      });
    }
  };
}

/**
 * Create evaluate route handlers
 */
function createEvaluateRoutes(sessionManager, llmClient) {
  return {
    async evaluate(ctx) {
      const { sessionId, options = {} } = ctx.body || {};
      
      if (!sessionId) {
        throw new ValidationError('sessionId is required', 'sessionId');
      }
      
      const session = sessionManager.getSession(sessionId);
      
      // Build prompt
      const { systemPrompt, userPrompt } = buildEvaluationPrompt({
        goals: session.goals,
        formattedContext: session.context.formattedContent
      });

      // Send to LLM
      const response = await llmClient.send({
        systemPrompt,
        userPrompt,
        parameters: options,
        sessionId,
        operation: 'evaluation'
      });
      
      // Parse response
      const parsed = parseJsonResponse(response.content);
      
      // Validate
      const validation = validateEvaluationResponse(parsed);
      if (!validation.valid) {
        throw new ValidationError(
          `Invalid LLM response: ${validation.errors.join(', ')}`,
          'llmResponse'
        );
      }
      
      // Build evaluation result
      const evaluationResult = {
        evaluatedAt: new Date().toISOString(),
        modelUsed: response.model || llmClient.model,
        executionOrder: parsed.executionOrder,
        inferredDependencies: parsed.inferredDependencies,
        reasoning: parsed.reasoning,
        warnings: parsed.warnings || [],
        tokenUsage: response.usage
      };
      
      // Update session
      const updatedSession = sessionManager.setEvaluation(sessionId, evaluationResult);
      
      return jsonResponse({
        success: true,
        data: {
          sessionId,
          state: updatedSession.state,
          evaluation: evaluationResult
        }
      });
    }
  };
}

/**
 * Create task list route handlers
 */
function createTasklistRoutes(sessionManager, toolRouter, llmClient) {
  return {
    async generate(ctx) {
      const { sessionId, options = {} } = ctx.body || {};

      if (!sessionId) {
        throw new ValidationError('sessionId is required', 'sessionId');
      }

      const session = sessionManager.getSession(sessionId);
      const toolManifest = toolRouter.getManifest();
      const executionOrder = session.goals.executionOrder || session.goals.items.map(g => g.id);

      // Build goal map for lookup
      const goalMap = new Map();
      for (const goal of session.goals.items) {
        goalMap.set(goal.id, goal);
      }

      // Process goals one at a time (batched approach)
      const allTasks = [];
      const allUnboundTasks = [];
      let taskStartNumber = 1;
      let totalTokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      console.log(`[TaskGen] Starting batched task generation for ${executionOrder.length} goals`);

      for (let i = 0; i < executionOrder.length; i++) {
        const goalId = executionOrder[i];
        const goal = goalMap.get(goalId);

        if (!goal) {
          console.warn(`[TaskGen] Goal not found: ${goalId}, skipping`);
          continue;
        }

        console.log(`[TaskGen] Processing goal ${i + 1}/${executionOrder.length}: ${goal.objective.slice(0, 50)}...`);

        // Build prompt for this single goal
        const { systemPrompt, userPrompt } = buildTaskGenerationPrompt({
          goal,
          goalIndex: i,
          totalGoals: executionOrder.length,
          formattedContext: session.context.formattedContent,
          toolManifest,
          previousTasks: allTasks,
          taskStartNumber
        });

        // Send to LLM
        const response = await llmClient.send({
          systemPrompt,
          userPrompt,
          parameters: options,
          sessionId,
          operation: `taskGen-goal-${i + 1}`
        });

        // Accumulate token usage
        if (response.usage) {
          totalTokenUsage.inputTokens += response.usage.inputTokens || 0;
          totalTokenUsage.outputTokens += response.usage.outputTokens || 0;
          totalTokenUsage.totalTokens += response.usage.totalTokens || 0;
        }

        // Parse TOML response
        const parsed = parseTaskToml(response.content);

        // Validate
        const validation = validateTaskTomlResponse(parsed);
        if (!validation.valid) {
          throw new ValidationError(
            `Invalid LLM response for goal ${goalId}: ${validation.errors.join(', ')}`,
            'llmResponse'
          );
        }

        // Collect unbound tasks
        if (parsed.unboundTasks && parsed.unboundTasks.length > 0) {
          allUnboundTasks.push(...parsed.unboundTasks);
        }

        // Validate tool bindings for this goal's tasks
        for (const task of parsed.tasks) {
          if (!toolRouter.hasTool(task.tool.toolName)) {
            allUnboundTasks.push({
              goalId: task.goalId,
              taskTitle: task.title,
              taskDescription: task.description,
              reason: `Tool '${task.tool.toolName}' not found in manifest`,
              suggestedTools: []
            });
            continue;
          }

          // Add to all tasks
          allTasks.push(task);
        }

        // Update task start number for next goal
        taskStartNumber = allTasks.length + 1;

        console.log(`[TaskGen] Generated ${parsed.tasks.length} tasks for goal ${goalId}`);
      }

      // Check for unbound tasks after all goals processed
      if (allUnboundTasks.length > 0) {
        throw new ToolBindingError(
          allUnboundTasks,
          toolManifest.tools.map(t => t.name)
        );
      }

      // Build task list from accumulated tasks
      const tasksByState = { pending: allTasks.length };
      const tasksByTool = {};
      const toolsRequired = new Set();

      for (const task of allTasks) {
        task.state = 'pending';
        tasksByTool[task.tool.toolName] = (tasksByTool[task.tool.toolName] || 0) + 1;
        toolsRequired.add(task.tool.toolName);
      }

      const taskList = {
        generatedAt: new Date().toISOString(),
        modelUsed: llmClient.model,
        sessionId,
        tasks: allTasks,
        summary: {
          totalTasks: allTasks.length,
          tasksByState,
          tasksByTool,
          toolsRequired: Array.from(toolsRequired),
          estimatedTotalMinutes: allTasks.reduce(
            (sum, t) => sum + (t.effort?.estimatedMinutes || 0), 0
          ),
          goalsProcessed: executionOrder.length
        },
        tokenUsage: totalTokenUsage
      };

      console.log(`[TaskGen] Completed: ${allTasks.length} tasks from ${executionOrder.length} goals`);

      // Update session
      const updatedSession = sessionManager.setTaskList(sessionId, taskList);

      return jsonResponse({
        success: true,
        data: {
          sessionId,
          state: updatedSession.state,
          taskList
        }
      });
    }
  };
}

/**
 * Create tool route handlers
 */
function createToolRoutes(toolRouter) {
  return {
    async list() {
      return jsonResponse({
        success: true,
        data: toolRouter.getManifest()
      });
    },

    async get(ctx) {
      const tool = toolRouter.getTool(ctx.params.name);

      if (!tool) {
        throw new ToolNotFoundError(ctx.params.name);
      }

      return jsonResponse({
        success: true,
        data: tool.schema
      });
    },

    async execute(ctx) {
      const { toolName, parameters = {}, sessionId } = ctx.body || {};

      if (!toolName) {
        throw new ValidationError('toolName is required', 'toolName');
      }

      if (!toolRouter.hasTool(toolName)) {
        throw new ToolNotFoundError(toolName);
      }

      const startTime = Date.now();

      try {
        // Execute the tool with sessionId for sandbox isolation
        const result = await toolRouter.executeTool(toolName, {
          ...parameters,
          sessionId
        });

        const durationMs = Date.now() - startTime;

        return jsonResponse({
          success: true,
          data: {
            toolName,
            parameters,
            result,
            durationMs,
            executedAt: new Date().toISOString()
          }
        });
      } catch (err) {
        const durationMs = Date.now() - startTime;

        return jsonResponse({
          success: false,
          data: {
            toolName,
            parameters,
            error: {
              message: err.message,
              code: err.code
            },
            durationMs,
            executedAt: new Date().toISOString()
          }
        });
      }
    }
  };
}

export default { Router, createApiHandler, jsonResponse, errorResponse };
