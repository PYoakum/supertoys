/**
 * @fileoverview Context Research Browser Tool
 * @module context-research-browser-tool
 *
 * Fetches web page content using a headless browser, converts it to markdown,
 * and adds it to the session's context directory and context object.
 *
 * Useful for:
 * - Researching documentation
 * - Gathering reference material
 * - Adding external resources to session context
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  timeout: 30000,
  waitFor: 'networkidle',
  maxContentLength: 500000,  // 500KB max content
  removeSelectors: [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'footer', 'header', 'aside',
    '.advertisement', '.ad', '.ads', '.sidebar',
    '#cookie-banner', '.cookie-notice', '.popup'
  ]
};

/**
 * Convert HTML to Markdown
 * @param {string} html - HTML content
 * @returns {string} Markdown content
 */
function htmlToMarkdown(html) {
  let md = html;

  // Remove script and style tags with content
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n\n');

  // Convert formatting
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '_$1_');
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, '~~$1~~');
  md = md.replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, '~~$1~~');
  md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~');
  md = md.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '==$1==');

  // Convert code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Convert lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
    let i = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${++i}. $1\n`);
  });

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
    return content.split('\n').map(line => `> ${line}`).join('\n') + '\n';
  });

  // Convert paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Convert tables (basic support)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, content) => {
    let result = '\n';
    const rows = content.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

    rows.forEach((row, idx) => {
      const cells = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [];
      const cellContents = cells.map(cell =>
        cell.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/i, '$1').trim()
      );

      result += '| ' + cellContents.join(' | ') + ' |\n';

      // Add header separator after first row
      if (idx === 0) {
        result += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
      }
    });

    return result + '\n';
  });

  // Convert definition lists
  md = md.replace(/<dl[^>]*>([\s\S]*?)<\/dl>/gi, (match, content) => {
    let result = '';
    content = content.replace(/<dt[^>]*>([\s\S]*?)<\/dt>/gi, '\n**$1**\n');
    content = content.replace(/<dd[^>]*>([\s\S]*?)<\/dd>/gi, ': $1\n');
    return content;
  });

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&copy;/g, '©');
  md = md.replace(/&reg;/g, '®');
  md = md.replace(/&trade;/g, '™');
  md = md.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.replace(/[ \t]+/g, ' ');
  md = md.replace(/^\s+|\s+$/gm, '');

  return md.trim();
}

/**
 * Generate a safe filename from URL
 * @param {string} url
 * @returns {string}
 */
function urlToFilename(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const lastPart = pathParts.pop() || parsed.hostname;

    // Clean the filename
    let filename = lastPart
      .replace(/\.[^.]+$/, '')  // Remove extension
      .replace(/[^a-zA-Z0-9-_]/g, '-')  // Replace special chars
      .replace(/-+/g, '-')  // Collapse multiple dashes
      .slice(0, 50);  // Limit length

    if (!filename) {
      filename = parsed.hostname.replace(/\./g, '-');
    }

    return `${filename}.md`;
  } catch {
    return 'research-content.md';
  }
}

/**
 * Context Research Browser Tool
 */
export class ContextResearchBrowserTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {import('./session-manager.js').SessionManager} [sessionManager]
   * @param {Object} [config]
   * @param {import('./llm-client.js').LLMClient} [config.llmClient]
   */
  constructor(sandboxManager, sessionManager = null, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for ContextResearchBrowserTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {import('./session-manager.js').SessionManager|null} */
    this.sessionManager = sessionManager;

    /** @type {import('./llm-client.js').LLMClient|null} */
    this.llmClient = config.llmClient || null;

    /** @type {string[]} */
    this.allowedHosts = config.allowedHosts || ['*'];  // Allow all by default for research

    /** @type {number} */
    this.timeout = config.timeout || DEFAULT_CONFIG.timeout;

    /** @type {string} */
    this.waitFor = config.waitFor || DEFAULT_CONFIG.waitFor;

    /** @type {number} */
    this.maxContentLength = config.maxContentLength || DEFAULT_CONFIG.maxContentLength;

    /** @type {string[]} */
    this.removeSelectors = config.removeSelectors || DEFAULT_CONFIG.removeSelectors;

    /** @type {Object|null} */
    this.browser = null;

    /** @type {Object|null} */
    this.playwright = null;

    /** @type {number} */
    this.analysisMaxContentLength = config.analysisMaxContentLength || 100000;
  }

  /**
   * Get or create browser instance
   * @returns {Promise<Object>}
   */
  async getBrowser() {
    if (this.browser) {
      return this.browser;
    }

    if (!this.playwright) {
      try {
        this.playwright = await import('playwright');
      } catch (err) {
        throw new Error('Playwright is not installed. Run: bun add playwright');
      }
    }

    const { chromium } = this.playwright;
    this.browser = await chromium.launch({ headless: true });
    return this.browser;
  }

  /**
   * Close browser
   */
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Analyze content using LLM
   * @param {string} content - Markdown content to analyze
   * @param {Object} metadata - Page metadata (title, url, etc.)
   * @param {string} [intent] - Research intent/objective to guide analysis
   * @returns {Promise<Object>} Analysis result
   * @private
   */
  async _analyzeContent(content, metadata, intent = null) {
    if (!this.llmClient) {
      return this._basicAnalysis(content, metadata);
    }

    const intentSection = intent
      ? `\nRESEARCH INTENT: ${intent}\nFocus your analysis on extracting information relevant to this intent. Prioritize findings that directly address this objective.\n`
      : '';

    const systemPrompt = `task:
  role: Research Content Analyzer
  objective: Extract structured insights from research content
${intentSection}
output_format: TOML (resilient to truncation)

TOML_TEMPLATE:
# Research Analysis
summary = "2-3 sentence summary directly addressing the research intent and key findings"

tags = ["tag1", "tag2", "tag3", "tag4", "tag5"]
key_concepts = ["concept1", "concept2", "concept3"]

[[key_findings]]
topic = "Topic Area"
finding = "Specific factual finding with details, examples, or data points extracted from the content"
importance = "high"

[[key_findings]]
topic = "Another Topic"
finding = "Another detailed finding with concrete information"
importance = "medium"

instructions:
  - Write a summary that directly addresses the research intent (if provided)
  - Extract 5-10 meaningful tags that categorize the content
  - Identify key concepts, terminology, and technical terms (5-10 items)
  - Extract 5-10 key findings with SPECIFIC details, not vague statements
  - Each finding should contain concrete facts, examples, numbers, or techniques
  - Rate importance based on relevance to the research intent
  - Focus on extracting actionable, specific information rather than general observations

CRITICAL: Output ONLY valid TOML. No markdown blocks, no explanations.`;

    const intentPrompt = intent ? `\nResearch Intent: ${intent}\n` : '';
    const userPrompt = `Analyze this research content:

Title: ${metadata.title || 'Unknown'}
Source: ${metadata.url || 'Unknown'}
${intentPrompt}
Content:
${content.slice(0, this.analysisMaxContentLength)}`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        parameters: { temperature: 0.3, maxTokens: 2048 }
      });

      return this._parseTomlResponse(response.content);
    } catch (err) {
      console.error('LLM analysis failed:', err.message);
      return this._basicAnalysis(content, metadata);
    }
  }

  /**
   * Parse TOML response from LLM
   * @param {string} tomlStr
   * @returns {Object}
   * @private
   */
  _parseTomlResponse(tomlStr) {
    let clean = tomlStr
      .replace(/^```toml?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    const result = {
      summary: '',
      tags: [],
      key_concepts: [],
      key_findings: []
    };

    let currentArraySection = null;
    let currentArrayItem = null;

    for (const line of clean.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Array of tables: [[section]]
      const arrayMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
      if (arrayMatch) {
        if (currentArrayItem && currentArraySection) {
          if (!result[currentArraySection]) result[currentArraySection] = [];
          result[currentArraySection].push(currentArrayItem);
        }
        currentArraySection = arrayMatch[1].trim();
        currentArrayItem = {};
        continue;
      }

      // Regular section (end array mode)
      if (trimmed.match(/^\[[^\]]+\]$/)) {
        if (currentArrayItem && currentArraySection) {
          if (!result[currentArraySection]) result[currentArraySection] = [];
          result[currentArraySection].push(currentArrayItem);
          currentArrayItem = null;
          currentArraySection = null;
        }
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        const value = this._parseTomlValue(kvMatch[2].trim());

        if (currentArrayItem) {
          currentArrayItem[key] = value;
        } else if (result.hasOwnProperty(key)) {
          result[key] = value;
        }
      }
    }

    // Save final array item
    if (currentArrayItem && currentArraySection) {
      if (!result[currentArraySection]) result[currentArraySection] = [];
      result[currentArraySection].push(currentArrayItem);
    }

    return result;
  }

  /**
   * Parse a TOML value
   * @param {string} value
   * @returns {*}
   * @private
   */
  _parseTomlValue(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    if (value === 'true') return true;
    if (value === 'false') return false;

    if (value.startsWith('[')) {
      try {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];
        const items = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (const char of inner) {
          if ((char === '"' || char === "'") && !inQuote) {
            inQuote = true;
            quoteChar = char;
            current += char;
          } else if (char === quoteChar && inQuote) {
            inQuote = false;
            current += char;
          } else if (char === ',' && !inQuote) {
            items.push(this._parseTomlValue(current.trim()));
            current = '';
          } else {
            current += char;
          }
        }
        if (current.trim()) {
          items.push(this._parseTomlValue(current.trim()));
        }
        return items;
      } catch {
        return [];
      }
    }

    if (/^-?\d*\.?\d+$/.test(value)) {
      return parseFloat(value);
    }

    return value;
  }

  /**
   * Basic analysis without LLM
   * @param {string} content
   * @param {Object} metadata
   * @returns {Object}
   * @private
   */
  _basicAnalysis(content, metadata) {
    // Extract headings as tags
    const headings = content.match(/^#{1,3}\s+(.+)$/gm) || [];
    const tags = headings.map(h => h.replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-')).filter(Boolean);

    // Word frequency for concepts
    const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const concepts = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([word]) => word);

    // Extract first paragraph as summary
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim() && !p.startsWith('#') && !p.startsWith('>'));
    const summary = paragraphs[0]?.slice(0, 300)?.replace(/\n/g, ' ') + '...' || 'No summary available';

    // Create basic findings from headings
    const findings = headings.slice(0, 5).map((h, i) => ({
      topic: h.replace(/^#+\s*/, ''),
      finding: `Section covering ${h.replace(/^#+\s*/, '')}`,
      importance: i < 2 ? 'high' : 'medium'
    }));

    return {
      summary,
      tags: [...new Set(tags)].slice(0, 10),
      key_concepts: concepts,
      key_findings: findings
    };
  }

  /**
   * Check if host is allowed
   * @param {string} hostname
   * @returns {boolean}
   */
  isHostAllowed(hostname) {
    if (this.allowedHosts.includes('*')) return true;

    for (const pattern of this.allowedHosts) {
      if (pattern.startsWith('*.')) {
        const domain = pattern.slice(2);
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return true;
        }
      } else if (hostname === pattern) {
        return true;
      }
    }
    return false;
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      url,
      filename,
      title,
      selector,          // Optional: CSS selector to extract specific content
      waitForSelector,   // Optional: Wait for specific element
      includeMetadata = true,
      addToContext = true,
      analyze = true,    // Auto-analyze content after fetching
      intent,            // Optional: Research intent to guide analysis
      timeout = this.timeout
    } = args;

    // Validate
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!url) {
      return this.formatError('url is required');
    }

    // Parse URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return this.formatError(`Invalid URL: ${url}`);
    }

    // Check host allowlist
    if (!this.isHostAllowed(parsedUrl.hostname)) {
      return this.formatError(`Host not allowed: ${parsedUrl.hostname}`);
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const contextDir = join(sandboxPath, 'context');

    // Ensure context directory exists
    if (!existsSync(contextDir)) {
      await mkdir(contextDir, { recursive: true });
    }

    try {
      // Fetch page content
      const browser = await this.getBrowser();
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (compatible; YayAgent Research Bot/1.0)'
      });

      const page = await context.newPage();
      page.setDefaultTimeout(timeout);

      try {
        // Navigate
        await page.goto(url, {
          waitUntil: this.waitFor === 'networkidle' ? 'networkidle' : 'domcontentloaded',
          timeout
        });

        // Wait for specific selector if provided
        if (waitForSelector) {
          await page.waitForSelector(waitForSelector, { timeout: timeout / 2 });
        }

        // Remove unwanted elements
        for (const sel of this.removeSelectors) {
          try {
            await page.evaluate((selector) => {
              document.querySelectorAll(selector).forEach(el => el.remove());
            }, sel);
          } catch {
            // Selector might not exist, continue
          }
        }

        // Get page info
        const pageTitle = title || await page.title();
        const pageUrl = page.url();

        // Extract content
        let html;
        if (selector) {
          // Extract specific element
          const element = await page.$(selector);
          if (!element) {
            return this.formatError(`Selector not found: ${selector}`);
          }
          html = await element.innerHTML();
        } else {
          // Extract main content (try common content selectors)
          const contentSelectors = [
            'main',
            'article',
            '[role="main"]',
            '.content',
            '.main-content',
            '#content',
            '#main',
            '.post-content',
            '.article-content',
            '.entry-content'
          ];

          for (const sel of contentSelectors) {
            try {
              const element = await page.$(sel);
              if (element) {
                html = await element.innerHTML();
                break;
              }
            } catch {
              continue;
            }
          }

          // Fallback to body
          if (!html) {
            html = await page.evaluate(() => document.body.innerHTML);
          }
        }

        // Convert to markdown
        let markdown = htmlToMarkdown(html);

        // Truncate if too long
        if (markdown.length > this.maxContentLength) {
          markdown = markdown.slice(0, this.maxContentLength) + '\n\n... (content truncated)';
        }

        // Add metadata header
        if (includeMetadata) {
          const metadataHeader = [
            '---',
            `title: "${pageTitle.replace(/"/g, '\\"')}"`,
            `url: "${pageUrl}"`,
            `fetched_at: "${new Date().toISOString()}"`,
            `source: context_research_browser`,
            '---',
            '',
            `# ${pageTitle}`,
            '',
            `> Source: [${pageUrl}](${pageUrl})`,
            '',
            ''
          ].join('\n');

          markdown = metadataHeader + markdown;
        }

        // Generate filename
        const outputFilename = filename || urlToFilename(url);
        const outputPath = join(contextDir, outputFilename);

        // Write to file
        await writeFile(outputPath, markdown, 'utf-8');

        // Generate content hash
        const contentHash = createHash('sha256').update(markdown).digest('hex').slice(0, 16);

        // Build context file entry
        const contextFile = {
          path: `context/${outputFilename}`,
          content: markdown,
          type: 'text/markdown',
          size: markdown.length,
          contentHash,
          metadata: {
            sourceUrl: pageUrl,
            pageTitle,
            fetchedAt: new Date().toISOString(),
            tool: 'context_research_browser'
          }
        };

        // Add to session context if session manager available
        let contextUpdated = false;
        if (addToContext && this.sessionManager) {
          try {
            const session = this.sessionManager.getSession(sessionId);
            if (session && session.context) {
              // Add file to context
              const updatedFiles = [...session.context.files, contextFile];

              // Update formatted content
              const formattedContent = this.formatContextAsXml(updatedFiles);

              // Update session
              this.sessionManager.store.update(sessionId, {
                context: {
                  ...session.context,
                  files: updatedFiles,
                  formattedContent,
                  metadata: {
                    ...session.context.metadata,
                    totalFiles: updatedFiles.length,
                    totalSize: updatedFiles.reduce((sum, f) => sum + f.size, 0)
                  }
                }
              });

              contextUpdated = true;
            }
          } catch (err) {
            // Session might not exist yet, that's OK
            console.warn('Could not update session context:', err.message);
          }
        }

        // Analyze content if enabled
        let analysis = null;
        if (analyze) {
          analysis = await this._analyzeContent(markdown, { title: pageTitle, url: pageUrl }, intent);
        }

        return this.formatResponse({
          success: true,
          url: pageUrl,
          title: pageTitle,
          outputPath: `context/${outputFilename}`,
          absolutePath: outputPath,
          contentLength: markdown.length,
          contentHash,
          contextUpdated,
          sandboxPath,
          message: `Research content saved to context/${outputFilename}`,
          analysis
        });

      } finally {
        await context.close();
      }

    } catch (err) {
      return this.formatError(`Failed to fetch content: ${err.message}`);
    }
  }

  /**
   * Format context files as XML (matches session-manager format)
   * @param {Object[]} files
   * @returns {string}
   */
  formatContextAsXml(files) {
    const lines = ['<context>'];

    for (const file of files) {
      lines.push(`  <file path="${file.path}">`);
      lines.push(file.content);
      lines.push('  </file>');
    }

    lines.push('</context>');
    return lines.join('\n');
  }

  /**
   * Format success response
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
   * Format error response
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message })
        }
      ],
      isError: true
    };
  }

  /**
   * Register tools with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'context_research_browser',
      this.execute.bind(this),
      {
        name: 'context_research_browser',
        description: `Fetch web page content, convert to markdown, analyze key findings, and add to session context.

USE CASES:
- Research documentation for a task
- Gather reference material from websites
- Add external resources to session context
- Extract and analyze specific content from web pages

WORKFLOW:
1. Fetches URL with headless browser (handles JavaScript-rendered content)
2. Extracts main content (or specific selector)
3. Converts HTML to clean Markdown
4. Analyzes content to extract key findings, tags, and concepts (guided by intent if provided)
5. Saves to context directory in sandbox
6. Optionally adds to session's context object

OUTPUT:
- Markdown file in sandbox/context/ directory
- Includes YAML frontmatter with source URL, title, fetch date
- Content is cleaned and formatted for LLM consumption
- Analysis includes: summary, tags, key_concepts, key_findings

ANALYSIS OUTPUT:
- summary: 2-3 sentence summary directly addressing research intent
- tags: Topic categorization (5-10 tags)
- key_concepts: Main terminology and technical terms (5-10 items)
- key_findings: Array of {topic, finding, importance} with specific details

INTENT-DRIVEN ANALYSIS:
When 'intent' parameter is provided, analysis focuses on extracting information relevant to that objective.
Example intent: "identify video game music styles, chord progressions, and compositional techniques"
The analysis will then prioritize findings about styles, progressions, and techniques.

FEATURES:
- Handles JavaScript-rendered pages
- Removes navigation, ads, popups automatically
- Extracts main content area intelligently
- Supports custom CSS selectors for specific content
- Automatic LLM-powered content analysis
- Intent-driven analysis for task-specific extraction`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            url: {
              type: 'string',
              description: 'URL to fetch content from (required)'
            },
            filename: {
              type: 'string',
              description: 'Output filename (optional, auto-generated from URL if not provided)'
            },
            title: {
              type: 'string',
              description: 'Override page title in metadata'
            },
            selector: {
              type: 'string',
              description: 'CSS selector to extract specific content (optional, extracts main content by default)'
            },
            waitForSelector: {
              type: 'string',
              description: 'CSS selector to wait for before extracting (for dynamic content)'
            },
            includeMetadata: {
              type: 'boolean',
              default: true,
              description: 'Include YAML frontmatter with source URL and metadata'
            },
            addToContext: {
              type: 'boolean',
              default: true,
              description: 'Add the file to session context object (if session exists)'
            },
            analyze: {
              type: 'boolean',
              default: true,
              description: 'Analyze content and include summary, tags, key_concepts, and key_findings in response'
            },
            intent: {
              type: 'string',
              description: 'Research intent/objective to guide analysis. When provided, the analysis will focus on extracting information relevant to this goal. Example: "identify video game music styles, chord progressions, and compositional techniques"'
            },
            timeout: {
              type: 'integer',
              default: 30000,
              description: 'Page load timeout in milliseconds'
            }
          },
          required: ['sessionId', 'url']
        }
      }
    );
  }
}

/**
 * Create a ContextResearchBrowserTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {import('./session-manager.js').SessionManager} [sessionManager]
 * @param {Object} [config]
 * @returns {ContextResearchBrowserTool}
 */
export function createContextResearchBrowserTool(sandboxManager, sessionManager, config) {
  return new ContextResearchBrowserTool(sandboxManager, sessionManager, config);
}

export default ContextResearchBrowserTool;
