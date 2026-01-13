/**
 * @fileoverview Evaluation prompt templates
 * @module prompts
 */

/**
 * Build the comprehensive evaluation prompt
 * @param {Object} data - Bundle data
 * @returns {{systemPrompt: string, userPrompt: string}}
 */
export function buildEvaluationPrompt(data) {
  const systemPrompt = `You are an expert evaluator specializing in automated task execution analysis. Your role is to:

1. Objectively assess the quality of completed work using a standardized rubric
2. Identify gaps and improvement opportunities in tooling
3. Surface unclear or ambiguous requirements
4. Recommend language and encoding improvements
5. Synthesize actionable learnings

You must be thorough, objective, and constructive. Every criticism must include a recommendation. Scores must be justified with specific evidence.

Respond with JSON in the exact format specified. Do not include any text before or after the JSON.`;

  const { session, goals, tasks, taskOutputs, evaluations, executionLog, manifest } = data;

  // Build session overview
  const sessionOverview = `<session_overview>
<session_id>${session?.id || manifest?.sessionId}</session_id>
<state>${session?.state || 'UNKNOWN'}</state>
<created_at>${session?.metadata?.createdAt || manifest?.createdAt}</created_at>
</session_overview>`;

  // Build goals summary
  const goalsSummary = goals?.items?.map(g => `
<goal id="${g.id}">
  <objective>${g.objective}</objective>
  <priority>${g.priority || 5}</priority>
  <success_criteria>
    ${(g.criteria?.success || []).map(c => `<criterion>${c}</criterion>`).join('\n    ')}
  </success_criteria>
  <final_status>${g.status?.state || 'unknown'}</final_status>
</goal>`).join('\n') || '<no_goals/>';

  // Build tasks summary
  const tasksSummary = tasks?.tasks?.map(t => `
<task id="${t.id}" sequence="${t.sequenceNumber}">
  <title>${t.title}</title>
  <goal_id>${t.goalId}</goal_id>
  <tool>${t.tool?.toolName}</tool>
  <state>${t.state}</state>
</task>`).join('\n') || '<no_tasks/>';

  // Build outputs summary (truncated)
  const outputsSummary = taskOutputs?.map(o => `
<output task_id="${o.taskId}">
${(o.content || '').slice(0, 500)}${(o.content?.length > 500) ? '...[truncated]' : ''}
</output>`).join('\n') || '<no_outputs/>';

  // Build evaluations summary
  const evalsSummary = evaluations?.map(e => `
<evaluation task_id="${e.taskId}">
  <success>${e.success}</success>
  <summary>${e.reason?.summary || 'N/A'}</summary>
  <issues>${(e.issues || []).join('; ') || 'None'}</issues>
</evaluation>`).join('\n') || '<no_evaluations/>';

  // Build metrics
  const metrics = executionLog?.metrics || manifest?.metrics || {};
  const metricsSection = `<execution_metrics>
<total_tasks>${metrics.totalTasks || 0}</total_tasks>
<completed_tasks>${metrics.completedCount || 0}</completed_tasks>
<failed_tasks>${metrics.failedCount || 0}</failed_tasks>
<total_duration_ms>${metrics.totalExecutionTimeMs || 0}</total_duration_ms>
<total_tokens>${metrics.totalTokenUsage?.totalTokens || 0}</total_tokens>
</execution_metrics>`;

  // Build available tools
  const toolsUsed = [...new Set(tasks?.tasks?.map(t => t.tool?.toolName) || [])];
  const toolsSection = `<tools_used>
${toolsUsed.map(t => `<tool>${t}</tool>`).join('\n')}
</tools_used>`;

  const userPrompt = `${sessionOverview}

<original_goals>
${goalsSummary}
</original_goals>

<task_list>
${tasksSummary}
</task_list>

<task_outputs>
${outputsSummary}
</task_outputs>

<task_evaluations>
${evalsSummary}
</task_evaluations>

${toolsSection}

${metricsSection}

<instructions>
Perform a comprehensive evaluation of this completed session.

## PART 1: Quality Scoring

Apply the following rubric to score the session (0-100 for each dimension):

1. **Task Completion (30%)**: Did tasks achieve their stated objectives?
2. **Output Quality (25%)**: Are outputs well-formed and useful?
3. **Tool Utilization (20%)**: Were tools used effectively and correctly?
4. **Goal Alignment (15%)**: Do results satisfy original goal criteria?
5. **Process Efficiency (10%)**: Was execution efficient and well-organized?

For each dimension, provide:
- A score (0-100)
- Rationale for the score
- Specific strengths (array)
- Specific weaknesses (array)

## PART 2: Tool Router Recommendations

Analyze tool usage and identify:
- Feature requests for existing tools
- Enhancements to improve existing tools
- New tools that would have been helpful

## PART 3: Requirements Analysis

Identify any:
- Unclear or ambiguous requirements
- Missing requirements that should have been specified
- Conflicting requirements

## PART 4: Language & Encoding Recommendations

Suggest improvements for:
- Prompt patterns and templates
- Instruction clarity
- Data encoding and formats

## PART 5: Learnings Summary

Synthesize:
- Top 3-5 key learnings
- Success patterns to replicate
- Failure patterns to avoid
- Prioritized action items

Respond with JSON matching this schema:
{
  "qualityScore": {
    "overall": number,
    "grade": "A"|"B"|"C"|"D"|"F",
    "summary": "string",
    "breakdown": {
      "taskCompletion": { "score": number, "weight": 0.30, "weighted": number, "rationale": "string", "strengths": [], "weaknesses": [] },
      "outputQuality": { "score": number, "weight": 0.25, "weighted": number, "rationale": "string", "strengths": [], "weaknesses": [] },
      "toolUtilization": { "score": number, "weight": 0.20, "weighted": number, "rationale": "string", "strengths": [], "weaknesses": [] },
      "goalAlignment": { "score": number, "weight": 0.15, "weighted": number, "rationale": "string", "strengths": [], "weaknesses": [] },
      "processEfficiency": { "score": number, "weight": 0.10, "weighted": number, "rationale": "string", "strengths": [], "weaknesses": [] }
    },
    "justification": { "methodology": "string", "keyFactors": [], "limitations": [] }
  },
  "toolRouterRecommendations": {
    "featureRequests": [],
    "enhancements": [],
    "newTools": [],
    "usageAnalysis": { "mostUsed": [], "leastUsed": [], "observations": "string" }
  },
  "requirementsAnalysis": {
    "unclearRequirements": [],
    "missingRequirements": [],
    "conflicts": [],
    "suggestions": []
  },
  "languageRecommendations": {
    "promptImprovements": [],
    "instructionClarifications": [],
    "encoding": []
  },
  "learningsSummary": {
    "keyLearnings": [],
    "successPatterns": [],
    "failurePatterns": [],
    "actionItems": []
  }
}
</instructions>`;

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
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }
}

/**
 * Validate evaluation response
 * @param {Object} response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEvaluationResponse(response) {
  const errors = [];

  if (!response.qualityScore) {
    errors.push('Missing qualityScore');
  } else {
    if (typeof response.qualityScore.overall !== 'number' ||
        response.qualityScore.overall < 0 ||
        response.qualityScore.overall > 100) {
      errors.push('Invalid overall score: must be 0-100');
    }

    const breakdown = response.qualityScore.breakdown;
    if (breakdown) {
      const totalWeight =
        (breakdown.taskCompletion?.weight || 0) +
        (breakdown.outputQuality?.weight || 0) +
        (breakdown.toolUtilization?.weight || 0) +
        (breakdown.goalAlignment?.weight || 0) +
        (breakdown.processEfficiency?.weight || 0);

      if (Math.abs(totalWeight - 1.0) > 0.01) {
        errors.push(`Invalid weights: sum is ${totalWeight}, expected 1.0`);
      }
    }
  }

  const requiredSections = [
    'toolRouterRecommendations',
    'requirementsAnalysis',
    'languageRecommendations',
    'learningsSummary'
  ];

  for (const section of requiredSections) {
    if (!response[section]) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export default {
  buildEvaluationPrompt,
  parseJsonResponse,
  validateEvaluationResponse
};
