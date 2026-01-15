/**
 * @fileoverview Browser Request Tool using Playwright for browser automation
 * @module browser-request-tool
 */

/**
 * Browser Request Tool for headless browser automation
 */
export class BrowserRequestTool {
  /**
   * @param {Object} [config]
   * @param {string[]} [config.allowedHosts=[]] - Allowlist of hosts (supports *.domain.com wildcards)
   * @param {number} [config.defaultTimeout=30000] - Default page timeout in ms
   * @param {boolean} [config.headless=true] - Run browser in headless mode
   * @param {Object} [config.defaultViewport] - Default viewport size
   */
  constructor(config = {}) {
    /** @type {string[]} */
    this.allowedHosts = config.allowedHosts || [];

    /** @type {number} */
    this.defaultTimeout = config.defaultTimeout || 30000;

    /** @type {boolean} */
    this.headless = config.headless !== false;

    /** @type {Object} */
    this.defaultViewport = config.defaultViewport || { width: 1280, height: 720 };

    /** @type {Object|null} */
    this.browser = null;

    /** @type {Promise|null} */
    this.browserPromise = null;

    /** @type {Object|null} */
    this.playwright = null;
  }

  /**
   * Lazy load playwright and get browser instance
   * @returns {Promise<Object>}
   */
  async getBrowser() {
    if (this.browser) {
      return this.browser;
    }

    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = (async () => {
      // Dynamic import of playwright
      if (!this.playwright) {
        try {
          this.playwright = await import('playwright');
        } catch (err) {
          throw new Error('Playwright is not installed. Run: bun add playwright');
        }
      }

      const { chromium } = this.playwright;
      this.browser = await chromium.launch({
        headless: this.headless
      });

      return this.browser;
    })();

    try {
      this.browser = await this.browserPromise;
      return this.browser;
    } finally {
      this.browserPromise = null;
    }
  }

  /**
   * Close browser instance
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Execute browser action
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const {
      url,
      action = 'fetch',
      waitFor,
      timeout,
      script,
      selector,
      value,
      fullPage = false,
      viewport,
      userAgent,
      extraHeaders
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

    const pageTimeout = timeout || this.defaultTimeout;

    try {
      const browser = await this.getBrowser();
      const context = await browser.newContext({
        viewport: viewport || this.defaultViewport,
        userAgent: userAgent,
        extraHTTPHeaders: extraHeaders
      });

      const page = await context.newPage();
      page.setDefaultTimeout(pageTimeout);

      // Collect console messages for evaluate action
      const consoleLogs = [];
      if (action === 'evaluate') {
        page.on('console', msg => {
          consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
        });
      }

      try {
        // Navigate to URL
        const waitUntil = this.getWaitUntil(waitFor);
        await page.goto(url, { waitUntil, timeout: pageTimeout });

        // Wait for selector if specified
        if (waitFor && !['load', 'domcontentloaded', 'networkidle'].includes(waitFor)) {
          await page.waitForSelector(waitFor, { timeout: pageTimeout });
        }

        // Execute action
        let result;
        switch (action) {
          case 'fetch':
            result = await this.actionFetch(page);
            break;
          case 'screenshot':
            result = await this.actionScreenshot(page, fullPage);
            break;
          case 'pdf':
            result = await this.actionPdf(page);
            break;
          case 'evaluate':
            result = await this.actionEvaluate(page, script, consoleLogs);
            break;
          case 'click':
            result = await this.actionClick(page, selector);
            break;
          case 'fill':
            result = await this.actionFill(page, selector, value);
            break;
          case 'wait':
            result = await this.actionWait(page, selector || waitFor, pageTimeout);
            break;
          default:
            return this.formatError(`Invalid action: ${action}. Use 'fetch', 'screenshot', 'pdf', 'evaluate', 'click', 'fill', or 'wait'.`);
        }

        return this.formatResponse(result);

      } finally {
        await context.close();
      }

    } catch (err) {
      if (err.message.includes('Playwright is not installed')) {
        return this.formatError(err.message);
      }
      return this.formatError(`Browser error: ${err.message}`);
    }
  }

  /**
   * Determine waitUntil value
   * @param {string} waitFor
   * @returns {string}
   */
  getWaitUntil(waitFor) {
    if (waitFor === 'networkidle') return 'networkidle';
    if (waitFor === 'domcontentloaded') return 'domcontentloaded';
    return 'load';
  }

  /**
   * Fetch page content
   * @param {Object} page
   * @returns {Promise<Object>}
   */
  async actionFetch(page) {
    const html = await page.content();
    const title = await page.title();
    const url = page.url();

    return {
      action: 'fetch',
      url,
      title,
      html
    };
  }

  /**
   * Take screenshot
   * @param {Object} page
   * @param {boolean} fullPage
   * @returns {Promise<Object>}
   */
  async actionScreenshot(page, fullPage) {
    const buffer = await page.screenshot({
      fullPage,
      type: 'png'
    });

    const viewport = page.viewportSize();

    return {
      action: 'screenshot',
      image: buffer.toString('base64'),
      format: 'png',
      width: viewport?.width || 1280,
      height: viewport?.height || 720,
      fullPage
    };
  }

  /**
   * Generate PDF
   * @param {Object} page
   * @returns {Promise<Object>}
   */
  async actionPdf(page) {
    const buffer = await page.pdf({
      format: 'A4',
      printBackground: true
    });

    return {
      action: 'pdf',
      data: buffer.toString('base64'),
      format: 'A4',
      size: buffer.length
    };
  }

  /**
   * Evaluate JavaScript in page context
   * @param {Object} page
   * @param {string} script
   * @param {string[]} consoleLogs
   * @returns {Promise<Object>}
   */
  async actionEvaluate(page, script, consoleLogs) {
    if (!script) {
      return {
        action: 'evaluate',
        error: 'script is required for evaluate action'
      };
    }

    try {
      const result = await page.evaluate(script);
      return {
        action: 'evaluate',
        result,
        logs: consoleLogs
      };
    } catch (err) {
      return {
        action: 'evaluate',
        error: err.message,
        logs: consoleLogs
      };
    }
  }

  /**
   * Click element
   * @param {Object} page
   * @param {string} selector
   * @returns {Promise<Object>}
   */
  async actionClick(page, selector) {
    if (!selector) {
      return {
        action: 'click',
        error: 'selector is required for click action'
      };
    }

    await page.click(selector);
    return {
      action: 'click',
      success: true,
      selector
    };
  }

  /**
   * Fill form field
   * @param {Object} page
   * @param {string} selector
   * @param {string} value
   * @returns {Promise<Object>}
   */
  async actionFill(page, selector, value) {
    if (!selector) {
      return {
        action: 'fill',
        error: 'selector is required for fill action'
      };
    }
    if (value === undefined) {
      return {
        action: 'fill',
        error: 'value is required for fill action'
      };
    }

    await page.fill(selector, value);
    return {
      action: 'fill',
      success: true,
      selector,
      value
    };
  }

  /**
   * Wait for selector or condition
   * @param {Object} page
   * @param {string} selectorOrCondition
   * @param {number} timeout
   * @returns {Promise<Object>}
   */
  async actionWait(page, selectorOrCondition, timeout) {
    if (!selectorOrCondition) {
      return {
        action: 'wait',
        error: 'selector or waitFor is required for wait action'
      };
    }

    if (selectorOrCondition === 'networkidle') {
      await page.waitForLoadState('networkidle', { timeout });
    } else {
      await page.waitForSelector(selectorOrCondition, { timeout });
    }

    return {
      action: 'wait',
      success: true,
      waitedFor: selectorOrCondition
    };
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
      'browser_request',
      this.execute.bind(this),
      {
        name: 'browser_request',
        description: 'Navigate to URLs with a headless Chromium browser. Supports fetching rendered HTML, screenshots, PDFs, JavaScript evaluation, and page interactions (click, fill).',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              description: 'URL to navigate to'
            },
            action: {
              type: 'string',
              enum: ['fetch', 'screenshot', 'pdf', 'evaluate', 'click', 'fill', 'wait'],
              default: 'fetch',
              description: 'Action to perform after navigation'
            },
            waitFor: {
              type: 'string',
              description: 'CSS selector to wait for, or "networkidle", "load", "domcontentloaded"'
            },
            timeout: {
              type: 'integer',
              minimum: 1000,
              maximum: 120000,
              default: 30000,
              description: 'Page timeout in milliseconds'
            },
            script: {
              type: 'string',
              description: 'JavaScript code to execute in page context (for evaluate action)'
            },
            selector: {
              type: 'string',
              description: 'CSS selector for element (for click, fill, wait actions)'
            },
            value: {
              type: 'string',
              description: 'Value to fill (for fill action)'
            },
            fullPage: {
              type: 'boolean',
              default: false,
              description: 'Capture full page screenshot (for screenshot action)'
            },
            viewport: {
              type: 'object',
              properties: {
                width: {
                  type: 'integer',
                  minimum: 320,
                  maximum: 3840,
                  default: 1280
                },
                height: {
                  type: 'integer',
                  minimum: 240,
                  maximum: 2160,
                  default: 720
                }
              },
              description: 'Browser viewport size'
            },
            userAgent: {
              type: 'string',
              description: 'Custom User-Agent string'
            },
            extraHeaders: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Extra HTTP headers to send with requests'
            }
          },
          required: ['url']
        }
      }
    );
  }
}

/**
 * Create a BrowserRequestTool instance
 * @param {Object} [config]
 * @returns {BrowserRequestTool}
 */
export function createBrowserRequestTool(config) {
  return new BrowserRequestTool(config);
}

export default BrowserRequestTool;
