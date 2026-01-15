/**
 * @fileoverview AI Editor for enhancing goal content
 * @module ai-editor
 *
 * Uses LLM to suggest improvements to goal objectives, criteria, and constraints.
 * Supports batched requests with retry logic and multiple streaming protocols.
 */

import { readStreamingResponse, extractEditItems } from './stream-parsers.js';
import { getByPath, setByPath, collectContentStringPaths, shouldIncludePath } from './path-utils.js';

/**
 * @typedef {Object} AiEditConfig
 * @property {string} llmUrl - LLM API endpoint URL
 * @property {string} [protocol='ndjson'] - Response protocol: 'ndjson', 'sse', 'json'
 * @property {string} [model='default'] - Model name
 * @property {number} [batchSize=10] - Items per batch request
 * @property {number} [timeoutMs=120000] - Request timeout
 * @property {number} [retries=3] - Max retry attempts
 * @property {number} [backoffMs=500] - Initial backoff delay
 * @property {number} [backoffMaxMs=8000] - Max backoff delay
 * @property {string[]} [includeGlobs] - Include path patterns
 * @property {string[]} [excludeGlobs] - Exclude path patterns
 * @property {boolean} [includeContext=false] - Include context fields
 * @property {string} [debugPath] - Debug log path
 * @property {Object} [headers] - Additional headers
 * @property {string} [apiKey] - API key for authentication
 */

/**
 * @typedef {Object} EditCandidate
 * @property {string} path - Path expression
 * @property {string} text - Current text value
 */

/**
 * System prompt for AI editing
 */
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

/**
 * Build the user prompt for AI editing
 * @param {EditCandidate[]} candidates - Items to edit
 * @returns {string}
 */
function buildEditPrompt(candidates) {
  const items = candidates.map(c => ({
    path: c.path,
    text: c.text
  }));

  return `Please improve the following goal-related text items:

${JSON.stringify(items, null, 2)}

Respond with a JSON array of improved items. Only include items you've actually changed.`;
}

/**
 * Sleep for a given duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay with jitter
 * @param {number} attempt - Current attempt (0-indexed)
 * @param {number} baseMs - Base delay in ms
 * @param {number} maxMs - Maximum delay in ms
 * @returns {number}
 */
function calculateBackoff(attempt, baseMs, maxMs) {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  // Add jitter: +/- 10%
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Send a batch request to the LLM
 * @param {AiEditConfig} config - Configuration
 * @param {EditCandidate[]} batch - Batch of candidates
 * @returns {Promise<Map<string, string>>} Map of path -> enhanced text
 */
async function sendBatchRequest(config, batch) {
  const {
    llmUrl,
    protocol = 'json',
    model = 'default',
    timeoutMs = 120000,
    headers = {},
    apiKey,
    debugPath
  } = config;

  const userPrompt = buildEditPrompt(batch);

  // Build request body - format depends on the API
  const isAnthropic = llmUrl.includes('anthropic');
  const isOpenAI = llmUrl.includes('openai');

  let requestBody;
  if (isAnthropic) {
    // Anthropic format: system is a top-level parameter
    requestBody = {
      model: model || 'claude-sonnet-4-20250514',
      system: AI_EDIT_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 4096,
      temperature: 0.3
    };
  } else {
    // OpenAI format: system is a message role
    requestBody = {
      model: model || 'gpt-4',
      messages: [
        { role: 'system', content: AI_EDIT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 4096,
      temperature: 0.3
    };
  }

  // Handle streaming options
  if (protocol === 'sse') {
    requestBody.stream = true;
  }

  const requestHeaders = {
    'Content-Type': 'application/json',
    ...headers
  };

  // Add API key if provided
  if (apiKey) {
    // Support various API key header formats
    if (isAnthropic) {
      requestHeaders['x-api-key'] = apiKey;
      requestHeaders['anthropic-version'] = '2023-06-01';
    } else if (isOpenAI) {
      requestHeaders['Authorization'] = `Bearer ${apiKey}`;
    } else {
      // Default to Authorization header
      requestHeaders['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(llmUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    // Parse response based on protocol
    let items;
    if (protocol === 'json') {
      const json = await response.json();
      // Handle various response formats
      let content = json.content?.[0]?.text || json.choices?.[0]?.message?.content || json.text || '';

      // Extract JSON from the content
      try {
        const match = content.match(/\[[\s\S]*\]/);
        if (match) {
          items = JSON.parse(match[0]);
        } else {
          items = [];
        }
      } catch {
        items = [];
      }
    } else {
      // Streaming protocols
      const parsed = await readStreamingResponse(response, protocol, { debugPath });
      items = extractEditItems(parsed);
    }

    // Build result map
    const results = new Map();
    for (const item of items) {
      if (item.path && item.text) {
        results.set(item.path, item.text);
      }
    }

    return results;

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * Send a batch request with retry logic
 * @param {AiEditConfig} config - Configuration
 * @param {EditCandidate[]} batch - Batch of candidates
 * @returns {Promise<Map<string, string>>}
 */
async function sendBatchWithRetry(config, batch) {
  const {
    retries = 3,
    backoffMs = 500,
    backoffMaxMs = 8000
  } = config;

  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await sendBatchRequest(config, batch);
    } catch (err) {
      lastError = err;

      if (attempt < retries - 1) {
        const delay = calculateBackoff(attempt, backoffMs, backoffMaxMs);
        console.error(`[AI Edit] Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${err.message}`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`All ${retries} attempts failed. Last error: ${lastError.message}`);
}

/**
 * Run AI editing on goal content
 * @param {AiEditConfig} config - Configuration
 * @param {Object} project - Project metadata
 * @param {Object[]} goals - Goals array
 * @returns {Promise<{edits: Map<string, string>, stats: Object}>}
 */
export async function aiEditStrings(config, project, goals) {
  const {
    batchSize = 10,
    includeGlobs = [],
    excludeGlobs = [],
    includeContext = false,
    debugPath
  } = config;

  // Collect all editable paths
  const allPaths = collectContentStringPaths(project, goals, { includeContext });

  // Filter paths based on include/exclude patterns
  const filteredPaths = allPaths.filter(p =>
    shouldIncludePath(p, includeGlobs, excludeGlobs)
  );

  if (filteredPaths.length === 0) {
    return {
      edits: new Map(),
      stats: { total: 0, processed: 0, edited: 0 }
    };
  }

  // Build wrapper object for getByPath
  const wrapper = { project, goals };

  // Collect candidates with their current text
  const candidates = [];
  for (const path of filteredPaths) {
    const text = getByPath(wrapper, path);
    if (typeof text === 'string' && text.trim().length > 0) {
      candidates.push({ path, text });
    }
  }

  if (debugPath) {
    console.log(`[AI Edit] Found ${candidates.length} candidates to edit`);
  }

  // Split into batches
  const batches = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    batches.push(candidates.slice(i, i + batchSize));
  }

  // Process batches
  const allEdits = new Map();
  let processedCount = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    if (debugPath) {
      console.log(`[AI Edit] Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);
    }

    try {
      const batchEdits = await sendBatchWithRetry(config, batch);

      for (const [path, text] of batchEdits) {
        allEdits.set(path, text);
      }

      processedCount += batch.length;
    } catch (err) {
      console.error(`[AI Edit] Batch ${i + 1} failed: ${err.message}`);
      // Continue with other batches
    }
  }

  return {
    edits: allEdits,
    stats: {
      total: candidates.length,
      processed: processedCount,
      edited: allEdits.size
    }
  };
}

/**
 * Apply AI edits to the goals structure
 * @param {Object} project - Project metadata (modified in place)
 * @param {Object[]} goals - Goals array (modified in place)
 * @param {Map<string, string>} edits - Edits to apply
 * @returns {{project: Object, goals: Object[]}}
 */
export function applyAiEdits(project, goals, edits) {
  const wrapper = { project, goals };

  for (const [path, text] of edits) {
    try {
      setByPath(wrapper, path, text);
    } catch (err) {
      console.error(`[AI Edit] Failed to apply edit at ${path}: ${err.message}`);
    }
  }

  return { project: wrapper.project, goals: wrapper.goals };
}

/**
 * Preview AI edits without applying
 * @param {Object} project - Project metadata
 * @param {Object[]} goals - Goals array
 * @param {Map<string, string>} edits - Proposed edits
 * @returns {Array<{path: string, before: string, after: string}>}
 */
export function previewAiEdits(project, goals, edits) {
  const wrapper = { project, goals };
  const previews = [];

  for (const [path, after] of edits) {
    const before = getByPath(wrapper, path);
    if (before !== after) {
      previews.push({ path, before: String(before), after });
    }
  }

  return previews;
}

/**
 * Validate AI edit configuration
 * @param {AiEditConfig} config - Configuration to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAiEditConfig(config) {
  const errors = [];

  if (!config.llmUrl) {
    errors.push('Missing llmUrl - specify --llm-url');
  } else {
    try {
      new URL(config.llmUrl);
    } catch {
      errors.push(`Invalid llmUrl: ${config.llmUrl}`);
    }
  }

  const validProtocols = ['json', 'ndjson', 'sse'];
  if (config.protocol && !validProtocols.includes(config.protocol)) {
    errors.push(`Invalid protocol: ${config.protocol}. Must be one of: ${validProtocols.join(', ')}`);
  }

  if (config.batchSize && (config.batchSize < 1 || config.batchSize > 100)) {
    errors.push('batchSize must be between 1 and 100');
  }

  if (config.timeoutMs && config.timeoutMs < 1000) {
    errors.push('timeoutMs must be at least 1000');
  }

  return { valid: errors.length === 0, errors };
}

export default {
  aiEditStrings,
  applyAiEdits,
  previewAiEdits,
  validateAiEditConfig,
  AI_EDIT_SYSTEM_PROMPT
};
