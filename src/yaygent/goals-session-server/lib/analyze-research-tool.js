/**
 * @fileoverview Analyze Research Tool
 * @module analyze-research-tool
 *
 * Analyzes context from context_research_browser tool with iterative refinement.
 * Creates YAML metadata files and raw research clones for debugging/context.
 *
 * Output artifacts:
 * - {source}_analysis.yml - Structured metadata with tags, relevance, summaries
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

output_format:
  type: yaml_object
  structure:
    title: string
    summary: string (2-3 sentences)
    tags: list of relevant topic tags (5-15 tags)
    key_concepts: list of main concepts/terms
    relevant_information:
      - heading: string
        content: string (refined/clarified excerpt)
        relevance_score: float (0-1)
    clarity_improvements:
      - original: string
        improved: string
    confidence_score: float (0-1)
    needs_refinement: boolean

instructions:
  - Extract meaningful tags that categorize the content
  - Identify key concepts and terminology
  - Pull out the most relevant information sections
  - Suggest clarity improvements for unclear passages
  - Rate your confidence in the analysis
  - Set needs_refinement=true if confidence < 0.7

CRITICAL: Output ONLY valid YAML. No markdown, no explanations.`;

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

      // Parse YAML response
      return this._parseYamlResponse(response.content);
    } catch (err) {
      console.error('LLM analysis failed:', err.message);
      return this._basicAnalysis(content, existingMetadata);
    }
  }

  /**
   * Parse YAML response from LLM
   * @param {string} yamlStr
   * @returns {Object}
   * @private
   */
  _parseYamlResponse(yamlStr) {
    // Clean up potential markdown artifacts
    let clean = yamlStr
      .replace(/^```ya?ml?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    // Simple YAML-like parsing
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

    const lines = clean.split('\n');
    let currentKey = null;
    let currentList = null;
    let currentObject = null;
    let indent = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for list item
      if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2).trim();
        if (currentList && Array.isArray(result[currentList])) {
          if (value.includes(':')) {
            // Start of object in list
            const colonIdx = value.indexOf(':');
            const key = value.slice(0, colonIdx).trim();
            const val = value.slice(colonIdx + 1).trim();
            currentObject = { [key]: val.replace(/^["']|["']$/g, '') };
          } else {
            result[currentList].push(value.replace(/^["']|["']$/g, ''));
          }
        }
        continue;
      }

      // Check for key-value
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();

        // Handle indented object properties
        if (currentObject && line.startsWith('    ')) {
          currentObject[key] = value.replace(/^["']|["']$/g, '');
          continue;
        }

        // Complete previous object
        if (currentObject && currentList) {
          result[currentList].push(currentObject);
          currentObject = null;
        }

        // Map keys to result
        const keyMap = {
          'title': 'title',
          'summary': 'summary',
          'tags': 'tags',
          'key_concepts': 'key_concepts',
          'relevant_information': 'relevant_information',
          'clarity_improvements': 'clarity_improvements',
          'confidence_score': 'confidence_score',
          'needs_refinement': 'needs_refinement'
        };

        if (keyMap[key]) {
          if (value === '' || value === '[]') {
            currentList = keyMap[key];
            currentKey = keyMap[key];
          } else {
            // Direct value
            if (key === 'confidence_score') {
              result[keyMap[key]] = parseFloat(value) || 0.5;
            } else if (key === 'needs_refinement') {
              result[keyMap[key]] = value.toLowerCase() === 'true';
            } else {
              result[keyMap[key]] = value.replace(/^["']|["']$/g, '');
            }
            currentList = null;
          }
        }
      }
    }

    // Complete final object
    if (currentObject && currentList) {
      result[currentList].push(currentObject);
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
   * Write analysis to YAML artifact
   * @param {string} artifactsDir
   * @param {string} sourceName
   * @param {Object} analysis
   * @returns {Promise<string>}
   * @private
   */
  async _writeAnalysisYaml(artifactsDir, sourceName, analysis) {
    const filename = `${sourceName}_analysis.yml`;
    const filepath = join(artifactsDir, filename);

    const yamlContent = this._objectToYaml(analysis);
    await writeFile(filepath, yamlContent, 'utf-8');

    return filepath;
  }

  /**
   * Convert object to YAML string
   * @param {Object} obj
   * @param {number} indent
   * @returns {string}
   * @private
   */
  _objectToYaml(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    const lines = [];

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        lines.push(`${spaces}${key}: null`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${spaces}${key}: []`);
        } else {
          lines.push(`${spaces}${key}:`);
          for (const item of value) {
            if (typeof item === 'object') {
              lines.push(`${spaces}  -`);
              const nested = this._objectToYaml(item, indent + 2);
              lines.push(nested);
            } else {
              lines.push(`${spaces}  - "${String(item).replace(/"/g, '\\"')}"`);
            }
          }
        }
      } else if (typeof value === 'object') {
        lines.push(`${spaces}${key}:`);
        lines.push(this._objectToYaml(value, indent + 1));
      } else if (typeof value === 'string') {
        // Handle multi-line strings
        if (value.includes('\n')) {
          lines.push(`${spaces}${key}: |`);
          for (const line of value.split('\n')) {
            lines.push(`${spaces}  ${line}`);
          }
        } else {
          lines.push(`${spaces}${key}: "${value.replace(/"/g, '\\"')}"`);
        }
      } else {
        lines.push(`${spaces}${key}: ${value}`);
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

      // Write analysis YAML
      const yamlPath = await this._writeAnalysisYaml(artifactsDir, sourceName, analysis);

      results.push({
        source: item.path,
        analysis_file: `artifacts/${sourceName}_analysis.yml`,
        absolute_path: yamlPath,
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
4. Generates YAML analysis file per research item
5. Creates raw_research.md clone for debugging

OUTPUT ARTIFACTS:
- {source}_analysis.yml - Structured YAML with:
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
