/**
 * @fileoverview HTTP Request Tool for making HTTP requests
 * @module http-request-tool
 */

/**
 * HTTP Request Tool for making requests to allowed hosts
 */
export class HttpRequestTool {
  /**
   * @param {Object} [config]
   * @param {string[]} [config.allowedHosts=[]] - Allowlist of hosts (supports *.domain.com wildcards)
   * @param {number} [config.defaultTimeout=30000] - Default request timeout in ms
   * @param {number} [config.maxResponseSize=10485760] - Maximum response size in bytes (10MB)
   */
  constructor(config = {}) {
    /** @type {string[]} */
    this.allowedHosts = config.allowedHosts || [];

    /** @type {number} */
    this.defaultTimeout = config.defaultTimeout || 30000;

    /** @type {number} */
    this.maxResponseSize = config.maxResponseSize || 10 * 1024 * 1024;
  }

  /**
   * Execute HTTP request
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const {
      url,
      method = 'GET',
      headers = {},
      body,
      timeout,
      responseType = 'json',
      followRedirects = true,
      maxRedirects = 5
    } = args;

    if (!url) {
      return this.formatError('url is required');
    }

    // Parse and validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      return this.formatError(`Invalid URL: ${url}`);
    }

    // Check allowlist
    if (!this.isHostAllowed(parsedUrl.hostname)) {
      return this.formatError(`Host not allowed: ${parsedUrl.hostname}. Configure allowedHosts to enable access.`);
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutMs = timeout || this.defaultTimeout;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Prepare request options
      const fetchOptions = {
        method: method.toUpperCase(),
        headers: { ...headers },
        signal: controller.signal,
        redirect: followRedirects ? 'follow' : 'manual'
      };

      // Add body for methods that support it
      if (body && !['GET', 'HEAD'].includes(fetchOptions.method)) {
        if (typeof body === 'object') {
          fetchOptions.body = JSON.stringify(body);
          if (!fetchOptions.headers['Content-Type'] && !fetchOptions.headers['content-type']) {
            fetchOptions.headers['Content-Type'] = 'application/json';
          }
        } else {
          fetchOptions.body = body;
        }
      }

      // Track redirects manually if needed
      let redirectCount = 0;
      let currentUrl = url;
      let response;

      while (true) {
        response = await fetch(currentUrl, {
          ...fetchOptions,
          redirect: followRedirects ? 'follow' : 'manual'
        });

        // Handle manual redirect tracking
        if (!followRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (location && redirectCount < maxRedirects) {
            redirectCount++;
            currentUrl = new URL(location, currentUrl).toString();
            continue;
          }
        }

        break;
      }

      clearTimeout(timeoutId);

      // Check content length
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.maxResponseSize) {
        return this.formatError(`Response too large: ${contentLength} bytes exceeds max ${this.maxResponseSize} bytes`);
      }

      // Read response based on type
      let responseBody;
      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      switch (responseType) {
        case 'json':
          try {
            const text = await response.text();
            if (text.length > this.maxResponseSize) {
              return this.formatError(`Response too large: ${text.length} bytes exceeds max ${this.maxResponseSize} bytes`);
            }
            responseBody = JSON.parse(text);
          } catch (parseErr) {
            // If JSON parsing fails, return as text
            responseBody = await response.text();
          }
          break;

        case 'text':
          responseBody = await response.text();
          if (responseBody.length > this.maxResponseSize) {
            return this.formatError(`Response too large: ${responseBody.length} bytes exceeds max ${this.maxResponseSize} bytes`);
          }
          break;

        case 'base64':
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > this.maxResponseSize) {
            return this.formatError(`Response too large: ${buffer.byteLength} bytes exceeds max ${this.maxResponseSize} bytes`);
          }
          responseBody = Buffer.from(buffer).toString('base64');
          break;

        default:
          return this.formatError(`Invalid responseType: ${responseType}. Use 'json', 'text', or 'base64'.`);
      }

      const durationMs = Date.now() - startTime;

      return this.formatResponse({
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        timing: {
          durationMs
        }
      });

    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return this.formatError(`Request timeout after ${timeoutMs}ms`);
      }

      return this.formatError(`Request failed: ${err.message}`);
    }
  }

  /**
   * Check if host is in allowlist
   * @param {string} hostname
   * @returns {boolean}
   */
  isHostAllowed(hostname) {
    if (this.allowedHosts.length === 0) {
      return false; // Default deny
    }
    if (this.allowedHosts.includes('*')) {
      return true;
    }
    return this.allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        // Wildcard subdomain matching
        const domain = allowed.slice(2);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === allowed;
    });
  }

  /**
   * Format success response in MCP-compatible format
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
   * Format error response in MCP-compatible format
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }, null, 2)
        }
      ],
      isError: true
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'http_request',
      this.execute.bind(this),
      {
        name: 'http_request',
        description: 'Make HTTP requests to allowed hosts. Supports GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS methods with custom headers, body, and response parsing.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'The URL to request'
            },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
              default: 'GET',
              description: 'HTTP method'
            },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Request headers'
            },
            body: {
              oneOf: [
                { type: 'string' },
                { type: 'object' }
              ],
              description: 'Request body (string or JSON object). Objects are auto-serialized with Content-Type: application/json'
            },
            timeout: {
              type: 'integer',
              minimum: 1000,
              maximum: 300000,
              default: 30000,
              description: 'Request timeout in milliseconds'
            },
            responseType: {
              type: 'string',
              enum: ['json', 'text', 'base64'],
              default: 'json',
              description: 'How to parse the response body'
            },
            followRedirects: {
              type: 'boolean',
              default: true,
              description: 'Whether to follow HTTP redirects'
            },
            maxRedirects: {
              type: 'integer',
              minimum: 0,
              maximum: 20,
              default: 5,
              description: 'Maximum number of redirects to follow'
            }
          },
          required: ['url']
        }
      }
    );
  }
}

/**
 * Create an HttpRequestTool instance
 * @param {Object} [config]
 * @returns {HttpRequestTool}
 */
export function createHttpRequestTool(config) {
  return new HttpRequestTool(config);
}

export default HttpRequestTool;
