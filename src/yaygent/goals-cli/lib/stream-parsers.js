/**
 * @fileoverview Streaming response parsers for LLM APIs
 * @module stream-parsers
 *
 * Supports three streaming protocols:
 * - NDJSON: Newline-delimited JSON (one JSON object per line)
 * - SSE: Server-Sent Events (data: prefix, event separation)
 * - JSON: Standard JSON response (non-streaming)
 */

/**
 * @typedef {Object} ParseResult
 * @property {Object[]} items - Parsed items
 * @property {string} remaining - Unparsed buffer content
 * @property {Error[]} errors - Parse errors encountered
 */

/**
 * Parse NDJSON (Newline-Delimited JSON) from a buffer
 * Each line is a complete JSON object
 * @param {string} buffer - Input buffer
 * @param {function} onItem - Callback for each parsed item
 * @param {string} [debugPath] - Optional path for debug logging
 * @returns {string} Remaining unparsed buffer
 */
export function parseNdjsonLines(buffer, onItem, debugPath = null) {
  const lines = buffer.split('\n');

  // Keep the last line as it may be incomplete
  const remaining = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed);
      onItem(obj);
    } catch (err) {
      if (debugPath) {
        console.error(`[NDJSON] Parse error on line: ${trimmed.substring(0, 100)}`);
      }
      // Skip malformed lines
    }
  }

  return remaining;
}

/**
 * Parse SSE (Server-Sent Events) from a buffer
 * Events are separated by double newlines, data lines start with "data: "
 * @param {string} buffer - Input buffer
 * @param {function} onData - Callback for each data payload
 * @param {string} [debugPath] - Optional path for debug logging
 * @returns {string} Remaining unparsed buffer
 */
export function parseSseEvents(buffer, onData, debugPath = null) {
  // Split on double newlines (event boundaries)
  const events = buffer.split('\n\n');

  // Keep the last part as it may be incomplete
  const remaining = events.pop() || '';

  for (const event of events) {
    const lines = event.split('\n');
    let eventType = 'message';
    let dataLines = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      } else if (line.startsWith(':')) {
        // Comment, ignore
      }
    }

    if (dataLines.length > 0) {
      const dataStr = dataLines.join('\n');

      // Skip [DONE] marker
      if (dataStr === '[DONE]') continue;

      try {
        const obj = JSON.parse(dataStr);
        onData(obj, eventType);
      } catch (err) {
        // Some SSE data might not be JSON
        if (debugPath) {
          console.error(`[SSE] Parse error on data: ${dataStr.substring(0, 100)}`);
        }
      }
    }
  }

  return remaining;
}

/**
 * Parse a complete JSON response
 * @param {string} content - JSON content
 * @returns {Object} Parsed object
 * @throws {Error} If parsing fails
 */
export function parseJsonResponse(content) {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    content = codeBlockMatch[1].trim();
  }

  // Find JSON by matching braces
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');

  if (start !== -1 && end !== -1 && end > start) {
    content = content.slice(start, end + 1);
  }

  return JSON.parse(content);
}

/**
 * Create a streaming parser for a given protocol
 * @param {string} protocol - 'ndjson', 'sse', or 'json'
 * @param {Object} options - Parser options
 * @param {function} options.onItem - Callback for each parsed item
 * @param {string} [options.debugPath] - Debug log path
 * @returns {Object} Parser with write() and end() methods
 */
export function createStreamParser(protocol, options = {}) {
  const { onItem, debugPath } = options;
  let buffer = '';
  const items = [];

  const collectItem = (item) => {
    items.push(item);
    if (onItem) onItem(item);
  };

  return {
    /**
     * Write chunk to parser
     * @param {string} chunk - Data chunk
     */
    write(chunk) {
      buffer += chunk;

      if (protocol === 'ndjson') {
        buffer = parseNdjsonLines(buffer, collectItem, debugPath);
      } else if (protocol === 'sse') {
        buffer = parseSseEvents(buffer, collectItem, debugPath);
      }
      // For 'json', we accumulate until end()
    },

    /**
     * Signal end of stream and get results
     * @returns {Object[]} All parsed items
     */
    end() {
      if (protocol === 'json') {
        // Parse complete buffer as JSON
        try {
          const result = parseJsonResponse(buffer);
          // Handle both array and object with items property
          if (Array.isArray(result)) {
            result.forEach(collectItem);
          } else if (result.items && Array.isArray(result.items)) {
            result.items.forEach(collectItem);
          } else {
            collectItem(result);
          }
        } catch (err) {
          if (debugPath) {
            console.error(`[JSON] Final parse error: ${err.message}`);
          }
        }
      } else {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const obj = JSON.parse(buffer.trim());
            collectItem(obj);
          } catch {
            // Ignore incomplete data
          }
        }
      }

      buffer = '';
      return items;
    },

    /**
     * Get current items without ending stream
     * @returns {Object[]}
     */
    getItems() {
      return [...items];
    },

    /**
     * Get remaining buffer content
     * @returns {string}
     */
    getBuffer() {
      return buffer;
    }
  };
}

/**
 * Read a streaming response with a given protocol
 * @param {Response} response - Fetch Response object
 * @param {string} protocol - 'ndjson', 'sse', or 'json'
 * @param {Object} [options] - Options
 * @param {function} [options.onItem] - Callback for each item
 * @param {string} [options.debugPath] - Debug path
 * @returns {Promise<Object[]>} Parsed items
 */
export async function readStreamingResponse(response, protocol, options = {}) {
  const parser = createStreamParser(protocol, options);

  if (protocol === 'json') {
    // Non-streaming: read entire body
    const text = await response.text();
    parser.write(text);
    return parser.end();
  }

  // Streaming: read chunks
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      parser.write(chunk);
    }

    // Final decode to flush any remaining bytes
    parser.write(decoder.decode());

  } finally {
    reader.releaseLock();
  }

  return parser.end();
}

/**
 * Extract AI edit items from parsed response
 * Handles various response formats
 * @param {Object|Object[]} response - Parsed response
 * @returns {Array<{path: string, text: string}>}
 */
export function extractEditItems(response) {
  const items = [];

  // Handle array response
  if (Array.isArray(response)) {
    for (const item of response) {
      if (item.path && item.text !== undefined) {
        items.push({ path: item.path, text: String(item.text) });
      }
    }
    return items;
  }

  // Handle object with items array
  if (response.items && Array.isArray(response.items)) {
    return extractEditItems(response.items);
  }

  // Handle object with edits array
  if (response.edits && Array.isArray(response.edits)) {
    return extractEditItems(response.edits);
  }

  // Handle single item
  if (response.path && response.text !== undefined) {
    items.push({ path: response.path, text: String(response.text) });
  }

  return items;
}

export default {
  parseNdjsonLines,
  parseSseEvents,
  parseJsonResponse,
  createStreamParser,
  readStreamingResponse,
  extractEditItems
};
