/**
 * @fileoverview Action Plan prompt templates
 * @module prompts
 */

/**
 * Build the action prompt for task execution
 * @param {Object} data - Task execution data
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildActionPrompt(data) {
  const { task, goal, toolManifest, context, previousOutputs } = data;

  const systemPrompt = `You are an expert task executor. Your role is to execute tasks using the available tools to achieve the specified goals.

You have access to the following tools:
${JSON.stringify(toolManifest?.tools || [], null, 2)}

When you need to use a tool, respond with XML in this exact format:
<tool_use>
<tool_name>name_of_tool</tool_name>
<parameters>
{"param1": "value1", "param2": "value2"}
</parameters>
</tool_use>

After the tool_use block, briefly explain your reasoning.

Guidelines:
- Use only the tools available in the manifest
- Provide complete and valid JSON parameters
- Focus on achieving the task objective
- Be precise and avoid unnecessary operations`;

  let userPrompt = `## Goal
<goal id="${goal?.id || 'unknown'}">
  <objective>${goal?.objective || 'No objective specified'}</objective>
  <success_criteria>
    ${(goal?.criteria?.success || []).map(c => `<criterion>${c}</criterion>`).join('\n    ')}
  </success_criteria>
</goal>

## Task
<task id="${task.id}" sequence="${task.sequenceNumber}">
  <title>${task.title}</title>
  <description>${task.description || 'No description'}</description>
  <tool>${task.tool?.toolName}</tool>
  <predefined_parameters>
${JSON.stringify(task.tool?.command?.parameters || {}, null, 2)}
  </predefined_parameters>
</task>`;

  if (context) {
    userPrompt += `\n\n## Context\n${context}`;
  }

  if (previousOutputs && previousOutputs.length > 0) {
    userPrompt += `\n\n## Previous Task Outputs\n`;
    for (const output of previousOutputs) {
      userPrompt += `<previous_output task_id="${output.taskId}">\n${output.summary}\n</previous_output>\n`;
    }
  }

  userPrompt += `\n\n## Instructions
Execute this task to achieve the goal. Use the predefined parameters unless you have a specific reason to modify them.

Respond with a <tool_use> block containing the tool call, followed by your reasoning.`;

  return { systemPrompt, userPrompt };
}

/**
 * Parse tool use from LLM response
 * @param {string} content - LLM response content
 * @returns {{toolName: string, parameters: Object}|null}
 */
export function parseToolUse(content) {
  // Try XML format first: <tool_use>...</tool_use>
  const toolUseMatch = content.match(/<tool_use>([\s\S]*?)<\/tool_use>/);
  if (toolUseMatch) {
    const toolBlock = toolUseMatch[1];

    const nameMatch = toolBlock.match(/<tool_name>([\s\S]*?)<\/tool_name>/);
    const paramsMatch = toolBlock.match(/<parameters>([\s\S]*?)<\/parameters>/);

    if (nameMatch) {
      const toolName = nameMatch[1].trim();
      let parameters = {};

      if (paramsMatch) {
        const paramsStr = paramsMatch[1].trim();
        try {
          parameters = JSON.parse(paramsStr);
        } catch (e) {
          // Try to extract JSON from the params block (might have extra text)
          const jsonMatch = paramsStr.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parameters = JSON.parse(jsonMatch[0]);
            } catch (e2) {
              console.error('[WARN] Failed to parse tool parameters:', paramsStr.slice(0, 200));
            }
          } else {
            console.error('[WARN] No JSON found in parameters block:', paramsStr.slice(0, 200));
          }
        }
      } else {
        console.error('[WARN] No <parameters> block found in tool_use');
      }

      return { toolName, parameters };
    }
  }

  // Try JSON format: {"tool": "name", "parameters": {...}}
  const jsonMatch = content.match(/\{[\s\S]*?"tool"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.tool && parsed.parameters) {
        return { toolName: parsed.tool, parameters: parsed.parameters };
      }
      if (parsed.name && parsed.input) {
        // Anthropic native format
        return { toolName: parsed.name, parameters: parsed.input };
      }
    } catch (e) {
      // Not valid JSON
    }
  }

  // Try to find tool name and params separately
  const toolNameMatch = content.match(/tool[_\s]*name[:\s]*["']?(\w+)["']?/i);
  if (toolNameMatch) {
    const toolName = toolNameMatch[1];
    let parameters = {};

    // Look for JSON object after tool name
    const paramsJsonMatch = content.match(/parameters[:\s]*(\{[\s\S]*?\})/i);
    if (paramsJsonMatch) {
      try {
        parameters = JSON.parse(paramsJsonMatch[1]);
      } catch (e) {
        // ignore
      }
    }

    return { toolName, parameters };
  }

  return null;
}

/**
 * Build the task evaluation prompt
 * @param {Object} data - Task and execution data
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildEvaluationPrompt(data) {
  const { task, goal, executionResult } = data;

  const systemPrompt = `You are an expert evaluator assessing task execution results.

Analyze the task execution and determine if it successfully achieved its objective.

Respond with JSON in this exact format:
{
  "success": true|false,
  "reason": {
    "summary": "Brief summary of the evaluation",
    "details": "Detailed explanation"
  },
  "criteriaMatched": ["list of success criteria that were met"],
  "criteriaUnmatched": ["list of success criteria that were not met"],
  "issues": ["list of any issues found"]
}

Do not include any text before or after the JSON.`;

  const userPrompt = `## Goal
<goal id="${goal?.id || 'unknown'}">
  <objective>${goal?.objective || 'No objective specified'}</objective>
  <success_criteria>
    ${(goal?.criteria?.success || []).map(c => `<criterion>${c}</criterion>`).join('\n    ')}
  </success_criteria>
</goal>

## Task
<task id="${task.id}">
  <title>${task.title}</title>
  <description>${task.description || 'No description'}</description>
</task>

## Execution Result
<execution_result success="${executionResult.success}">
  <output>${executionResult.output || 'No output'}</output>
  <tool_invocations>
    ${(executionResult.toolInvocations || []).map(t => `
    <invocation tool="${t.toolName}" success="${t.success}">
      <result>${JSON.stringify(t.result || {}).slice(0, 500)}</result>
      ${t.error ? `<error>${t.error}</error>` : ''}
    </invocation>`).join('\n')}
  </tool_invocations>
</execution_result>

## Instructions
Evaluate whether this task execution successfully achieved its objective. Check each success criterion and determine if it was met.

Respond with JSON only.`;

  return { systemPrompt, userPrompt };
}

/**
 * Parse JSON from LLM response
 * @param {string} content
 * @returns {Object}
 */
export function parseJsonResponse(content) {
  let jsonStr = content.trim();

  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

  jsonStr = jsonStr.trim();

  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
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
 * Validate evaluation response for task evaluation
 * @param {Object} response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEvaluationResponse(response) {
  const errors = [];

  if (typeof response.success !== 'boolean') {
    errors.push('Missing or invalid success field');
  }

  if (!response.reason) {
    errors.push('Missing reason field');
  } else if (!response.reason.summary) {
    errors.push('Missing reason.summary');
  }

  return { valid: errors.length === 0, errors };
}

export default {
  buildActionPrompt,
  buildEvaluationPrompt,
  parseToolUse,
  parseJsonResponse,
  validateEvaluationResponse
};
