/**
 * @fileoverview Analyze Research Tool
 * @module analyze-research-tool
 *
 * Analyzes context from context_research_browser tool with iterative refinement.
 * Creates YAML metadata files and raw research clones for debugging/context.
 *
 * Output artifacts:
 * - {source}_analysis.toml - Structured metadata with tags, relevance, summaries
 * - raw_research.md - Clone of research content for debug/toolchain context
 */

import { writeFile, mkdir, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';

/**
 * Default analysis configuration
 */
const DEFAULT_CONFIG = {
  maxIterations: 3,
  confidenceThreshold: 0.7,
  maxContentLength: 100000
};

/**
 * Analyze Research Tool
 * Performs iterative analysis on research context, extracting tags and metadata
 */
export class AnalyzeResearchTool {
  /**
   * @param {import('./session-manager.js').SessionManager} sessionManager
   * @param {Object} [config]
   * @param {import('./llm-client.js').LLMClient} [config.llmClient]
   * @param {number} [config.maxIterations]
   * @param {number} [config.confidenceThreshold]
   */
  constructor(sessionManager, config = {}) {
    if (!sessionManager) {
      throw new Error('SessionManager is required for AnalyzeResearchTool');
    }

    /** @type {import('./session-manager.js').SessionManager} */
    this.sessionManager = sessionManager;

    /** @type {import('./llm-client.js').LLMClient|null} */
    this.llmClient = config.llmClient || null;

    /** @type {number} */
    this.maxIterations = config.maxIterations || DEFAULT_CONFIG.maxIterations;

    /** @type {number} */
    this.confidenceThreshold = config.confidenceThreshold || DEFAULT_CONFIG.confidenceThreshold;

    /** @type {number} */
    this.maxContentLength = config.maxContentLength || DEFAULT_CONFIG.maxContentLength;
  }

  /**
   * Ensure artifacts directory exists
   * @param {string} sandboxPath
   * @returns {Promise<string>}
   * @private
   */
  async _ensureArtifactsDir(sandboxPath) {
    const artifactsDir = join(sandboxPath, 'artifacts');
    if (!existsSync(artifactsDir)) {
      await mkdir(artifactsDir, { recursive: true });
    }
    return artifactsDir;
  }

  /**
   * Get research content from session context
   * @param {string} sessionId
   * @param {string} [sourcePath] - Optional specific path to analyze
   * @returns {Promise<Object[]>} Array of research items
   * @private
   */
  async _getResearchContent(sessionId, sourcePath = null) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session || !session.context || !session.context.files) {
      return [];
    }

    const researchFiles = session.context.files.filter(file => {
      // Filter by source if specified
      if (sourcePath && file.path !== sourcePath) {
        return false;
      }
      // Only include files from context_research_browser
      return file.metadata?.tool === 'context_research_browser' ||
             file.path.startsWith('context/') && file.path.endsWith('.md');
    });

    return researchFiles.map(file => ({
      path: file.path,
      content: file.content,
      metadata: file.metadata || {},
      size: file.size
    }));
  }

  /**
   * Extract YAML frontmatter from markdown content
   * @param {string} content
   * @returns {Object}
   * @private
   */
  _extractFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const frontmatterStr = match[1];
    const body = content.slice(match[0].length).trim();

    // Simple YAML parsing for frontmatter
    const frontmatter = {};
    for (const line of frontmatterStr.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body };
  }

  /**
   * Analyze content using LLM
   * @param {string} content
   * @param {Object} existingMetadata
   * @param {number} iteration
   * @returns {Promise<Object>}
   * @private
   */
  async _analyzeWithLLM(content, existingMetadata, iteration) {
    if (!this.llmClient) {
      // Return basic analysis without LLM
      return this._basicAnalysis(content, existingMetadata);
    }

    const systemPrompt = `task:
  role: Research Content Analyzer
  objective: Extract structured metadata from research content
  iteration: ${iteration}

output_format: TOML (resilient to truncation)

TOML_TEMPLATE:
# Research Analysis
title = "Document Title"
summary = "2-3 sentence summary of the content"
confidence_score = 0.85
needs_refinement = false

tags = ["tag1", "tag2", "tag3", "tag4", "tag5"]
key_concepts = ["concept1", "concept2", "concept3"]

[[relevant_information]]
heading = "Section Title"
content = "Key excerpt from this section"
relevance_score = 0.9

[[relevant_information]]
heading = "Another Section"
content = "Another key excerpt"
relevance_score = 0.8

[[clarity_improvements]]
original = "unclear text from source"
improved = "clearer rewrite of the text"

instructions:
  - Extract 5-15 meaningful tags that categorize the content
  - Identify key concepts and terminology
  - Pull out the most relevant information sections
  - Suggest clarity improvements for unclear passages
  - Rate your confidence in the analysis (0-1)
  - Set needs_refinement = true if confidence < 0.7

CRITICAL: Output ONLY valid TOML. No markdown blocks, no explanations.`;

    const userPrompt = `Analyze this research content:

${existingMetadata.title ? `Title: ${existingMetadata.title}` : ''}
${existingMetadata.url ? `Source: ${existingMetadata.url}` : ''}

Content:
${content.slice(0, this.maxContentLength)}`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        parameters: { temperature: 0.3, maxTokens: 4096 }
      });

      // Parse TOML response
      return this._parseTomlResponse(response.content);
    } catch (err) {
      console.error('LLM analysis failed:', err.message);
      return this._basicAnalysis(content, existingMetadata);
    }
  }

  /**
   * Parse a TOML value
   * @param {string} value
   * @returns {*}
   * @private
   */
  _parseTomlValue(value) {
    // String (double or single quoted)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }

    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Array
    if (value.startsWith('[')) {
      try {
        const inner = value.slice(1, -1).trim();
        if (!inner) return [];

        // Split by comma, respecting quotes
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

    // Number
    if (/^-?\d*\.?\d+$/.test(value)) {
      return parseFloat(value);
    }

    return value;
  }

  /**
   * Parse TOML response from LLM
   * Handles partial/truncated TOML gracefully
   * @param {string} tomlStr
   * @returns {Object}
   * @private
   */
  _parseTomlResponse(tomlStr) {
    // Clean up potential markdown artifacts
    let clean = tomlStr
      .replace(/^```toml?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    const result = {
      title: '',
      summary: '',
      tags: [],
      key_concepts: [],
      relevant_information: [],
      clarity_improvements: [],
      confidence_score: 0.5,
      needs_refinement: true
    };

    let currentArraySection = null;
    let currentArrayItem = null;

    const lines = clean.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Array of tables: [[section]]
      const arrayMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/);
      if (arrayMatch) {
        // Save previous array item
        if (currentArrayItem && currentArraySection) {
          if (!result[currentArraySection]) result[currentArraySection] = [];
          result[currentArraySection].push(currentArrayItem);
        }
        currentArraySection = arrayMatch[1].trim();
        currentArrayItem = {};
        continue;
      }

      // Regular section (skip for now, we handle flat structure)
      if (trimmed.match(/^\[[^\]]+\]$/)) {
        // Save previous array item
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
        const value = kvMatch[2].trim();
        const parsedValue = this._parseTomlValue(value);

        // Store in appropriate place
        if (currentArrayItem) {
          currentArrayItem[key] = parsedValue;
        } else if (result.hasOwnProperty(key)) {
          result[key] = parsedValue;
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
   * Basic analysis without LLM
   * @param {string} content
   * @param {Object} existingMetadata
   * @returns {Object}
   * @private
   */
  _basicAnalysis(content, existingMetadata) {
    // Extract headings as tags
    const headings = content.match(/^#{1,3}\s+(.+)$/gm) || [];
    const tags = headings.map(h => h.replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-'));

    // Extract code blocks as relevant info
    const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
    const relevantInfo = codeBlocks.slice(0, 5).map((block, i) => ({
      heading: `Code Example ${i + 1}`,
      content: block.slice(0, 500),
      relevance_score: 0.6
    }));

    // Word frequency for concepts
    const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const concepts = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    return {
      title: existingMetadata.pageTitle || existingMetadata.title || 'Untitled Research',
      summary: content.slice(0, 200).replace(/\n/g, ' ') + '...',
      tags: [...new Set(tags)].slice(0, 15),
      key_concepts: concepts,
      relevant_information: relevantInfo,
      clarity_improvements: [],
      confidence_score: 0.5,
      needs_refinement: false
    };
  }

  /**
   * Write analysis to TOML artifact
   * @param {string} artifactsDir
   * @param {string} sourceName
   * @param {Object} analysis
   * @returns {Promise<string>}
   * @private
   */
  async _writeAnalysisToml(artifactsDir, sourceName, analysis) {
    const filename = `${sourceName}_analysis.toml`;
    const filepath = join(artifactsDir, filename);

    const tomlContent = this._objectToToml(analysis);
    await writeFile(filepath, tomlContent, 'utf-8');

    return filepath;
  }

  /**
   * Escape a string for TOML
   * @param {string} str
   * @returns {string}
   * @private
   */
  _escapeTomlString(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Convert object to TOML string
   * @param {Object} obj
   * @returns {string}
   * @private
   */
  _objectToToml(obj) {
    const lines = ['# Research Analysis Output'];
    const sections = [];
    const arrayTables = [];

    // First pass: collect top-level values, sections, and array tables
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        continue; // Skip null values in TOML
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${key} = []`);
        } else if (typeof value[0] === 'object') {
          // Array of tables
          arrayTables.push({ key, items: value });
        } else {
          // Simple array
          const items = value.map(v => `"${this._escapeTomlString(String(v))}"`);
          lines.push(`${key} = [${items.join(', ')}]`);
        }
      } else if (typeof value === 'object') {
        sections.push({ key, obj: value });
      } else if (typeof value === 'string') {
        lines.push(`${key} = "${this._escapeTomlString(value)}"`);
      } else if (typeof value === 'boolean') {
        lines.push(`${key} = ${value}`);
      } else {
        lines.push(`${key} = ${value}`);
      }
    }

    // Add sections
    for (const { key, obj: sectionObj } of sections) {
      lines.push('');
      lines.push(`[${key}]`);
      for (const [k, v] of Object.entries(sectionObj)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'string') {
          lines.push(`${k} = "${this._escapeTomlString(v)}"`);
        } else if (typeof v === 'boolean') {
          lines.push(`${k} = ${v}`);
        } else if (Array.isArray(v)) {
          const items = v.map(item => `"${this._escapeTomlString(String(item))}"`);
          lines.push(`${k} = [${items.join(', ')}]`);
        } else {
          lines.push(`${k} = ${v}`);
        }
      }
    }

    // Add array of tables
    for (const { key, items } of arrayTables) {
      for (const item of items) {
        lines.push('');
        lines.push(`[[${key}]]`);
        for (const [k, v] of Object.entries(item)) {
          if (v === null || v === undefined) continue;
          if (typeof v === 'string') {
            lines.push(`${k} = "${this._escapeTomlString(v)}"`);
          } else if (typeof v === 'boolean') {
            lines.push(`${k} = ${v}`);
          } else if (Array.isArray(v)) {
            const items = v.map(i => `"${this._escapeTomlString(String(i))}"`);
            lines.push(`${k} = [${items.join(', ')}]`);
          } else {
            lines.push(`${k} = ${v}`);
          }
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Write raw research clone
   * @param {string} artifactsDir
   * @param {Object[]} researchItems
   * @returns {Promise<string>}
   * @private
   */
  async _writeRawResearch(artifactsDir, researchItems) {
    const filepath = join(artifactsDir, 'raw_research.md');

    const content = researchItems.map(item => {
      return `# ${item.metadata.pageTitle || item.path}\n\n` +
             `> Source: ${item.metadata.sourceUrl || 'unknown'}\n` +
             `> Fetched: ${item.metadata.fetchedAt || 'unknown'}\n\n` +
             item.content + '\n\n---\n';
    }).join('\n');

    await writeFile(filepath, content, 'utf-8');
    return filepath;
  }

  /**
   * Main entry point - analyze research content
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async handle(args, session) {
    const {
      sessionId,
      source_path,        // Optional: specific research file to analyze
      max_iterations,     // Override max iterations
      include_raw = true  // Include raw_research.md clone
    } = args;

    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    // Get session to find sandbox path
    const sessionData = this.sessionManager.getSession(sessionId);
    if (!sessionData) {
      return this.formatError(`Session not found: ${sessionId}`);
    }

    const sandboxPath = sessionData.sandboxPath || join('./sandbox', sessionId);
    const artifactsDir = await this._ensureArtifactsDir(sandboxPath);

    // Get research content
    const researchItems = await this._getResearchContent(sessionId, source_path);
    if (researchItems.length === 0) {
      return this.formatError('No research content found in session context');
    }

    const maxIter = max_iterations || this.maxIterations;
    const results = [];

    // Analyze each research item
    for (const item of researchItems) {
      const { frontmatter, body } = this._extractFrontmatter(item.content);

      let analysis = null;
      let iteration = 0;

      // Iterative refinement loop
      while (iteration < maxIter) {
        iteration++;
        analysis = await this._analyzeWithLLM(body, { ...frontmatter, ...item.metadata }, iteration);

        // Check if refinement needed
        if (!analysis.needs_refinement || analysis.confidence_score >= this.confidenceThreshold) {
          break;
        }
      }

      // Add source metadata
      analysis.source = {
        path: item.path,
        url: item.metadata.sourceUrl || frontmatter.url,
        fetched_at: item.metadata.fetchedAt || frontmatter.fetched_at,
        analyzed_at: new Date().toISOString(),
        iterations: iteration
      };

      // Generate source name for file
      const sourceName = basename(item.path, extname(item.path))
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .slice(0, 50);

      // Write analysis TOML
      const tomlPath = await this._writeAnalysisToml(artifactsDir, sourceName, analysis);

      results.push({
        source: item.path,
        analysis_file: `artifacts/${sourceName}_analysis.toml`,
        absolute_path: tomlPath,
        iterations: iteration,
        confidence: analysis.confidence_score,
        tags_count: analysis.tags.length,
        concepts_count: analysis.key_concepts.length
      });
    }

    // Write raw research clone
    let rawResearchPath = null;
    if (include_raw) {
      rawResearchPath = await this._writeRawResearch(artifactsDir, researchItems);
    }

    return this.formatResponse({
      success: true,
      analyzed_count: results.length,
      results,
      raw_research_path: rawResearchPath ? 'artifacts/raw_research.md' : null,
      artifacts_directory: 'artifacts/',
      message: `Analyzed ${results.length} research item(s)`
    });
  }

  /**
   * Format success response
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
    };
  }

  /**
   * Format error response
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'analyze_research',
      this.handle.bind(this),
      {
        name: 'analyze_research',
        description: `Analyze research content from context_research_browser tool with iterative LLM-powered refinement.

USE CASES:
- Extract structured metadata from research documents
- Generate tags and categorization for research content
- Identify key concepts and relevant information
- Improve clarity of research excerpts
- Create analysis artifacts for toolchain context

WORKFLOW:
1. Retrieves research content from session context
2. Iteratively analyzes with LLM (up to max_iterations)
3. Extracts tags, concepts, and relevant sections
4. Generates TOML analysis file per research item
5. Creates raw_research.md clone for debugging

OUTPUT ARTIFACTS:
- {source}_analysis.toml - Structured TOML with:
  - title, summary, tags, key_concepts
  - relevant_information (scored excerpts)
  - clarity_improvements (suggested rewrites)
  - confidence_score, source metadata
- raw_research.md - Combined raw content for debug/context

ANALYSIS FIELDS:
- tags: Topic categorization (5-15 tags)
- key_concepts: Main terminology and concepts
- relevant_information: Scored content excerpts
- clarity_improvements: Suggested rewrites
- confidence_score: Analysis confidence (0-1)`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            },
            source_path: {
              type: 'string',
              description: 'Specific research file path to analyze (optional, analyzes all if omitted)'
            },
            max_iterations: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              default: 3,
              description: 'Maximum refinement iterations per item'
            },
            include_raw: {
              type: 'boolean',
              default: true,
              description: 'Include raw_research.md clone in artifacts'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Create AnalyzeResearchTool instance
 * @param {import('./session-manager.js').SessionManager} sessionManager
 * @param {Object} [config]
 * @returns {AnalyzeResearchTool}
 */
export function createAnalyzeResearchTool(sessionManager, config) {
  return new AnalyzeResearchTool(sessionManager, config);
}

export default AnalyzeResearchTool;
