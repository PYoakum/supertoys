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
 * Build the task generation prompt for a SINGLE goal (batched approach)
 * @param {Object} params
 * @param {Object} params.goal - Single goal to generate tasks for
 * @param {number} params.goalIndex - Index of this goal in execution order
 * @param {number} params.totalGoals - Total number of goals
 * @param {string} params.formattedContext - Formatted context
 * @param {Object} params.toolManifest - Available tools
 * @param {Object[]} params.previousTasks - Tasks generated for previous goals
 * @param {number} params.taskStartNumber - Starting sequence number for tasks
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildTaskGenerationPrompt({ goal, goalIndex, totalGoals, formattedContext, toolManifest, previousTasks = [], taskStartNumber = 1 }) {
  const systemPrompt = `You are an expert task planner. Your task is to convert a high-level goal into concrete, executable tasks that use specific tools from the provided tool manifest.

CRITICAL REQUIREMENT: Every task MUST be bound to exactly one tool from the available tools. If the goal cannot be accomplished with the available tools, you must indicate this explicitly in the "unboundTasks" array.

You must respond with valid JSON matching the specified schema. Do not include any text before or after the JSON.`;

  const goalJson = JSON.stringify({
    id: goal.id,
    objective: goal.objective,
    priority: goal.priority,
    criteria: goal.criteria,
    constraints: goal.constraints,
    executionIndex: goal.executionIndex
  }, null, 2);

  // Summarize previous tasks for context (don't include full parameters to save tokens)
  const previousTasksSummary = previousTasks.length > 0
    ? previousTasks.map(t => ({
        id: t.id,
        goalId: t.goalId,
        title: t.title,
        toolName: t.tool.toolName,
        sequenceNumber: t.sequenceNumber
      }))
    : [];

  const userPrompt = `<goal index="${goalIndex + 1}" total="${totalGoals}">
${goalJson}
</goal>

<context>
${formattedContext}
</context>

<available_tools>
${JSON.stringify(toolManifest.tools, null, 2)}
</available_tools>

${previousTasksSummary.length > 0 ? `<previous_tasks>
These tasks were already generated for previous goals. You may reference their IDs for dependencies:
${JSON.stringify(previousTasksSummary, null, 2)}
</previous_tasks>` : ''}

<instructions>
Generate one or more concrete tasks for THIS GOAL ONLY that:

1. ACCOMPLISH THE GOAL: Break down the goal into actionable steps
2. USE AVAILABLE TOOLS: Each task must use exactly one tool from the manifest
3. SPECIFY PARAMETERS: Provide complete parameter values for the tool command
4. REFERENCE DEPENDENCIES: If tasks depend on previous tasks, include the dependency
5. BE CONCISE: Task titles should be clear and actionable
6. START SEQUENCE AT ${taskStartNumber}: Task sequence numbers should start at ${taskStartNumber}

For each task, specify:
- Which tool to use (must match a tool name exactly)
- The action/method to invoke
- Complete parameters for the tool
- Expected output description

If this goal CANNOT be accomplished with the available tools, include it in the "unboundTasks" array with an explanation.

Respond with JSON in this exact format:
{
  "tasks": [
    {
      "id": "task-${taskStartNumber}",
      "goalId": "${goal.id}",
      "sequenceNumber": ${taskStartNumber},
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
  "unboundTasks": []
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
  let jsonStr = content.trim();

  // Strategy 1: Remove markdown code blocks if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Strategy 2: Try to find JSON object directly
  if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
    // Look for first { or [ and last } or ]
    const firstBrace = jsonStr.indexOf('{');
    const firstBracket = jsonStr.indexOf('[');
    let start = -1;

    if (firstBrace >= 0 && firstBracket >= 0) {
      start = Math.min(firstBrace, firstBracket);
    } else if (firstBrace >= 0) {
      start = firstBrace;
    } else if (firstBracket >= 0) {
      start = firstBracket;
    }

    if (start >= 0) {
      // Find the matching end
      const isObject = jsonStr[start] === '{';
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      let end = -1;

      for (let i = start; i < jsonStr.length; i++) {
        const char = jsonStr[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (char === '{' || char === '[') {
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }

      if (end > start) {
        jsonStr = jsonStr.slice(start, end + 1);
      }
    }
  }

  jsonStr = jsonStr.trim();

  // Strategy 3: Try parsing directly
  try {
    return JSON.parse(jsonStr);
  } catch (firstErr) {
    // Strategy 4: Fix invalid escape sequences character by character
    const fixedStr = fixEscapeSequences(jsonStr);

    try {
      return JSON.parse(fixedStr);
    } catch (secondErr) {
      // Check if response appears truncated
      const lastChars = jsonStr.slice(-100);
      const firstChars = jsonStr.slice(0, 100);
      const isTruncated = !jsonStr.endsWith('}') && !jsonStr.endsWith(']');

      let errorMsg = `Failed to parse LLM response as JSON: ${firstErr.message}`;
      if (isTruncated) {
        errorMsg += ` (Response appears truncated. Last 100 chars: "${lastChars}"). Try increasing maxTokens.`;
      } else {
        errorMsg += ` (First 100 chars: "${firstChars}")`;
      }
      throw new Error(errorMsg);
    }
  }
}

/**
 * Fix invalid JSON escape sequences character by character
 * @param {string} str - JSON string to fix
 * @returns {string} - Fixed JSON string
 */
function fixEscapeSequences(str) {
  const validEscapeChars = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);
  const result = [];
  let i = 0;

  while (i < str.length) {
    const char = str[i];

    if (char === '\\') {
      const nextChar = str[i + 1];

      if (nextChar === undefined) {
        // Backslash at end of string - escape it
        result.push('\\\\');
        i++;
      } else if (validEscapeChars.has(nextChar)) {
        // Valid escape sequence - keep as is
        if (nextChar === 'u') {
          // Unicode escape - need 4 hex digits
          const hex = str.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            result.push(str.slice(i, i + 6));
            i += 6;
          } else {
            // Invalid unicode escape - double the backslash
            result.push('\\\\');
            i++;
          }
        } else {
          result.push('\\', nextChar);
          i += 2;
        }
      } else {
        // Invalid escape sequence - double the backslash
        result.push('\\\\');
        i++;
      }
    } else if (char === '\n') {
      // Literal newline - escape it
      result.push('\\n');
      i++;
    } else if (char === '\r') {
      // Literal carriage return - escape it
      result.push('\\r');
      i++;
    } else if (char === '\t') {
      // Literal tab - escape it
      result.push('\\t');
      i++;
    } else {
      result.push(char);
      i++;
    }
  }

  // Also fix trailing commas
  return result.join('').replace(/,(\s*[}\]])/g, '$1');
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
