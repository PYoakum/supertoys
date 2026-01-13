/**
 * @fileoverview MCP tools for session management
 * @module mcp/tools/session-tools
 */

/**
 * Create session-related MCP tools
 * @param {import('../../lib/session-manager.js').SessionManager} sessionManager
 * @returns {Object[]}
 */
export function createSessionTools(sessionManager) {
  return [
    {
      schema: {
        name: 'session_list',
        description: 'List all active sessions with their current state',
        inputSchema: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              enum: ['CREATED', 'LOADED', 'EVALUATED', 'GENERATED', 'COMPLETE', 'ERROR'],
              description: 'Filter by session state (optional)'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of sessions to return (default: 20)'
            }
          }
        }
      },
      handler: async (args) => {
        try {
          const result = sessionManager.listSessions({
            state: args.state,
            limit: args.limit || 20
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'session_get',
        description: 'Get detailed information about a specific session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'The session ID to retrieve' },
            includeContext: { type: 'boolean', description: 'Include full context content (default: false)' },
            includeTaskList: { type: 'boolean', description: 'Include task list if available (default: true)' }
          },
          required: ['sessionId']
        }
      },
      handler: async (args) => {
        try {
          const session = sessionManager.getSession(args.sessionId);
          const data = {
            id: session.id,
            state: session.state,
            goals: session.goals,
            context: args.includeContext ? session.context : { metadata: session.context.metadata },
            evaluation: session.evaluation,
            taskList: args.includeTaskList !== false ? session.taskList : null,
            metadata: session.metadata
          };
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'session_goals',
        description: 'Get the goals checklist with completion status and dependencies',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'The session ID' }
          },
          required: ['sessionId']
        }
      },
      handler: async (args) => {
        try {
          const session = sessionManager.getSession(args.sessionId);
          return { content: [{ type: 'text', text: JSON.stringify(session.goals, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'session_context',
        description: 'Get the context files and metadata for a session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'The session ID' },
            format: { type: 'string', enum: ['full', 'summary', 'files_only'], description: 'Response format (default: summary)' }
          },
          required: ['sessionId']
        }
      },
      handler: async (args) => {
        try {
          const session = sessionManager.getSession(args.sessionId);
          let data;
          switch (args.format) {
            case 'full':
              data = session.context;
              break;
            case 'files_only':
              data = session.context.files.map(f => ({ path: f.path, size: f.size, extension: f.extension }));
              break;
            default:
              data = { metadata: session.context.metadata, files: session.context.files.map(f => f.path) };
          }
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'session_tasks',
        description: 'Get the generated task list with tool bindings',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'The session ID' },
            state: { type: 'string', enum: ['pending', 'ready', 'in_progress', 'completed', 'failed', 'skipped'], description: 'Filter tasks by state (optional)' }
          },
          required: ['sessionId']
        }
      },
      handler: async (args) => {
        try {
          const session = sessionManager.getSession(args.sessionId);
          if (!session.taskList) {
            return { content: [{ type: 'text', text: 'No task list generated for this session' }] };
          }
          let tasks = session.taskList.tasks;
          if (args.state) {
            tasks = tasks.filter(t => t.state === args.state);
          }
          return { content: [{ type: 'text', text: JSON.stringify({ ...session.taskList, tasks }, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'session_update_goal',
        description: 'Update the completion status or notes for a specific goal',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'The session ID' },
            goalId: { type: 'string', description: 'The goal ID to update' },
            state: { type: 'string', enum: ['pending', 'blocked', 'in_progress', 'completed', 'failed', 'skipped'], description: 'New goal state' },
            progress: { type: 'number', minimum: 0, maximum: 100, description: 'Completion percentage' },
            notes: { type: 'string', description: 'Notes to add to the goal' }
          },
          required: ['sessionId', 'goalId']
        }
      },
      handler: async (args) => {
        try {
          const updates = {};
          if (args.state || args.progress !== undefined) {
            updates.status = {};
            if (args.state) updates.status.state = args.state;
            if (args.progress !== undefined) updates.status.progress = args.progress;
          }
          if (args.notes) updates.notes = args.notes;
          
          const session = sessionManager.updateGoal(args.sessionId, args.goalId, updates);
          const goal = session.goals.items.find(g => g.id === args.goalId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, goal }, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'session_update_task',
        description: 'Update the state of a specific task',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'The session ID' },
            taskId: { type: 'string', description: 'The task ID to update' },
            state: { type: 'string', enum: ['pending', 'ready', 'in_progress', 'completed', 'failed', 'skipped'], description: 'New task state' },
            result: { type: 'string', description: 'Result or output from task execution' }
          },
          required: ['sessionId', 'taskId']
        }
      },
      handler: async (args) => {
        try {
          const session = sessionManager.updateTask(args.sessionId, args.taskId, {
            state: args.state,
            result: args.result
          });
          const task = session.taskList.tasks.find(t => t.id === args.taskId);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, task }, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    }
  ];
}

/**
 * Create tool-related MCP tools
 * @param {import('../../lib/tool-router.js').ToolRouter} toolRouter
 * @returns {Object[]}
 */
export function createToolTools(toolRouter) {
  return [
    {
      schema: {
        name: 'tools_list',
        description: 'List all available tools from the Tool Router with their schemas',
        inputSchema: { type: 'object', properties: {} }
      },
      handler: async () => {
        try {
          const manifest = toolRouter.getManifest();
          return { content: [{ type: 'text', text: JSON.stringify(manifest, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    },
    
    {
      schema: {
        name: 'tools_get',
        description: 'Get detailed information about a specific tool',
        inputSchema: {
          type: 'object',
          properties: {
            toolName: { type: 'string', description: 'Name of the tool to retrieve' }
          },
          required: ['toolName']
        }
      },
      handler: async (args) => {
        try {
          const tool = toolRouter.getTool(args.toolName);
          if (!tool) {
            return { content: [{ type: 'text', text: `Tool not found: ${args.toolName}` }], isError: true };
          }
          return { content: [{ type: 'text', text: JSON.stringify(tool.schema, null, 2) }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
        }
      }
    }
  ];
}

export default { createSessionTools, createToolTools };
