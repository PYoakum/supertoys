/**
 * @fileoverview Prompt templates for LLM evaluation and task generation
 * @module prompts
 */

/**
 * Build the evaluation prompt for dependency resolution and goal ordering
 * @param {Object} params
 * @param {Object} params.goals - Goals checklist
 * @param {string} params.formattedContext - Formatted context string
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildEvaluationPrompt({ goals, formattedContext }) {
  const systemPrompt = `You are an expert project planner and dependency analyst. Your task is to analyze a set of goals, identify dependencies between them, and determine an optimal single-threaded execution order.

You must respond with valid JSON matching the specified schema. Do not include any text before or after the JSON.`;

  const goalsJson = JSON.stringify(goals.items.map(g => ({
    id: g.id,
    objective: g.objective,
    priority: g.priority,
    declaredDependencies: g.dependencies.declaredDependencies,
    criteria: g.criteria,
    constraints: g.constraints
  })), null, 2);

  const userPrompt = `<goals>
${goalsJson}
</goals>

<context>
${formattedContext}
</context>

<instructions>
Analyze the provided goals and:

1. IDENTIFY DEPENDENCIES: For each goal, determine which other goals must be completed first. Consider:
   - Data dependencies (does this goal need output from another?)
   - State dependencies (does this goal require a certain system state?)
   - Resource dependencies (does this goal need resources created by another?)
   - Logical dependencies (does this goal logically follow another?)

2. VALIDATE DECLARED DEPENDENCIES: Check if the declared dependencies in the goals are correct and complete.

3. DETERMINE EXECUTION ORDER: Produce a single-threaded execution order that:
   - Respects all dependencies (declared and inferred)
   - Prioritizes higher-priority goals when dependencies allow
   - Is deterministic and reproducible

4. IDENTIFY ISSUES: Flag any circular dependencies, impossible orderings, or missing information.

Respond with JSON in this exact format:
{
  "executionOrder": ["goal-id-1", "goal-id-2", ...],
  "inferredDependencies": [
    {
      "goalId": "goal-that-depends",
      "dependsOn": "goal-depended-upon",
      "reason": "explanation",
      "type": "data|state|resource|logical|temporal"
    }
  ],
  "reasoning": "Overall explanation of the ordering logic",
  "warnings": [
    {
      "code": "WARNING_CODE",
      "message": "Description",
      "goalId": "affected-goal-or-null"
    }
  ]
}
</instructions>`;

  return { systemPrompt, userPrompt };
}

/**
 * Build the task generation prompt
 * @param {Object} params
 * @param {Object} params.goals - Evaluated goals
 * @param {string[]} params.executionOrder - Goal execution order
 * @param {string} params.formattedContext - Formatted context
 * @param {Object} params.toolManifest - Available tools
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildTaskGenerationPrompt({ goals, executionOrder, formattedContext, toolManifest }) {
  const systemPrompt = `You are an expert task planner. Your task is to convert high-level goals into concrete, executable tasks that use specific tools from the provided tool manifest.

CRITICAL REQUIREMENT: Every task MUST be bound to exactly one tool from the available tools. If a task cannot be accomplished with the available tools, you must indicate this explicitly in the "unboundTasks" array.

You must respond with valid JSON matching the specified schema. Do not include any text before or after the JSON.`;

  const goalsJson = JSON.stringify(goals.items.map(g => ({
    id: g.id,
    objective: g.objective,
    priority: g.priority,
    criteria: g.criteria,
    constraints: g.constraints,
    executionIndex: g.executionIndex
  })), null, 2);

  const userPrompt = `<goals>
${goalsJson}
</goals>

<execution_order>
${JSON.stringify(executionOrder)}
</execution_order>

<context>
${formattedContext}
</context>

<available_tools>
${JSON.stringify(toolManifest.tools, null, 2)}
</available_tools>

<instructions>
For each goal in execution order, generate one or more concrete tasks that:

1. ACCOMPLISH THE GOAL: Break down the goal into actionable steps
2. USE AVAILABLE TOOLS: Each task must use exactly one tool from the manifest
3. SPECIFY PARAMETERS: Provide complete parameter values for the tool command
4. MAINTAIN ORDER: Tasks must respect the goal execution order and dependencies
5. BE CONCISE: Task titles should be clear and actionable

For each task, specify:
- Which tool to use (must match a tool name exactly)
- The action/method to invoke
- Complete parameters for the tool
- Expected output description

If a goal CANNOT be accomplished with the available tools, include it in the "unboundTasks" array with an explanation.

Respond with JSON in this exact format:
{
  "tasks": [
    {
      "id": "task-1",
      "goalId": "associated-goal-id",
      "sequenceNumber": 1,
      "title": "Concise task title",
      "description": "Detailed description",
      "dependencies": [
        { "taskId": "task-id", "type": "completion" }
      ],
      "tool": {
        "toolName": "exact_tool_name",
        "toolDescription": "What this tool does",
        "command": {
          "action": "tool_action",
          "parameters": { "param1": "value1" },
          "expectedOutput": "Description of expected result"
        },
        "fallbackTool": null
      },
      "effort": {
        "estimatedMinutes": 5,
        "complexity": "low|medium|high"
      }
    }
  ],
  "unboundTasks": [
    {
      "goalId": "goal-id",
      "taskTitle": "What needs to be done",
      "taskDescription": "Detailed description",
      "reason": "Why no tool is available",
      "suggestedTools": ["Tool type that would be needed"]
    }
  ]
}
</instructions>`;

  return { systemPrompt, userPrompt };
}

/**
 * Parse JSON from LLM response
 * @param {string} content - LLM response content
 * @returns {Object}
 */
export function parseJsonResponse(content) {
  // Try to extract JSON from the response
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }

  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    // Check if response appears truncated
    const lastChars = jsonStr.slice(-100);
    const isTruncated = !jsonStr.endsWith('}') && !jsonStr.endsWith(']');

    let errorMsg = `Failed to parse LLM response as JSON: ${err.message}`;
    if (isTruncated) {
      errorMsg += ` (Response appears truncated. Last 100 chars: "${lastChars}"). Try increasing maxTokens.`;
    }
    throw new Error(errorMsg);
  }
}

/**
 * Validate evaluation response
 * @param {Object} response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEvaluationResponse(response) {
  const errors = [];
  
  if (!response.executionOrder || !Array.isArray(response.executionOrder)) {
    errors.push('Missing or invalid executionOrder array');
  }
  
  if (!response.inferredDependencies || !Array.isArray(response.inferredDependencies)) {
    errors.push('Missing or invalid inferredDependencies array');
  }
  
  if (!response.reasoning || typeof response.reasoning !== 'string') {
    errors.push('Missing or invalid reasoning string');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate task generation response
 * @param {Object} response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateTaskGenerationResponse(response) {
  const errors = [];
  
  if (!response.tasks || !Array.isArray(response.tasks)) {
    errors.push('Missing or invalid tasks array');
  } else {
    for (let i = 0; i < response.tasks.length; i++) {
      const task = response.tasks[i];
      if (!task.id) errors.push(`Task ${i}: missing id`);
      if (!task.goalId) errors.push(`Task ${i}: missing goalId`);
      if (!task.title) errors.push(`Task ${i}: missing title`);
      if (!task.tool?.toolName) errors.push(`Task ${i}: missing tool.toolName`);
    }
  }
  
  // unboundTasks is optional but must be an array if present
  if (response.unboundTasks && !Array.isArray(response.unboundTasks)) {
    errors.push('unboundTasks must be an array if present');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export default {
  buildEvaluationPrompt,
  buildTaskGenerationPrompt,
  parseJsonResponse,
  validateEvaluationResponse,
  validateTaskGenerationResponse
};
