/**
 * @fileoverview Make Goals Tool - Creates structured goals from text or files
 * @module make-goals-tool
 *
 * This tool uses an LLM to parse unstructured text or files and generate
 * properly formatted goals for the workflow system.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Goal schema for reference in prompts
 */
const GOAL_SCHEMA = {
  id: 'string (kebab-case, unique identifier)',
  objective: 'string (clear statement of what should be accomplished)',
  priority: 'number (1-10, lower is higher priority, default 5)',
  criteria: {
    success: 'string[] (conditions that define success)',
    acceptance: 'string[] (minimum requirements for acceptance)',
    validation: 'string (manual|automated|hybrid, default manual)'
  },
  constraints: 'string[] (limitations or restrictions)',
  dependencies: {
    declaredDependencies: 'string[] (IDs of goals that must complete first)'
  },
  context: 'object (goal-specific key-value context)'
};

/**
 * Make Goals Tool - Creates structured goals from text or files
 */
export class MakeGoalsTool {
  /**
   * @param {import('./llm-client.js').LLMClient} llmClient
   * @param {import('./sandbox-manager.js').SandboxManager} [sandboxManager]
   * @param {Object} [config]
   */
  constructor(llmClient, sandboxManager = null, config = {}) {
    if (!llmClient) {
      throw new Error('LLMClient is required for MakeGoalsTool');
    }

    /** @type {import('./llm-client.js').LLMClient} */
    this.llmClient = llmClient;

    /** @type {import('./sandbox-manager.js').SandboxManager|null} */
    this.sandboxManager = sandboxManager;

    /** @type {number} */
    this.maxTokens = config.maxTokens || 8192;

    /** @type {number} */
    this.temperature = config.temperature || 0.3;
  }

  /**
   * Main entry point - create goals from text or file
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response with goals
   */
  async execute(args) {
    const {
      sessionId,
      text,
      filePath,
      contextPath,
      projectName,
      additionalContext,
      outputFormat = 'goals'
    } = args;

    // Get content to parse
    let content;
    let sourceName = 'text input';

    if (text) {
      content = text;
    } else if (filePath) {
      content = await this.loadFile(sessionId, filePath, contextPath);
      sourceName = filePath;
    } else {
      throw new Error('Either text or filePath is required');
    }

    if (!content || content.trim().length === 0) {
      throw new Error('Content is empty - nothing to parse');
    }

    // Generate goals using LLM
    const goals = await this.generateGoals(content, {
      sourceName,
      projectName,
      additionalContext
    });

    // Format output
    if (outputFormat === 'goals') {
      return this.formatResponse({
        success: true,
        goals: goals.goals,
        metadata: {
          source: sourceName,
          projectName: projectName || null,
          generatedAt: new Date().toISOString(),
          goalCount: goals.goals.length
        },
        warnings: goals.warnings || []
      });
    } else if (outputFormat === 'full') {
      return this.formatResponse({
        success: true,
        goalsDefinition: {
          version: '1.0',
          metadata: {
            name: projectName || 'Generated Goals',
            description: `Goals generated from ${sourceName}`,
            createdAt: new Date().toISOString()
          },
          goals: goals.goals,
          globalContext: {}
        },
        warnings: goals.warnings || []
      });
    }

    return this.formatResponse(goals);
  }

  /**
   * Load file content
   * @param {string} sessionId
   * @param {string} filePath
   * @param {string} [contextPath]
   * @returns {Promise<string>}
   * @private
   */
  async loadFile(sessionId, filePath, contextPath) {
    let absPath;

    // Try sandbox first if available
    if (this.sandboxManager && sessionId) {
      try {
        absPath = await this.sandboxManager.resolvePath(sessionId, filePath);
        if (existsSync(absPath)) {
          return await readFile(absPath, 'utf-8');
        }
      } catch (e) {
        // Fall through to context path
      }
    }

    // Try context path
    if (contextPath) {
      absPath = join(contextPath, filePath);
      if (existsSync(absPath)) {
        return await readFile(absPath, 'utf-8');
      }
    }

    // Try as absolute path
    if (existsSync(filePath)) {
      return await readFile(filePath, 'utf-8');
    }

    throw new Error(`File not found: ${filePath}`);
  }

  /**
   * Generate goals from content using LLM
   * @param {string} content
   * @param {Object} options
   * @returns {Promise<{goals: Object[], warnings: string[]}>}
   * @private
   */
  async generateGoals(content, options = {}) {
    const { sourceName, projectName, additionalContext } = options;

    const systemPrompt = `You are an expert at converting requirements, specifications, and project descriptions into well-structured goals for an AI workflow system.

Your task is to analyze the provided content and extract actionable goals that can be executed by an automated system.

GOAL STRUCTURE:
Each goal must have:
- id: Unique kebab-case identifier (e.g., "setup-database", "implement-auth")
- objective: Clear, specific statement of what should be accomplished
- priority: Number 1-10 (1=highest priority, default 5)
- criteria.success: Array of specific, measurable conditions that define success
- criteria.acceptance: Array of minimum requirements to consider the goal acceptable
- constraints: Array of limitations or restrictions (optional)
- dependencies.declaredDependencies: Array of goal IDs that must complete first (optional)
- context: Object with goal-specific key-value pairs (optional)

GUIDELINES:
1. Break down large requirements into discrete, actionable goals
2. Each goal should be achievable independently (except for declared dependencies)
3. Write objectives as clear imperative statements ("Create...", "Implement...", "Configure...")
4. Success criteria should be specific and verifiable
5. Identify logical dependencies between goals
6. Assign priorities based on dependencies and importance
7. Use consistent, descriptive IDs

RESPONSE FORMAT:
Respond with valid JSON only:
{
  "goals": [
    {
      "id": "goal-id",
      "objective": "Clear objective statement",
      "priority": 5,
      "criteria": {
        "success": ["Criterion 1", "Criterion 2"],
        "acceptance": ["Minimum requirement"],
        "validation": "manual"
      },
      "constraints": ["Constraint if any"],
      "dependencies": {
        "declaredDependencies": ["dependency-goal-id"]
      },
      "context": {}
    }
  ],
  "warnings": ["Any issues or ambiguities found in the source content"]
}

Do not include any text before or after the JSON.`;

    let userPrompt = `<source name="${sourceName}">
${content}
</source>`;

    if (projectName) {
      userPrompt += `\n\n<project_name>${projectName}</project_name>`;
    }

    if (additionalContext) {
      userPrompt += `\n\n<additional_context>${additionalContext}</additional_context>`;
    }

    userPrompt += `

<instructions>
Analyze the source content and generate structured goals.
- Extract all actionable items, requirements, and tasks
- Convert them into properly formatted goals
- Identify dependencies between goals
- Assign appropriate priorities
- Add relevant success criteria

Respond with JSON only.
</instructions>`;

    // Call LLM
    const response = await this.llmClient.send({
      systemPrompt,
      userPrompt,
      parameters: {
        temperature: this.temperature,
        maxTokens: this.maxTokens
      }
    });

    // Parse response
    const parsed = this.parseJsonResponse(response.content);

    // Validate and normalize goals
    const validatedGoals = this.validateGoals(parsed.goals || []);

    return {
      goals: validatedGoals,
      warnings: parsed.warnings || []
    };
  }

  /**
   * Parse JSON from LLM response
   * @param {string} content
   * @returns {Object}
   * @private
   */
  parseJsonResponse(content) {
    let jsonStr = content.trim();

    // Remove markdown code blocks
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Find JSON object
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) {
      jsonStr = match[0];
    }

    try {
      return JSON.parse(jsonStr);
    } catch (err) {
      throw new Error(`Failed to parse LLM response as JSON: ${err.message}`);
    }
  }

  /**
   * Validate and normalize goals
   * @param {Object[]} goals
   * @returns {Object[]}
   * @private
   */
  validateGoals(goals) {
    const seenIds = new Set();

    return goals.map((goal, index) => {
      // Ensure required fields
      if (!goal.id) {
        goal.id = `goal-${index + 1}`;
      }

      // Make ID unique
      let id = goal.id;
      let suffix = 1;
      while (seenIds.has(id)) {
        id = `${goal.id}-${suffix++}`;
      }
      seenIds.add(id);
      goal.id = id;

      // Ensure objective
      if (!goal.objective) {
        goal.objective = `Goal ${index + 1}`;
      }

      // Normalize priority
      goal.priority = Math.max(1, Math.min(10, parseInt(goal.priority) || 5));

      // Ensure criteria structure
      if (!goal.criteria) {
        goal.criteria = {};
      }
      if (!Array.isArray(goal.criteria.success)) {
        goal.criteria.success = goal.criteria.success ? [goal.criteria.success] : [];
      }
      if (!Array.isArray(goal.criteria.acceptance)) {
        goal.criteria.acceptance = goal.criteria.acceptance ? [goal.criteria.acceptance] : [];
      }
      if (!goal.criteria.validation) {
        goal.criteria.validation = 'manual';
      }

      // Ensure constraints is array
      if (!Array.isArray(goal.constraints)) {
        goal.constraints = goal.constraints ? [goal.constraints] : [];
      }

      // Ensure dependencies structure
      if (!goal.dependencies) {
        goal.dependencies = {};
      }
      if (!Array.isArray(goal.dependencies.declaredDependencies)) {
        goal.dependencies.declaredDependencies = goal.dependencies.declaredDependencies
          ? [goal.dependencies.declaredDependencies]
          : [];
      }

      // Ensure context is object
      if (!goal.context || typeof goal.context !== 'object') {
        goal.context = {};
      }

      return goal;
    });
  }

  /**
   * Format response in MCP-compatible format
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'make_goals',
      this.execute.bind(this),
      {
        name: 'make_goals',
        description: 'Generate structured goals from text or files. Uses LLM to parse requirements, specifications, or project descriptions and create properly formatted goals for the workflow system.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox context (optional)'
            },
            text: {
              type: 'string',
              description: 'Text content to parse into goals (alternative to filePath)'
            },
            filePath: {
              type: 'string',
              description: 'Path to file containing content to parse (alternative to text)'
            },
            contextPath: {
              type: 'string',
              description: 'Base path for resolving filePath (optional)'
            },
            projectName: {
              type: 'string',
              description: 'Name of the project (used in metadata)'
            },
            additionalContext: {
              type: 'string',
              description: 'Additional context to help LLM understand the content'
            },
            outputFormat: {
              type: 'string',
              enum: ['goals', 'full'],
              default: 'goals',
              description: 'Output format: "goals" returns just the goals array, "full" returns complete goals definition'
            }
          },
          required: []
        }
      }
    );
  }
}

/**
 * Create a MakeGoalsTool instance
 * @param {import('./llm-client.js').LLMClient} llmClient
 * @param {import('./sandbox-manager.js').SandboxManager} [sandboxManager]
 * @param {Object} [config]
 * @returns {MakeGoalsTool}
 */
export function createMakeGoalsTool(llmClient, sandboxManager, config) {
  return new MakeGoalsTool(llmClient, sandboxManager, config);
}

export default MakeGoalsTool;
