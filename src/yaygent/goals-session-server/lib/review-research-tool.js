/**
 * @fileoverview Review Research Tool
 * @module review-research-tool
 *
 * Reviews and scores research content against the original intent from
 * context_research_browser tool. Validates relevancy and quality, then
 * exports to research_review artifact.
 *
 * Supports:
 * - Evaluation model override (separate provider/model for review)
 * - Default provider fallback
 * - Relevancy scoring with breakdown
 * - Context window refinement recommendations
 */

import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, extname } from 'path';

/**
 * Default review configuration
 */
const DEFAULT_CONFIG = {
  minRelevancyScore: 0.6,
  includeRecommendations: true
};

/**
 * Review criteria weights
 */
const CRITERIA_WEIGHTS = {
  topicRelevance: 0.30,
  informationQuality: 0.25,
  sourceCredibility: 0.15,
  contentClarity: 0.15,
  contextFit: 0.15
};

/**
 * Review Research Tool
 * Reviews all context research against intent and scores relevancy
 */
export class ReviewResearchTool {
  /**
   * @param {import('./session-manager.js').SessionManager} sessionManager
   * @param {Object} [config]
   * @param {import('./llm-client.js').LLMClient} [config.llmClient] - Default LLM client
   * @param {import('./llm-client.js').LLMClient} [config.evaluationClient] - Override for evaluation
   * @param {number} [config.minRelevancyScore]
   */
  constructor(sessionManager, config = {}) {
    if (!sessionManager) {
      throw new Error('SessionManager is required for ReviewResearchTool');
    }

    /** @type {import('./session-manager.js').SessionManager} */
    this.sessionManager = sessionManager;

    /** @type {import('./llm-client.js').LLMClient|null} */
    this.llmClient = config.llmClient || null;

    /** @type {import('./llm-client.js').LLMClient|null} */
    this.evaluationClient = config.evaluationClient || null;

    /** @type {number} */
    this.minRelevancyScore = config.minRelevancyScore || DEFAULT_CONFIG.minRelevancyScore;

    /** @type {boolean} */
    this.includeRecommendations = config.includeRecommendations !== false;
  }

  /**
   * Get the LLM client to use for evaluation
   * @returns {import('./llm-client.js').LLMClient|null}
   * @private
   */
  _getEvaluationClient() {
    return this.evaluationClient || this.llmClient;
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
   * Get research content and analysis from session
   * @param {string} sessionId
   * @returns {Promise<Object>}
   * @private
   */
  async _getResearchData(sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session || !session.context || !session.context.files) {
      return { research: [], analyses: [] };
    }

    const research = [];
    const analyses = [];

    for (const file of session.context.files) {
      if (file.metadata?.tool === 'context_research_browser' ||
          (file.path.startsWith('context/') && file.path.endsWith('.md'))) {
        research.push({
          path: file.path,
          content: file.content,
          metadata: file.metadata || {}
        });
      }
    }

    // Also check for analysis files in artifacts
    const sandboxPath = session.sandboxPath || join('./sandbox', sessionId);
    const artifactsDir = join(sandboxPath, 'artifacts');

    if (existsSync(artifactsDir)) {
      try {
        const { readdir } = await import('fs/promises');
        const files = await readdir(artifactsDir);

        for (const file of files) {
          if (file.endsWith('_analysis.toml')) {
            const content = await readFile(join(artifactsDir, file), 'utf-8');
            analyses.push({
              path: `artifacts/${file}`,
              content,
              parsed: this._parseYaml(content)
            });
          }
        }
      } catch (err) {
        // Artifacts dir may not have analyses yet
      }
    }

    return { research, analyses };
  }

  /**
   * Simple TOML parser for analysis files
   * @param {string} yamlStr
   * @returns {Object}
   * @private
   */
  _parseYaml(yamlStr) {
    const result = {};
    const lines = yamlStr.split('\n');
    let currentKey = null;
    let currentList = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
        if (currentList && result[currentList]) {
          result[currentList].push(value);
        }
        continue;
      }

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();

        if (value === '' || value === '[]') {
          result[key] = [];
          currentList = key;
        } else {
          value = value.replace(/^["']|["']$/g, '');
          if (!isNaN(parseFloat(value)) && value.match(/^-?\d*\.?\d+$/)) {
            result[key] = parseFloat(value);
          } else if (value === 'true') {
            result[key] = true;
          } else if (value === 'false') {
            result[key] = false;
          } else {
            result[key] = value;
          }
          currentList = null;
        }
      }
    }

    return result;
  }

  /**
   * Review research with LLM
   * @param {Object[]} research
   * @param {Object[]} analyses
   * @param {string} intent
   * @returns {Promise<Object>}
   * @private
   */
  async _reviewWithLLM(research, analyses, intent) {
    const client = this._getEvaluationClient();

    if (!client) {
      return this._basicReview(research, analyses, intent);
    }

    const systemPrompt = `task:
  role: Research Quality Reviewer
  objective: Evaluate research content against stated intent/objectives

evaluation_criteria:
  topic_relevance: weight 0.30 - How well content matches research intent
  information_quality: weight 0.25 - Accuracy, depth, usefulness
  source_credibility: weight 0.15 - Authority and trustworthiness
  content_clarity: weight 0.15 - How clear and well-organized
  context_fit: weight 0.15 - How well it fits broader context

output_format: TOML (resilient to truncation)

TOML_TEMPLATE:
# Research Review Output
overall_score = 0.85
verdict = "good"
summary = "Brief 2-3 sentence assessment"

[criteria_scores]
topic_relevance = 0.90
information_quality = 0.85
source_credibility = 0.75
content_clarity = 0.80
context_fit = 0.80

[context_efficiency]
total_tokens_estimate = 5000
recommended_tokens = 4000
reduction_possible = 0.20

[[item_reviews]]
source = "context/file1.md"
score = 0.85
keep = true
strengths = ["strength1", "strength2"]
weaknesses = ["weakness1"]

[[item_reviews]]
source = "context/file2.md"
score = 0.70
keep = true
strengths = ["strength1"]
weaknesses = ["weakness1", "weakness2"]

[recommendations]
keep = ["context/file1.md", "context/file2.md"]
remove = []

CRITICAL: Output ONLY valid TOML. No markdown blocks, no explanations.`;

    // Build content summary for review
    const contentSummary = research.map((r, i) => {
      const analysis = analyses.find(a => a.path.includes(basename(r.path, '.md')));
      return `## Research Item ${i + 1}: ${r.path}
Source: ${r.metadata?.sourceUrl || 'unknown'}
Title: ${r.metadata?.pageTitle || 'untitled'}
${analysis?.parsed?.summary ? `Summary: ${analysis.parsed.summary}` : ''}
${analysis?.parsed?.tags?.length ? `Tags: ${analysis.parsed.tags.join(', ')}` : ''}

Content Preview:
${r.content.slice(0, 2000)}...
`;
    }).join('\n---\n');

    const userPrompt = `Research Intent/Objective:
${intent || 'General research gathering - evaluate for overall quality and relevance'}

Research Content to Review:
${contentSummary}

Evaluate all research items against the stated intent. Score each item and provide overall assessment.`;

    try {
      const response = await client.send({
        systemPrompt,
        userPrompt,
        parameters: { temperature: 0.2, maxTokens: 4096 }
      });

      return this._parseReviewResponse(response.content);
    } catch (err) {
      console.error('LLM review failed:', err.message);
      return this._basicReview(research, analyses, intent);
    }
  }

  /**
   * Parse TOML string into object
   * Handles partial/truncated TOML gracefully
   * @param {string} tomlStr
   * @returns {Object}
   * @private
   */
  _parseToml(tomlStr) {
    const result = {};
    let currentSection = null;
    let currentArraySection = null;
    let currentArrayItem = null;

    const lines = tomlStr.split('\n');

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
        currentSection = null;
        continue;
      }

      // Regular section: [section]
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        // Save previous array item
        if (currentArrayItem && currentArraySection) {
          if (!result[currentArraySection]) result[currentArraySection] = [];
          result[currentArraySection].push(currentArrayItem);
          currentArrayItem = null;
          currentArraySection = null;
        }
        currentSection = sectionMatch[1].trim();
        if (!result[currentSection]) result[currentSection] = {};
        continue;
      }

      // Key-value pair
      const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        let value = kvMatch[2].trim();

        // Parse value
        const parsedValue = this._parseTomlValue(value);

        // Store in appropriate place
        if (currentArrayItem) {
          currentArrayItem[key] = parsedValue;
        } else if (currentSection) {
          result[currentSection][key] = parsedValue;
        } else {
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
      // Handle array - try to parse
      try {
        // Simple array parsing
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

    // Return as string
    return value;
  }

  /**
   * Parse LLM review response (TOML format)
   * @param {string} tomlStr
   * @returns {Object}
   * @private
   */
  _parseReviewResponse(tomlStr) {
    // Clean markdown artifacts
    let clean = tomlStr
      .replace(/^```toml?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();

    const result = {
      overall_score: 0.5,
      verdict: 'acceptable',
      criteria_scores: {
        topic_relevance: 0.5,
        information_quality: 0.5,
        source_credibility: 0.5,
        content_clarity: 0.5,
        context_fit: 0.5
      },
      item_reviews: [],
      recommendations: {
        keep: [],
        remove: [],
        refine: []
      },
      summary: '',
      context_efficiency: {
        total_tokens_estimate: 0,
        recommended_tokens: 0,
        reduction_possible: 0
      }
    };

    // Parse the TOML response
    const parsed = this._parseToml(clean);

    // Map top-level values
    if (parsed.overall_score !== undefined) result.overall_score = parsed.overall_score;
    if (parsed.verdict) result.verdict = parsed.verdict;
    if (parsed.summary) result.summary = parsed.summary;

    // Map criteria_scores section
    if (parsed.criteria_scores) {
      Object.assign(result.criteria_scores, parsed.criteria_scores);
    }

    // Map context_efficiency section
    if (parsed.context_efficiency) {
      Object.assign(result.context_efficiency, parsed.context_efficiency);
    }

    // Map item_reviews array
    if (parsed.item_reviews && Array.isArray(parsed.item_reviews)) {
      result.item_reviews = parsed.item_reviews;
    }

    // Map recommendations section
    if (parsed.recommendations) {
      if (parsed.recommendations.keep) result.recommendations.keep = parsed.recommendations.keep;
      if (parsed.recommendations.remove) result.recommendations.remove = parsed.recommendations.remove;
      if (parsed.recommendations.refine) result.recommendations.refine = parsed.recommendations.refine;
    }

    return result;
  }

  /**
   * Basic review without LLM
   * @param {Object[]} research
   * @param {Object[]} analyses
   * @param {string} intent
   * @returns {Object}
   * @private
   */
  _basicReview(research, analyses, intent) {
    const itemReviews = research.map(r => {
      const analysis = analyses.find(a =>
        a.path.includes(basename(r.path, '.md'))
      );

      // Basic scoring based on content length and structure
      const contentLength = r.content.length;
      const hasHeadings = (r.content.match(/^#+\s/gm) || []).length;
      const hasCode = (r.content.match(/```/g) || []).length / 2;
      const hasLinks = (r.content.match(/\[.*?\]\(.*?\)/g) || []).length;

      const score = Math.min(1, (
        (contentLength > 1000 ? 0.3 : contentLength / 3333) +
        (hasHeadings > 3 ? 0.2 : hasHeadings * 0.067) +
        (hasCode > 0 ? 0.2 : 0) +
        (hasLinks > 2 ? 0.15 : hasLinks * 0.075) +
        (analysis?.parsed?.confidence_score || 0.15)
      ));

      return {
        source: r.path,
        score,
        strengths: [
          contentLength > 2000 ? 'Substantial content' : null,
          hasHeadings > 3 ? 'Well-structured with headings' : null,
          hasCode > 0 ? 'Includes code examples' : null,
          hasLinks > 2 ? 'Good references' : null
        ].filter(Boolean),
        weaknesses: [
          contentLength < 500 ? 'Limited content' : null,
          hasHeadings < 2 ? 'Lacks structure' : null,
          !analysis ? 'Not analyzed' : null
        ].filter(Boolean),
        keep: score >= this.minRelevancyScore
      };
    });

    const avgScore = itemReviews.reduce((sum, r) => sum + r.score, 0) / itemReviews.length || 0.5;

    const verdict =
      avgScore >= 0.8 ? 'excellent' :
      avgScore >= 0.7 ? 'good' :
      avgScore >= 0.6 ? 'acceptable' :
      avgScore >= 0.4 ? 'needs_improvement' : 'poor';

    return {
      overall_score: avgScore,
      verdict,
      criteria_scores: {
        topic_relevance: avgScore,
        information_quality: avgScore,
        source_credibility: 0.5,
        content_clarity: avgScore,
        context_fit: avgScore
      },
      item_reviews: itemReviews,
      recommendations: {
        keep: itemReviews.filter(r => r.keep).map(r => r.source),
        remove: itemReviews.filter(r => !r.keep).map(r => r.source),
        refine: []
      },
      summary: `Reviewed ${research.length} research items. Average score: ${(avgScore * 100).toFixed(1)}%. ${itemReviews.filter(r => r.keep).length} items recommended for retention.`,
      context_efficiency: {
        total_tokens_estimate: Math.ceil(research.reduce((sum, r) => sum + r.content.length, 0) / 4),
        recommended_tokens: Math.ceil(
          research
            .filter((_, i) => itemReviews[i].keep)
            .reduce((sum, r) => sum + r.content.length, 0) / 4
        ),
        reduction_possible: 1 - (itemReviews.filter(r => r.keep).length / itemReviews.length)
      }
    };
  }

  /**
   * Write review to TOML artifact
   * @param {string} artifactsDir
   * @param {Object} review
   * @returns {Promise<string>}
   * @private
   */
  async _writeReviewArtifact(artifactsDir, review) {
    const filepath = join(artifactsDir, 'research_review.toml');

    const tomlContent = this._objectToToml({
      review_metadata: {
        generated_at: new Date().toISOString(),
        tool: 'review_research',
        version: '1.0'
      },
      ...review
    });

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
    const lines = ['# Research Review Output'];
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
   * Main entry point - review research content
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async handle(args, session) {
    const {
      sessionId,
      intent,              // Original research intent/objective
      min_score,           // Override minimum relevancy score
      include_item_reviews = true  // Include per-item reviews
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

    // Get research data
    const { research, analyses } = await this._getResearchData(sessionId);

    if (research.length === 0) {
      return this.formatError('No research content found to review');
    }

    // Set minimum score
    const minScore = min_score !== undefined ? min_score : this.minRelevancyScore;

    // Perform review
    const review = await this._reviewWithLLM(research, analyses, intent || '');

    // Write review artifact
    const reviewPath = await this._writeReviewArtifact(artifactsDir, review);

    // Build response
    const response = {
      success: true,
      overall_score: review.overall_score,
      verdict: review.verdict,
      criteria_scores: review.criteria_scores,
      summary: review.summary,
      recommendations: {
        keep_count: review.recommendations.keep.length,
        remove_count: review.recommendations.remove.length,
        refine_count: review.recommendations.refine.length,
        keep: review.recommendations.keep,
        remove: review.recommendations.remove
      },
      context_efficiency: review.context_efficiency,
      review_artifact: 'artifacts/research_review.toml',
      absolute_path: reviewPath
    };

    if (include_item_reviews) {
      response.item_reviews = review.item_reviews;
    }

    return this.formatResponse(response);
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
      'review_research',
      this.handle.bind(this),
      {
        name: 'review_research',
        description: `Review and score all research content against original intent from context_research_browser.

USE CASES:
- Validate research relevancy before context inclusion
- Score research quality and credibility
- Get recommendations for context window optimization
- Identify research items to keep, remove, or refine

WORKFLOW:
1. Retrieves all research from session context
2. Loads any existing analysis artifacts
3. Evaluates against stated intent/objective
4. Scores using weighted criteria:
   - Topic Relevance (30%)
   - Information Quality (25%)
   - Source Credibility (15%)
   - Content Clarity (15%)
   - Context Fit (15%)
5. Generates recommendations
6. Exports research_review.toml artifact

EVALUATION MODEL:
- Uses evaluation_client if configured (separate provider/model)
- Falls back to default llmClient
- Works without LLM (basic heuristic scoring)

OUTPUT:
- overall_score: 0-1 weighted average
- verdict: excellent/good/acceptable/needs_improvement/poor
- criteria_scores: breakdown by criterion
- item_reviews: per-item scores and feedback
- recommendations: keep/remove/refine lists
- context_efficiency: token estimates and reduction potential

ARTIFACT:
- artifacts/research_review.toml - Complete review with all scores and recommendations`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            },
            intent: {
              type: 'string',
              description: 'Original research intent/objective to evaluate against'
            },
            min_score: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              default: 0.6,
              description: 'Minimum relevancy score to recommend keeping (0-1)'
            },
            include_item_reviews: {
              type: 'boolean',
              default: true,
              description: 'Include per-item review details in response'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Create ReviewResearchTool instance
 * @param {import('./session-manager.js').SessionManager} sessionManager
 * @param {Object} [config]
 * @returns {ReviewResearchTool}
 */
export function createReviewResearchTool(sessionManager, config) {
  return new ReviewResearchTool(sessionManager, config);
}

export default ReviewResearchTool;
