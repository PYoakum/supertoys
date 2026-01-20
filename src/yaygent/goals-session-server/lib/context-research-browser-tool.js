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
  timeout: 60000,  // 60 seconds for JS-heavy pages
  waitFor: 'domcontentloaded',  // Faster than networkidle, still waits for DOM
  maxContentLength: 500000,  // 500KB max content
  removeSelectors: [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'footer', 'header', 'aside',
    '.advertisement', '.ad', '.ads', '.sidebar',
    '#cookie-banner', '.cookie-notice', '.popup'
  ],
  // Pipeline settings
  pipeline: {
    maxUrls: 5,              // Max URLs to process in one batch
    chunkSize: 15000,        // Max chars per chunk passed between phases
    minRelevanceScore: 0.4,  // Minimum score to keep in validate phase
    parallelFetches: 3       // Concurrent browser fetches
  }
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

  // ============================================================
  // PIPELINE PHASE METHODS
  // ============================================================

  /**
   * Phase 1: GATHER - Fetch multiple URLs in parallel, extract raw content
   * @param {string[]} urls - URLs to fetch
   * @param {string} sessionId - Session ID for sandbox
   * @param {number} timeout - Timeout per fetch
   * @returns {Promise<Object[]>} Array of {url, title, content, error}
   * @private
   */
  async _gatherPhase(urls, sessionId, timeout) {
    const chunkSize = DEFAULT_CONFIG.pipeline.chunkSize;
    const parallelFetches = DEFAULT_CONFIG.pipeline.parallelFetches;

    const results = [];
    const browser = await this.getBrowser();

    // Process URLs in batches to limit concurrency
    for (let i = 0; i < urls.length; i += parallelFetches) {
      const batch = urls.slice(i, i + parallelFetches);
      const batchPromises = batch.map(async (url) => {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          userAgent: 'Mozilla/5.0 (compatible; YayAgent Research Bot/1.0)'
        });

        try {
          const page = await context.newPage();
          page.setDefaultTimeout(timeout);

          await page.goto(url, {
            waitUntil: this.waitFor,
            timeout
          });

          // Remove noise elements
          for (const sel of this.removeSelectors) {
            try {
              await page.evaluate((s) => {
                document.querySelectorAll(s).forEach(el => el.remove());
              }, sel);
            } catch { /* selector might not exist */ }
          }

          const pageTitle = await page.title();

          // Extract main content
          let html = await page.evaluate(() => {
            const selectors = ['main', 'article', '[role="main"]', '.content', '#content'];
            for (const s of selectors) {
              const el = document.querySelector(s);
              if (el) return el.innerHTML;
            }
            return document.body.innerHTML;
          });

          let content = htmlToMarkdown(html);

          // Truncate to chunk size for pipeline efficiency
          if (content.length > chunkSize) {
            content = content.slice(0, chunkSize) + '\n\n[...content truncated for pipeline...]';
          }

          return { url, title: pageTitle, content, error: null };
        } catch (err) {
          return { url, title: null, content: null, error: err.message };
        } finally {
          await context.close();
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Phase 2: VALIDATE - Score relevance and filter chunks
   * @param {Object[]} gathered - Results from gather phase
   * @param {string} intent - Research intent
   * @returns {Promise<Object[]>} Filtered results with relevance scores
   * @private
   */
  async _validatePhase(gathered, intent) {
    if (!this.llmClient) {
      // Without LLM, pass through all non-error results
      return gathered.filter(g => !g.error).map(g => ({ ...g, relevance: 0.7 }));
    }

    const validChunks = gathered.filter(g => !g.error && g.content);
    if (validChunks.length === 0) return [];

    // Build batched prompt with all chunks
    const chunksText = validChunks.map((chunk, i) =>
      `[SOURCE ${i + 1}]\nURL: ${chunk.url}\nTitle: ${chunk.title}\nContent:\n${chunk.content.slice(0, 5000)}\n`
    ).join('\n---\n');

    const systemPrompt = `You are a research relevance scorer. Given a research intent and multiple content sources, score each source's relevance from 0.0 to 1.0.

Output ONLY valid TOML with scores for each source:

[[source]]
index = 1
relevance = 0.85
reason = "Directly addresses the topic"

[[source]]
index = 2
relevance = 0.3
reason = "Tangentially related"`;

    const userPrompt = `RESEARCH INTENT: ${intent}

Score the relevance of each source to this intent:

${chunksText}`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        parameters: { temperature: 0.2, maxTokens: 1024 }
      });

      const scores = this._parseValidationResponse(response.content, validChunks.length);

      // Apply scores and filter by minimum relevance
      const minScore = DEFAULT_CONFIG.pipeline.minRelevanceScore;
      return validChunks
        .map((chunk, i) => ({
          ...chunk,
          relevance: scores[i]?.relevance || 0.5,
          relevanceReason: scores[i]?.reason || 'Default score'
        }))
        .filter(chunk => chunk.relevance >= minScore);
    } catch (err) {
      console.error('Validation phase LLM error:', err.message);
      // Fallback: return all with default score
      return validChunks.map(g => ({ ...g, relevance: 0.6 }));
    }
  }

  /**
   * Parse validation phase TOML response
   * @param {string} tomlStr
   * @param {number} expectedCount
   * @returns {Object[]}
   * @private
   */
  _parseValidationResponse(tomlStr, expectedCount) {
    const scores = [];
    const clean = tomlStr.replace(/^```toml?\n?/i, '').replace(/\n?```$/i, '').trim();

    let currentItem = null;
    for (const line of clean.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '[[source]]') {
        if (currentItem) scores.push(currentItem);
        currentItem = { index: scores.length + 1, relevance: 0.5, reason: '' };
        continue;
      }
      if (currentItem) {
        const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          if (key === 'relevance') {
            currentItem.relevance = parseFloat(value) || 0.5;
          } else if (key === 'reason') {
            currentItem.reason = value.replace(/^["']|["']$/g, '');
          } else if (key === 'index') {
            currentItem.index = parseInt(value) || currentItem.index;
          }
        }
      }
    }
    if (currentItem) scores.push(currentItem);

    // Sort by index and return
    return scores.sort((a, b) => a.index - b.index);
  }

  /**
   * Phase 3: ANALYZE - Extract structured findings from validated content
   * @param {Object[]} validated - Validated chunks with relevance scores
   * @param {string} intent - Research intent
   * @returns {Promise<Object>} Structured analysis
   * @private
   */
  async _analyzePhase(validated, intent) {
    if (!this.llmClient || validated.length === 0) {
      // Basic analysis without LLM
      return this._basicBatchAnalysis(validated);
    }

    // Combine validated chunks, prioritizing by relevance
    const sorted = [...validated].sort((a, b) => b.relevance - a.relevance);
    const combinedContent = sorted.map(v =>
      `## From: ${v.title} (relevance: ${v.relevance.toFixed(2)})\n${v.content.slice(0, 8000)}`
    ).join('\n\n---\n\n');

    const systemPrompt = `You are a research analyst. Extract structured findings from the provided content based on the research intent.

Output ONLY valid TOML:

summary = "2-3 sentence summary addressing the research intent"

tags = ["tag1", "tag2", "tag3"]
key_concepts = ["concept1", "concept2", "concept3"]

[[findings]]
topic = "Topic name"
details = "Specific finding with concrete details, examples, or data"
sources = ["source title 1"]
importance = "high"

[[findings]]
topic = "Another topic"
details = "Another specific finding"
sources = ["source title 2"]
importance = "medium"

INSTRUCTIONS:
- Focus findings on what's relevant to the research intent
- Include 5-10 specific, detailed findings
- Each finding should have concrete information, not vague statements
- Tag importance as high/medium/low based on relevance to intent`;

    const userPrompt = `RESEARCH INTENT: ${intent}

VALIDATED RESEARCH CONTENT:
${combinedContent}`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        parameters: { temperature: 0.3, maxTokens: 3000 }
      });

      return this._parseAnalysisResponse(response.content);
    } catch (err) {
      console.error('Analysis phase LLM error:', err.message);
      return this._basicBatchAnalysis(validated);
    }
  }

  /**
   * Parse analysis phase TOML response
   * @param {string} tomlStr
   * @returns {Object}
   * @private
   */
  _parseAnalysisResponse(tomlStr) {
    const result = {
      summary: '',
      tags: [],
      key_concepts: [],
      findings: []
    };

    const clean = tomlStr.replace(/^```toml?\n?/i, '').replace(/\n?```$/i, '').trim();
    let currentFinding = null;

    for (const line of clean.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === '[[findings]]') {
        if (currentFinding) result.findings.push(currentFinding);
        currentFinding = { topic: '', details: '', sources: [], importance: 'medium' };
        continue;
      }

      const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const parsed = this._parseTomlValue(value);

        if (currentFinding) {
          currentFinding[key] = parsed;
        } else if (key in result) {
          result[key] = parsed;
        }
      }
    }
    if (currentFinding) result.findings.push(currentFinding);

    return result;
  }

  /**
   * Basic batch analysis without LLM
   * @param {Object[]} validated
   * @returns {Object}
   * @private
   */
  _basicBatchAnalysis(validated) {
    const allContent = validated.map(v => v.content).join('\n\n');
    const headings = allContent.match(/^#{1,3}\s+(.+)$/gm) || [];
    const tags = headings.map(h => h.replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-')).filter(Boolean);

    return {
      summary: `Research gathered from ${validated.length} sources.`,
      tags: [...new Set(tags)].slice(0, 10),
      key_concepts: [],
      findings: validated.map(v => ({
        topic: v.title || v.url,
        details: v.content.slice(0, 200) + '...',
        sources: [v.url],
        importance: v.relevance > 0.7 ? 'high' : 'medium'
      }))
    };
  }

  /**
   * Phase 4: SYNTHESIZE - Combine findings into final report
   * @param {Object} analysis - Analysis from phase 3
   * @param {Object[]} validated - Validated sources
   * @param {string} intent - Research intent
   * @returns {Promise<Object>} Final synthesized report
   * @private
   */
  async _synthesizePhase(analysis, validated, intent) {
    if (!this.llmClient) {
      return {
        ...analysis,
        synthesis: analysis.summary,
        sources: validated.map(v => ({ url: v.url, title: v.title, relevance: v.relevance }))
      };
    }

    const findingsText = analysis.findings.map((f, i) =>
      `${i + 1}. [${f.importance}] ${f.topic}: ${f.details}`
    ).join('\n');

    const systemPrompt = `You are a research synthesizer. Create a cohesive summary that addresses the research intent using the extracted findings.

Output ONLY valid TOML:

synthesis = """
A comprehensive 2-4 paragraph synthesis that:
- Directly addresses the research intent
- Integrates key findings into a coherent narrative
- Highlights the most important discoveries
- Notes any gaps or areas needing further research
"""

[[actionable_insights]]
insight = "Specific actionable insight"
application = "How to apply this"

[[actionable_insights]]
insight = "Another insight"
application = "How to apply this"`;

    const userPrompt = `RESEARCH INTENT: ${intent}

EXTRACTED FINDINGS:
${findingsText}

KEY CONCEPTS: ${analysis.key_concepts.join(', ')}

Synthesize these findings into a cohesive response to the research intent.`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        parameters: { temperature: 0.4, maxTokens: 2000 }
      });

      const synthesized = this._parseSynthesisResponse(response.content);

      return {
        ...analysis,
        synthesis: synthesized.synthesis,
        actionable_insights: synthesized.actionable_insights,
        sources: validated.map(v => ({ url: v.url, title: v.title, relevance: v.relevance }))
      };
    } catch (err) {
      console.error('Synthesis phase LLM error:', err.message);
      return {
        ...analysis,
        synthesis: analysis.summary,
        sources: validated.map(v => ({ url: v.url, title: v.title, relevance: v.relevance }))
      };
    }
  }

  /**
   * Parse synthesis phase TOML response
   * @param {string} tomlStr
   * @returns {Object}
   * @private
   */
  _parseSynthesisResponse(tomlStr) {
    const result = {
      synthesis: '',
      actionable_insights: []
    };

    const clean = tomlStr.replace(/^```toml?\n?/i, '').replace(/\n?```$/i, '').trim();
    let currentInsight = null;
    let inMultiline = false;
    let multilineKey = '';
    let multilineValue = '';

    for (const line of clean.split('\n')) {
      const trimmed = line.trim();

      // Handle multiline strings
      if (inMultiline) {
        if (trimmed === '"""') {
          result[multilineKey] = multilineValue.trim();
          inMultiline = false;
          multilineKey = '';
          multilineValue = '';
        } else {
          multilineValue += line + '\n';
        }
        continue;
      }

      if (trimmed === '[[actionable_insights]]') {
        if (currentInsight) result.actionable_insights.push(currentInsight);
        currentInsight = { insight: '', application: '' };
        continue;
      }

      const match = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (value === '"""') {
          inMultiline = true;
          multilineKey = key;
          multilineValue = '';
        } else if (currentInsight) {
          currentInsight[key] = value.replace(/^["']|["']$/g, '');
        } else {
          result[key] = value.replace(/^["']|["']$/g, '');
        }
      }
    }
    if (currentInsight) result.actionable_insights.push(currentInsight);

    return result;
  }

  /**
   * Format synthesis results as a markdown report
   * @param {Object} result - Pipeline result
   * @param {string} intent - Research intent
   * @returns {string} Markdown report
   * @private
   */
  _formatSynthesisReport(result, intent) {
    const lines = [
      '# Research Synthesis Report',
      '',
      `> **Intent:** ${intent}`,
      '',
      `> **Generated:** ${new Date().toISOString()}`,
      '',
      '---',
      '',
      '## Summary',
      '',
      result.summary || 'No summary available.',
      '',
      '## Synthesis',
      '',
      result.synthesis || result.summary || 'No synthesis available.',
      ''
    ];

    // Add tags
    if (result.tags && result.tags.length > 0) {
      lines.push('## Tags', '', result.tags.map(t => `\`${t}\``).join(' '), '');
    }

    // Add key concepts
    if (result.key_concepts && result.key_concepts.length > 0) {
      lines.push('## Key Concepts', '', result.key_concepts.map(c => `- ${c}`).join('\n'), '');
    }

    // Add findings
    if (result.findings && result.findings.length > 0) {
      lines.push('## Key Findings', '');
      for (const finding of result.findings) {
        lines.push(`### ${finding.topic || 'Finding'}`);
        lines.push('');
        lines.push(`**Importance:** ${finding.importance || 'medium'}`);
        lines.push('');
        lines.push(finding.details || finding.finding || 'No details.');
        lines.push('');
        if (finding.sources && finding.sources.length > 0) {
          lines.push(`*Sources: ${finding.sources.join(', ')}*`);
          lines.push('');
        }
      }
    }

    // Add actionable insights
    if (result.actionable_insights && result.actionable_insights.length > 0) {
      lines.push('## Actionable Insights', '');
      for (const insight of result.actionable_insights) {
        lines.push(`- **${insight.insight}**`);
        if (insight.application) {
          lines.push(`  - Application: ${insight.application}`);
        }
        lines.push('');
      }
    }

    // Add sources
    if (result.sources && result.sources.length > 0) {
      lines.push('## Sources', '');
      for (const source of result.sources) {
        const relevance = source.relevance ? ` (relevance: ${source.relevance.toFixed(2)})` : '';
        lines.push(`- [${source.title || source.url}](${source.url})${relevance}`);
      }
      lines.push('');
    }

    // Add pipeline stats
    if (result.pipeline_stats) {
      const stats = result.pipeline_stats;
      lines.push('---', '', '## Pipeline Statistics', '');
      lines.push(`- URLs requested: ${stats.urls_requested}`);
      lines.push(`- URLs fetched: ${stats.urls_fetched}`);
      lines.push(`- URLs validated: ${stats.urls_validated}`);
      lines.push(`- Findings extracted: ${stats.findings_count}`);
      lines.push(`- Duration: ${stats.duration}ms`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Run the complete research pipeline
   * @param {Object} args - Pipeline arguments
   * @returns {Promise<Object>} Pipeline results
   * @private
   */
  async _runPipeline(args) {
    const { sessionId, urls, intent, timeout } = args;
    const startTime = Date.now();
    const phases = { gather: null, validate: null, analyze: null, synthesize: null };

    try {
      // Phase 1: GATHER
      console.log(`[Pipeline] Phase 1: Gathering ${urls.length} URLs...`);
      phases.gather = await this._gatherPhase(urls, sessionId, timeout);
      const successfulGathers = phases.gather.filter(g => !g.error);
      console.log(`[Pipeline] Gathered ${successfulGathers.length}/${urls.length} successfully`);

      if (successfulGathers.length === 0) {
        return {
          success: false,
          error: 'All URLs failed to fetch',
          phases,
          duration: Date.now() - startTime
        };
      }

      // Phase 2: VALIDATE
      console.log(`[Pipeline] Phase 2: Validating relevance...`);
      phases.validate = await this._validatePhase(phases.gather, intent);
      console.log(`[Pipeline] ${phases.validate.length} chunks passed validation`);

      if (phases.validate.length === 0) {
        return {
          success: false,
          error: 'No content passed relevance validation',
          phases,
          duration: Date.now() - startTime
        };
      }

      // Phase 3: ANALYZE
      console.log(`[Pipeline] Phase 3: Analyzing content...`);
      phases.analyze = await this._analyzePhase(phases.validate, intent);
      console.log(`[Pipeline] Extracted ${phases.analyze.findings?.length || 0} findings`);

      // Phase 4: SYNTHESIZE
      console.log(`[Pipeline] Phase 4: Synthesizing results...`);
      phases.synthesize = await this._synthesizePhase(phases.analyze, phases.validate, intent);
      console.log(`[Pipeline] Synthesis complete`);

      return {
        success: true,
        ...phases.synthesize,
        pipeline_stats: {
          urls_requested: urls.length,
          urls_fetched: successfulGathers.length,
          urls_validated: phases.validate.length,
          findings_count: phases.analyze.findings?.length || 0,
          duration: Date.now() - startTime
        }
      };
    } catch (err) {
      console.error('[Pipeline] Error:', err.message);
      return {
        success: false,
        error: err.message,
        phases,
        duration: Date.now() - startTime
      };
    }
  }

  // ============================================================
  // END PIPELINE PHASE METHODS
  // ============================================================

  /**
   * Save research findings to session storage (notepad)
   * @param {string} sessionId
   * @param {Object} findings - Research findings to save
   * @param {string} [nameHint] - Hint for naming the note (from intent or URL)
   * @returns {Promise<string|null>} - Note filename or null if failed
   * @private
   */
  async _saveToSessionStorage(sessionId, findings, nameHint = '') {
    if (!this.sessionManager) {
      return null;
    }

    try {
      // Generate a descriptive filename from the hint
      const safeName = nameHint
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'research';

      const filename = `${safeName}_findings.txt`;

      // Format findings as readable text
      let content = `# Research Findings\n`;
      content += `Generated: ${new Date().toISOString()}\n\n`;

      if (findings.summary) {
        content += `## Summary\n${findings.summary}\n\n`;
      }

      if (findings.synthesis) {
        content += `## Synthesis\n${findings.synthesis}\n\n`;
      }

      if (findings.key_concepts?.length > 0) {
        content += `## Key Concepts\n${findings.key_concepts.map(c => `- ${c}`).join('\n')}\n\n`;
      }

      if (findings.tags?.length > 0) {
        content += `## Tags\n${findings.tags.join(', ')}\n\n`;
      }

      if (findings.findings?.length > 0 || findings.key_findings?.length > 0) {
        content += `## Key Findings\n`;
        const items = findings.findings || findings.key_findings || [];
        for (const finding of items) {
          const topic = finding.topic || 'Finding';
          const details = finding.details || finding.finding || '';
          const importance = finding.importance || 'medium';
          content += `\n### ${topic} [${importance}]\n${details}\n`;
        }
        content += '\n';
      }

      if (findings.actionable_insights?.length > 0) {
        content += `## Actionable Insights\n`;
        for (const insight of findings.actionable_insights) {
          content += `- ${insight.insight}`;
          if (insight.application) {
            content += ` (Apply: ${insight.application})`;
          }
          content += '\n';
        }
        content += '\n';
      }

      if (findings.sources?.length > 0) {
        content += `## Sources\n`;
        for (const source of findings.sources) {
          const title = source.title || source.url;
          const relevance = source.relevance ? ` (${(source.relevance * 100).toFixed(0)}% relevant)` : '';
          content += `- ${title}${relevance}\n  ${source.url}\n`;
        }
      }

      // Save to session storage
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        const notes = session.notes || {};
        notes[filename] = content;
        this.sessionManager.store.update(sessionId, { notes });
        console.log(`[Research] Saved findings to session storage: ${filename}`);
        return filename;
      }
    } catch (err) {
      console.warn(`[Research] Could not save to session storage: ${err.message}`);
    }

    return null;
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
      url,             // Single URL (legacy/simple mode)
      urls,            // Multiple URLs (pipeline mode)
      filename,
      title,
      selector,          // Optional: CSS selector to extract specific content
      waitForSelector,   // Optional: Wait for specific element
      includeMetadata = true,
      addToContext = true,
      analyze = true,    // Auto-analyze content after fetching
      intent,            // Research intent to guide analysis (required for pipeline)
      usePipeline,       // Force pipeline mode even for single URL
      timeout: requestTimeout
    } = args;

    // Validate
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    // Get timeout from session manager or use default
    let timeout = requestTimeout || this.timeout;
    if (this.sessionManager) {
      try {
        timeout = this.sessionManager.getToolTimeout(sessionId, 'context_research_browser');
      } catch {
        // Session might not exist yet, use default
      }
    }

    // Determine if we should use pipeline mode
    const urlList = urls || (url ? [url] : []);
    const shouldUsePipeline = usePipeline || urlList.length > 1 || (intent && urlList.length === 1);

    if (urlList.length === 0) {
      return this.formatError('url or urls is required');
    }

    // Validate URLs
    for (const u of urlList) {
      try {
        const parsed = new URL(u);
        if (!this.isHostAllowed(parsed.hostname)) {
          return this.formatError(`Host not allowed: ${parsed.hostname}`);
        }
      } catch {
        return this.formatError(`Invalid URL: ${u}`);
      }
    }

    // PIPELINE MODE: Multiple URLs or explicit pipeline request
    if (shouldUsePipeline) {
      if (!intent) {
        return this.formatError('intent is required for pipeline mode (multiple URLs or usePipeline=true)');
      }

      const maxUrls = DEFAULT_CONFIG.pipeline.maxUrls;
      if (urlList.length > maxUrls) {
        return this.formatError(`Maximum ${maxUrls} URLs allowed per pipeline request`);
      }

      console.log(`[Research] Starting pipeline with ${urlList.length} URLs, intent: "${intent.slice(0, 50)}..."`);

      const result = await this._runPipeline({
        sessionId,
        urls: urlList,
        intent,
        timeout
      });

      // Record timeout event
      if (this.sessionManager) {
        try {
          this.sessionManager.recordTimeoutEvent(
            sessionId,
            'context_research_browser',
            !result.success,
            result.pipeline_stats?.duration || result.duration
          );
        } catch { /* ignore */ }
      }

      // Save synthesis to context if successful
      if (result.success && addToContext) {
        try {
          const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
          const artifactsDir = join(sandboxPath, 'artifacts');
          if (!existsSync(artifactsDir)) {
            await mkdir(artifactsDir, { recursive: true });
          }

          const reportPath = join(artifactsDir, 'research_synthesis.md');
          const reportContent = this._formatSynthesisReport(result, intent);
          await writeFile(reportPath, reportContent, 'utf-8');

          result.report_path = 'artifacts/research_synthesis.md';
        } catch (err) {
          console.warn('Could not save synthesis report:', err.message);
        }

        // Also save to session storage for cross-task access
        const noteFilename = await this._saveToSessionStorage(sessionId, result, intent);
        if (noteFilename) {
          result.session_note = noteFilename;
        }
      }

      return this.formatResponse(result);
    }

    // LEGACY MODE: Single URL without pipeline
    const singleUrl = urlList[0];
    let parsedUrl;
    try {
      parsedUrl = new URL(singleUrl);
    } catch {
      return this.formatError(`Invalid URL: ${singleUrl}`);
    }

    // Check host allowlist
    if (!this.isHostAllowed(parsedUrl.hostname)) {
      return this.formatError(`Host not allowed: ${parsedUrl.hostname}`);
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const contextDir = join(sandboxPath, 'context');
    const startTime = Date.now();

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
        await page.goto(singleUrl, {
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
        const outputFilename = filename || urlToFilename(singleUrl);
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
        let sessionNote = null;
        if (analyze) {
          analysis = await this._analyzeContent(markdown, { title: pageTitle, url: pageUrl }, intent);

          // Save analysis to session storage for cross-task access
          if (analysis && addToContext) {
            const nameHint = intent || pageTitle || parsedUrl.hostname;
            sessionNote = await this._saveToSessionStorage(sessionId, analysis, nameHint);
          }
        }

        // Record successful completion for timeout learning
        const duration = Date.now() - startTime;
        if (this.sessionManager) {
          try {
            this.sessionManager.recordTimeoutEvent(sessionId, 'context_research_browser', false, duration);
          } catch {
            // Ignore if session doesn't exist
          }
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
          analysis,
          session_note: sessionNote,
          duration
        });

      } finally {
        await context.close();
      }

    } catch (err) {
      // Record timeout/failure for adaptive learning
      const duration = Date.now() - startTime;
      const timedOut = err.message.includes('timeout') || err.message.includes('Timeout');
      if (this.sessionManager) {
        try {
          this.sessionManager.recordTimeoutEvent(sessionId, 'context_research_browser', timedOut, duration);
        } catch {
          // Ignore if session doesn't exist
        }
      }
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

MODES:
1. SINGLE URL MODE: Provide 'url' for simple one-page research
2. PIPELINE MODE: Provide 'urls' array for multi-source research with phased processing

PIPELINE MODE (Recommended for research tasks):
When using 'urls' (array) or setting 'usePipeline: true', the tool runs a 4-phase pipeline:
- Phase 1 (GATHER): Parallel fetch of all URLs, extract content to markdown
- Phase 2 (VALIDATE): LLM scores each source's relevance to intent, filters low-scoring
- Phase 3 (ANALYZE): LLM extracts structured findings from validated content
- Phase 4 (SYNTHESIZE): LLM combines findings into cohesive report with actionable insights

Pipeline mode REQUIRES the 'intent' parameter to guide relevance scoring and analysis.
Saves a synthesis report to artifacts/research_synthesis.md.

USE CASES:
- Research documentation for a task
- Gather reference material from multiple websites
- Add external resources to session context
- Extract and analyze specific content from web pages

SINGLE URL WORKFLOW:
1. Fetches URL with headless browser (handles JavaScript-rendered content)
2. Extracts main content (or specific selector)
3. Converts HTML to clean Markdown
4. Analyzes content to extract key findings (guided by intent if provided)
5. Saves to context directory in sandbox

ANALYSIS OUTPUT:
- summary: 2-3 sentence summary directly addressing research intent
- tags: Topic categorization (5-10 tags)
- key_concepts: Main terminology and technical terms (5-10 items)
- key_findings: Array of {topic, finding, importance} with specific details

PIPELINE OUTPUT (additional):
- synthesis: Cohesive narrative combining all findings
- actionable_insights: Specific insights with applications
- sources: List of validated sources with relevance scores
- pipeline_stats: URLs requested/fetched/validated, findings count, duration

INTENT-DRIVEN ANALYSIS:
The 'intent' parameter guides what information to extract and prioritize.
Example intent: "identify video game music styles, chord progressions, and compositional techniques"

FEATURES:
- Handles JavaScript-rendered pages
- Removes navigation, ads, popups automatically
- Parallel fetching for multiple URLs (pipeline mode)
- Relevance-based filtering (pipeline mode)
- Automatic LLM-powered content analysis
- Intent-driven extraction for task-specific results`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            url: {
              type: 'string',
              description: 'Single URL to fetch (use for simple one-page research)'
            },
            urls: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 5,
              description: 'Array of URLs to fetch and process through pipeline (max 5). Requires intent parameter.'
            },
            usePipeline: {
              type: 'boolean',
              default: false,
              description: 'Force pipeline mode even for single URL. Enables phased processing with relevance validation.'
            },
            intent: {
              type: 'string',
              description: 'Research intent/objective. REQUIRED for pipeline mode. Guides relevance scoring and analysis focus. Example: "identify video game music styles, chord progressions, and compositional techniques"'
            },
            filename: {
              type: 'string',
              description: 'Output filename for single URL mode (optional, auto-generated from URL)'
            },
            title: {
              type: 'string',
              description: 'Override page title in metadata (single URL mode)'
            },
            selector: {
              type: 'string',
              description: 'CSS selector to extract specific content (single URL mode)'
            },
            waitForSelector: {
              type: 'string',
              description: 'CSS selector to wait for before extracting (for dynamic content, single URL mode)'
            },
            includeMetadata: {
              type: 'boolean',
              default: true,
              description: 'Include YAML frontmatter with source URL and metadata (single URL mode)'
            },
            addToContext: {
              type: 'boolean',
              default: true,
              description: 'Add to session context (single URL) or save synthesis report (pipeline)'
            },
            analyze: {
              type: 'boolean',
              default: true,
              description: 'Analyze content and include findings in response (single URL mode)'
            },
            timeout: {
              type: 'integer',
              default: 60000,
              description: 'Page load timeout in milliseconds per URL'
            }
          },
          required: ['sessionId']
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
