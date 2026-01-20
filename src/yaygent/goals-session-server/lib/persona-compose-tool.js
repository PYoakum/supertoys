/**
 * @fileoverview Persona Compose Tool for LLM-guided letter composition
 * @module persona-compose-tool
 *
 * Generates personalized written content using persona definitions from YAML files.
 * Supports multiple operations: compose, preview, list_personas, get_persona, validate_personas
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Simple YAML parser for safe loading (no code execution)
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Error codes for persona compose operations
 */
const ErrorCodes = {
  PERSONA_NOT_FOUND: 'PERSONA_NOT_FOUND',
  PERSONAS_FILE_NOT_FOUND: 'PERSONAS_FILE_NOT_FOUND',
  PERSONAS_INVALID_YAML: 'PERSONAS_INVALID_YAML',
  PERSONAS_SCHEMA_ERROR: 'PERSONAS_SCHEMA_ERROR',
  PROMPT_INCOMPLETE: 'PROMPT_INCOMPLETE',
  OUTPUT_PATH_INVALID: 'OUTPUT_PATH_INVALID',
  LLM_GENERATION_FAILED: 'LLM_GENERATION_FAILED',
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  CONTENT_TOO_LONG: 'CONTENT_TOO_LONG',
  CONTENT_TOO_SHORT: 'CONTENT_TOO_SHORT',
  PATH_TRAVERSAL: 'PATH_TRAVERSAL',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED'
};

/**
 * Output templates for different content types
 */
const OutputTemplates = {
  letter: {
    format: (content, metadata) => {
      const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      return `${date}\n\n${content}\n`;
    }
  },
  email: {
    format: (content, metadata) => {
      const { subject, recipient } = metadata;
      return `Subject: ${subject}\nTo: ${recipient.name}\n\n${content}`;
    }
  },
  memo: {
    format: (content, metadata) => {
      const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const { subject, recipient } = metadata;
      return `MEMORANDUM\n\nTO: ${recipient.name}\nDATE: ${date}\nRE: ${subject}\n\n${content}`;
    }
  },
  note: {
    format: (content, metadata) => content
  },
  raw: {
    format: (content, metadata) => content
  }
};

/**
 * Persona Compose Tool class
 */
export class PersonaComposeTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {import('./llm-client.js').LLMClient} llmClient
   * @param {Object} [config]
   */
  constructor(sandboxManager, llmClient, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for PersonaComposeTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {import('./llm-client.js').LLMClient} */
    this.llmClient = llmClient;

    /** @type {Object} Configuration */
    this.config = {
      defaultPersonasFile: 'PERSONAS.yml',
      maxPersonasFileSize: 1048576, // 1MB
      maxOutputSize: 102400, // 100KB
      defaultOutputFormat: 'text',
      defaultTemplate: 'letter',
      llm: {
        defaultTemperature: 0.7,
        defaultMaxTokens: 1024,
        timeout: 60000
      },
      ...config
    };

    /** @type {Map<string, {data: Object, timestamp: number}>} Persona cache */
    this.personaCache = new Map();

    /** @type {number} Cache TTL in ms (1 hour) */
    this.cacheTTL = 3600000;
  }

  /**
   * Main entry point - execute an operation
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const { operation = 'compose' } = args;

    switch (operation) {
      case 'compose':
        return this.compose(args);
      case 'preview':
        return this.preview(args);
      case 'list_personas':
        return this.listPersonas(args);
      case 'get_persona':
        return this.getPersona(args);
      case 'validate_personas':
        return this.validatePersonas(args);
      default:
        return this.formatError('INVALID_OPERATION', `Unknown operation: ${operation}`);
    }
  }

  /**
   * Compose content using a persona and save to file
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async compose(args) {
    const {
      sessionId,
      personaName,
      personasFile = this.config.defaultPersonasFile,
      prompt,
      output = {},
      llmOptions = {}
    } = args;

    // Validate required fields
    if (!personaName) {
      return this.formatError(ErrorCodes.PROMPT_INCOMPLETE, 'personaName is required');
    }
    if (!prompt || !prompt.subject || !prompt.recipient?.name || !prompt.purpose) {
      return this.formatError(ErrorCodes.PROMPT_INCOMPLETE,
        'prompt must include subject, recipient.name, and purpose');
    }

    try {
      // Load persona
      const personas = await this.loadPersonasFile(sessionId, personasFile);
      const persona = this.findPersona(personas, personaName);
      if (!persona) {
        return this.formatError(ErrorCodes.PERSONA_NOT_FOUND,
          `Persona '${personaName}' not found`, {
            requestedPersona: personaName,
            availablePersonas: personas.personas.map(p => p.name),
            personasFile
          });
      }

      // Generate content
      const systemPrompt = this.buildSystemPrompt(persona, prompt);
      const userPrompt = this.buildUserPrompt(prompt);

      const startTime = Date.now();
      const llmResponse = await this.callLLM(systemPrompt, userPrompt, llmOptions, sessionId);
      const duration = Date.now() - startTime;

      let content = llmResponse.content;

      // Validate content length
      const constraints = prompt.constraints || {};
      const minLength = constraints.minLength || 100;
      const maxLength = constraints.maxLength || 1000;

      if (content.length < minLength) {
        return this.formatError(ErrorCodes.CONTENT_TOO_SHORT,
          `Generated content (${content.length} chars) is below minimum (${minLength})`);
      }
      if (content.length > maxLength) {
        content = content.slice(0, maxLength);
      }

      // Format output
      const template = output.template || this.config.defaultTemplate;
      const formatter = OutputTemplates[template] || OutputTemplates.raw;
      const formattedContent = formatter.format(content, { subject: prompt.subject, recipient: prompt.recipient });

      // Save to file
      const format = output.format || this.config.defaultOutputFormat;
      const extension = format === 'markdown' ? '.md' : '.txt';
      const filename = output.filename || `letter-${Date.now()}${extension}`;
      const outputPath = output.path || `output/${filename}`;

      const buffer = Buffer.from(formattedContent, 'utf-8');

      // Validate size
      if (buffer.length > this.config.maxOutputSize) {
        return this.formatError(ErrorCodes.QUOTA_EXCEEDED,
          `Output size (${buffer.length}) exceeds maximum (${this.config.maxOutputSize})`);
      }

      const absPath = await this.sandboxManager.resolvePath(sessionId, outputPath);
      await this.sandboxManager.ensureParentDir(absPath);
      await writeFile(absPath, buffer);
      this.sandboxManager.updateSandboxSize(sessionId, buffer.length);

      return this.formatResponse({
        success: true,
        operation: 'compose',
        result: {
          content: formattedContent,
          wordCount: formattedContent.split(/\s+/).length,
          characterCount: formattedContent.length,
          persona: personaName,
          outputFile: {
            path: outputPath,
            format,
            size: buffer.length
          }
        },
        generation: {
          model: this.llmClient?.model || 'unknown',
          tokensUsed: llmResponse.usage?.totalTokens,
          temperature: llmOptions.temperature || this.config.llm.defaultTemperature,
          duration
        },
        metadata: {
          timestamp: new Date().toISOString(),
          personaVersion: personas.version || '1.0',
          promptHash: `sha256:${createHash('sha256').update(userPrompt).digest('hex').slice(0, 8)}`
        }
      });

    } catch (err) {
      if (err.code && Object.values(ErrorCodes).includes(err.code)) {
        return this.formatError(err.code, err.message, err.details);
      }
      return this.formatError(ErrorCodes.LLM_GENERATION_FAILED, err.message);
    }
  }

  /**
   * Preview content without saving to file
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async preview(args) {
    const {
      sessionId,
      personaName,
      personasFile = this.config.defaultPersonasFile,
      prompt,
      llmOptions = {}
    } = args;

    // Validate required fields
    if (!personaName) {
      return this.formatError(ErrorCodes.PROMPT_INCOMPLETE, 'personaName is required');
    }
    if (!prompt || !prompt.subject || !prompt.recipient?.name || !prompt.purpose) {
      return this.formatError(ErrorCodes.PROMPT_INCOMPLETE,
        'prompt must include subject, recipient.name, and purpose');
    }

    try {
      const personas = await this.loadPersonasFile(sessionId, personasFile);
      const persona = this.findPersona(personas, personaName);
      if (!persona) {
        return this.formatError(ErrorCodes.PERSONA_NOT_FOUND,
          `Persona '${personaName}' not found`, {
            requestedPersona: personaName,
            availablePersonas: personas.personas.map(p => p.name)
          });
      }

      const systemPrompt = this.buildSystemPrompt(persona, prompt);
      const userPrompt = this.buildUserPrompt(prompt);

      const startTime = Date.now();
      const llmResponse = await this.callLLM(systemPrompt, userPrompt, llmOptions, sessionId);
      const duration = Date.now() - startTime;

      return this.formatResponse({
        success: true,
        operation: 'preview',
        result: {
          content: llmResponse.content,
          wordCount: llmResponse.content.split(/\s+/).length,
          characterCount: llmResponse.content.length,
          persona: personaName
        },
        generation: {
          model: this.llmClient?.model || 'unknown',
          tokensUsed: llmResponse.usage?.totalTokens,
          duration
        }
      });

    } catch (err) {
      return this.formatError(ErrorCodes.LLM_GENERATION_FAILED, err.message);
    }
  }

  /**
   * List available personas
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async listPersonas(args) {
    const {
      sessionId,
      personasFile = this.config.defaultPersonasFile
    } = args;

    try {
      const personas = await this.loadPersonasFile(sessionId, personasFile);

      return this.formatResponse({
        success: true,
        operation: 'list_personas',
        personas: personas.personas.map(p => ({
          name: p.name,
          displayName: p.displayName,
          description: p.description || ''
        })),
        count: personas.personas.length,
        source: personasFile
      });

    } catch (err) {
      if (err.code === ErrorCodes.PERSONAS_FILE_NOT_FOUND) {
        return this.formatError(err.code, err.message);
      }
      return this.formatError(ErrorCodes.PERSONAS_INVALID_YAML, err.message);
    }
  }

  /**
   * Get full persona definition
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async getPersona(args) {
    const {
      sessionId,
      personaName,
      personasFile = this.config.defaultPersonasFile
    } = args;

    if (!personaName) {
      return this.formatError(ErrorCodes.PROMPT_INCOMPLETE, 'personaName is required');
    }

    try {
      const personas = await this.loadPersonasFile(sessionId, personasFile);
      const persona = this.findPersona(personas, personaName);

      if (!persona) {
        return this.formatError(ErrorCodes.PERSONA_NOT_FOUND,
          `Persona '${personaName}' not found`, {
            requestedPersona: personaName,
            availablePersonas: personas.personas.map(p => p.name)
          });
      }

      return this.formatResponse({
        success: true,
        operation: 'get_persona',
        persona
      });

    } catch (err) {
      return this.formatError(ErrorCodes.PERSONAS_FILE_NOT_FOUND, err.message);
    }
  }

  /**
   * Validate personas file against schema
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async validatePersonas(args) {
    const {
      sessionId,
      personasFile = this.config.defaultPersonasFile
    } = args;

    try {
      const personas = await this.loadPersonasFile(sessionId, personasFile, true);
      const errors = this.validatePersonasSchema(personas);

      if (errors.length > 0) {
        return this.formatResponse({
          success: false,
          operation: 'validate_personas',
          valid: false,
          errors,
          source: personasFile
        });
      }

      return this.formatResponse({
        success: true,
        operation: 'validate_personas',
        valid: true,
        personaCount: personas.personas.length,
        personas: personas.personas.map(p => p.name),
        source: personasFile
      });

    } catch (err) {
      return this.formatError(ErrorCodes.PERSONAS_INVALID_YAML, err.message);
    }
  }

  /**
   * Load and parse personas file
   * @param {string} sessionId
   * @param {string} personasFile
   * @param {boolean} [skipCache=false]
   * @returns {Promise<Object>}
   */
  async loadPersonasFile(sessionId, personasFile, skipCache = false) {
    const cacheKey = `${sessionId}:${personasFile}`;

    // Check cache
    if (!skipCache && this.personaCache.has(cacheKey)) {
      const cached = this.personaCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
      this.personaCache.delete(cacheKey);
    }

    // Resolve path
    let absPath;
    try {
      absPath = await this.sandboxManager.resolvePath(sessionId, personasFile);
    } catch (err) {
      const error = new Error(`Cannot resolve path: ${personasFile}`);
      error.code = ErrorCodes.PATH_TRAVERSAL;
      throw error;
    }

    if (!existsSync(absPath)) {
      const error = new Error(`Personas file not found: ${personasFile}`);
      error.code = ErrorCodes.PERSONAS_FILE_NOT_FOUND;
      throw error;
    }

    // Read and parse
    const content = await readFile(absPath, 'utf-8');

    if (content.length > this.config.maxPersonasFileSize) {
      const error = new Error(`Personas file exceeds maximum size of ${this.config.maxPersonasFileSize} bytes`);
      error.code = ErrorCodes.PERSONAS_SCHEMA_ERROR;
      throw error;
    }

    let parsed;
    try {
      parsed = parseYaml(content);
    } catch (err) {
      const error = new Error(`Invalid YAML: ${err.message}`);
      error.code = ErrorCodes.PERSONAS_INVALID_YAML;
      throw error;
    }

    // Cache result
    this.personaCache.set(cacheKey, {
      data: parsed,
      timestamp: Date.now()
    });

    return parsed;
  }

  /**
   * Find a persona by name
   * @param {Object} personas
   * @param {string} name
   * @returns {Object|null}
   */
  findPersona(personas, name) {
    if (!personas.personas || !Array.isArray(personas.personas)) {
      return null;
    }
    return personas.personas.find(p => p.name === name) || null;
  }

  /**
   * Validate personas against schema
   * @param {Object} personas
   * @returns {string[]} Array of error messages
   */
  validatePersonasSchema(personas) {
    const errors = [];

    if (!personas.version) {
      errors.push('Missing required field: version');
    }
    if (!personas.personas || !Array.isArray(personas.personas)) {
      errors.push('Missing or invalid field: personas (must be an array)');
      return errors;
    }
    if (personas.personas.length === 0) {
      errors.push('personas array must have at least one persona');
    }

    personas.personas.forEach((p, idx) => {
      const prefix = `personas[${idx}]`;
      if (!p.name) errors.push(`${prefix}: missing required field 'name'`);
      if (!p.displayName) errors.push(`${prefix}: missing required field 'displayName'`);
      if (!p.tone) errors.push(`${prefix}: missing required field 'tone'`);
      if (!p.tone?.primary) errors.push(`${prefix}.tone: missing required field 'primary'`);
      if (!p.personality) errors.push(`${prefix}: missing required field 'personality'`);
      if (!p.personality?.traits) errors.push(`${prefix}.personality: missing required field 'traits'`);
      if (!p.personality?.voice) errors.push(`${prefix}.personality: missing required field 'voice'`);

      // Validate name pattern
      if (p.name && !/^[a-z][a-z0-9-_]*$/.test(p.name)) {
        errors.push(`${prefix}.name: must be kebab-case (pattern: ^[a-z][a-z0-9-_]*$)`);
      }
    });

    return errors;
  }

  /**
   * Build system prompt from persona definition
   * @param {Object} persona
   * @param {Object} prompt
   * @returns {string}
   */
  buildSystemPrompt(persona, prompt) {
    const parts = [];

    parts.push(`You are writing as ${persona.displayName}: ${persona.description || ''}`);
    parts.push('');

    // Tone
    parts.push('TONE:');
    parts.push(`- Primary tone: ${persona.tone.primary}`);
    if (persona.tone.secondary?.length) {
      parts.push(`- Additional qualities: ${persona.tone.secondary.join(', ')}`);
    }
    if (persona.tone.formality) {
      parts.push(`- Formality level: ${persona.tone.formality}/10`);
    }
    if (persona.tone.warmth) {
      parts.push(`- Warmth level: ${persona.tone.warmth}/10`);
    }
    if (persona.tone.assertiveness) {
      parts.push(`- Assertiveness: ${persona.tone.assertiveness}/10`);
    }
    parts.push('');

    // Personality
    parts.push('PERSONALITY:');
    parts.push(`- Core traits: ${persona.personality.traits.join(', ')}`);
    parts.push(`- Voice: ${persona.personality.voice}`);
    if (persona.personality.perspective) {
      parts.push(`- Perspective: ${persona.personality.perspective}`);
    }
    parts.push('');

    // Language
    if (persona.language) {
      parts.push('LANGUAGE GUIDELINES:');
      if (persona.language.primary) {
        parts.push(`- Language: ${persona.language.primary}`);
      }
      if (persona.language.vocabulary) {
        parts.push(`- Vocabulary level: ${persona.language.vocabulary.level || 'standard'}`);
        if (persona.language.vocabulary.jargonAllowed) {
          const domains = persona.language.vocabulary.jargonDomains?.join(', ') || 'general';
          parts.push(`- Technical jargon: permitted in ${domains}`);
        } else {
          parts.push('- Technical jargon: avoid');
        }
      }
      if (persona.language.sentenceStructure) {
        parts.push(`- Sentence complexity: ${persona.language.sentenceStructure.complexity || 'moderate'}`);
      }
      parts.push('');
    }

    // Motivations
    if (persona.motivations?.length) {
      parts.push('MOTIVATIONS:');
      persona.motivations.forEach(m => parts.push(`- ${m}`));
      parts.push('');
    }

    // Word choice
    if (persona.wordChoice) {
      parts.push('WORD CHOICE:');
      if (persona.wordChoice.preferred?.length) {
        parts.push('Preferred substitutions:');
        persona.wordChoice.preferred.forEach(p => {
          parts.push(`- Use "${p.word}" instead of "${p.instead_of}"`);
        });
      }
      if (persona.wordChoice.avoided?.length) {
        parts.push(`Words to avoid: ${persona.wordChoice.avoided.join(', ')}`);
      }
      if (persona.wordChoice.signature_phrases?.length) {
        parts.push('Signature phrases you may use naturally:');
        persona.wordChoice.signature_phrases.forEach(p => parts.push(`- "${p}"`));
      }
      if (persona.wordChoice.contractions) {
        parts.push(`Contractions: ${persona.wordChoice.contractions}`);
      }
      parts.push('');
    }

    // Emotion
    if (persona.emotion) {
      parts.push('EMOTIONAL EXPRESSION:');
      if (persona.emotion.baseline) {
        parts.push(`- Baseline state: ${persona.emotion.baseline}`);
      }
      if (persona.emotion.range?.length) {
        parts.push(`- Emotional range: ${persona.emotion.range.join(', ')}`);
      }
      if (persona.emotion.intensity) {
        parts.push(`- Intensity: ${persona.emotion.intensity}/10`);
      }
      if (persona.emotion.expressiveness) {
        parts.push(`- Expressiveness: ${persona.emotion.expressiveness}/10`);
      }
      parts.push('');
    }

    // Apply context modifiers based on purpose
    if (persona.contextModifiers && prompt.purpose) {
      const purposeModifiers = {
        'apologize': 'sensitiveTopics',
        'complain': 'urgentMatter',
        'congratulate': 'celebratory',
        'thank': 'celebratory'
      };
      const modifierKey = purposeModifiers[prompt.purpose];
      if (modifierKey && persona.contextModifiers[modifierKey]) {
        const mod = persona.contextModifiers[modifierKey];
        parts.push(`CONTEXT ADJUSTMENT (${modifierKey}):`);
        if (mod.tone) {
          Object.entries(mod.tone).forEach(([k, v]) => {
            parts.push(`- Adjusted ${k}: ${v}/10`);
          });
        }
        if (mod.emotion?.baseline) {
          parts.push(`- Emotional baseline: ${mod.emotion.baseline}`);
        }
        parts.push('');
      }
    }

    parts.push('INSTRUCTIONS:');
    parts.push('- Write naturally in this persona\'s voice');
    parts.push('- Do not include meta-commentary or notes');
    parts.push('- Do not include subject lines or headers unless specifically requested');
    parts.push('- Focus on the content itself');

    return parts.join('\n');
  }

  /**
   * Build user prompt from request
   * @param {Object} prompt
   * @returns {string}
   */
  buildUserPrompt(prompt) {
    const parts = [];

    parts.push(`Write a ${prompt.purpose} letter/message about: ${prompt.subject}`);
    parts.push('');
    parts.push(`Recipient: ${prompt.recipient.name}`);
    if (prompt.recipient.relationship) {
      parts.push(`Relationship: ${prompt.recipient.relationship}`);
    }
    if (prompt.recipient.context) {
      parts.push(`Context about recipient: ${prompt.recipient.context}`);
    }
    parts.push('');

    if (prompt.keyPoints?.length) {
      parts.push('Key points to include:');
      prompt.keyPoints.forEach(p => parts.push(`- ${p}`));
      parts.push('');
    }

    if (prompt.additionalInstructions) {
      parts.push(`Additional instructions: ${prompt.additionalInstructions}`);
      parts.push('');
    }

    if (prompt.constraints) {
      if (prompt.constraints.maxLength) {
        parts.push(`Maximum length: approximately ${prompt.constraints.maxLength} characters`);
      }
      if (prompt.constraints.formality === 'override' && prompt.constraints.formalityLevel) {
        parts.push(`Formality override: ${prompt.constraints.formalityLevel}/10`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Call LLM to generate content
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {Object} options
   * @param {string} sessionId
   * @returns {Promise<Object>}
   */
  async callLLM(systemPrompt, userPrompt, options = {}, sessionId) {
    if (!this.llmClient) {
      // Fallback for testing without LLM
      return {
        content: `[Mock response for testing]\n\nDear ${userPrompt.includes('Recipient:') ? 'Recipient' : 'Reader'},\n\nThis is a placeholder response generated without an LLM client.\n\nBest regards`,
        usage: { totalTokens: 50 }
      };
    }

    const parameters = {
      temperature: options.temperature || this.config.llm.defaultTemperature,
      maxTokens: options.maxTokens || this.config.llm.defaultMaxTokens
    };

    return await this.llmClient.send({
      systemPrompt,
      userPrompt,
      parameters,
      sessionId,
      operation: 'persona_compose'
    });
  }

  /**
   * Format successful response
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
   * @param {string} code
   * @param {string} message
   * @param {Object} [details]
   * @returns {Object}
   */
  formatError(code, message, details = {}) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: {
              code,
              message,
              details
            }
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'persona_compose',
      this.execute.bind(this),
      {
        name: 'persona_compose',
        description: 'Compose personalized letters and content using LLM generation guided by persona definitions from YAML configuration. Supports multiple operations: compose (generate and save), preview (generate without saving), list_personas, get_persona, and validate_personas.',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['compose', 'preview', 'list_personas', 'get_persona', 'validate_personas'],
              default: 'compose',
              description: 'Operation to perform'
            },
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation'
            },
            personaName: {
              type: 'string',
              pattern: '^[a-z][a-z0-9-_]*$',
              description: 'Identifier of the persona to use (required for compose/preview/get_persona)'
            },
            personasFile: {
              type: 'string',
              default: 'PERSONAS.yml',
              description: 'Path to personas configuration file within sandbox'
            },
            prompt: {
              type: 'object',
              description: 'Content generation parameters (required for compose/preview)',
              properties: {
                subject: {
                  type: 'string',
                  description: 'Subject or topic of the letter'
                },
                recipient: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Recipient name' },
                    relationship: { type: 'string', description: 'Relationship to sender' },
                    context: { type: 'string', description: 'Additional context' }
                  },
                  required: ['name']
                },
                purpose: {
                  type: 'string',
                  enum: ['inform', 'persuade', 'request', 'thank', 'apologize', 'congratulate', 'complain', 'follow-up', 'introduction', 'farewell', 'custom'],
                  description: 'Primary purpose of the letter'
                },
                keyPoints: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Key points to include'
                },
                additionalInstructions: {
                  type: 'string',
                  description: 'Additional instructions for generation'
                },
                constraints: {
                  type: 'object',
                  properties: {
                    maxLength: { type: 'integer', minimum: 50, maximum: 10000, default: 1000 },
                    minLength: { type: 'integer', minimum: 10, default: 100 },
                    formality: { type: 'string', enum: ['override', 'inherit'], default: 'inherit' },
                    formalityLevel: { type: 'integer', minimum: 1, maximum: 10 }
                  }
                }
              },
              required: ['subject', 'recipient', 'purpose']
            },
            output: {
              type: 'object',
              description: 'Output configuration (for compose operation)',
              properties: {
                format: { type: 'string', enum: ['text', 'markdown'], default: 'text' },
                path: { type: 'string', description: 'Output file path' },
                filename: { type: 'string', description: 'Output filename' },
                includeMetadata: { type: 'boolean', default: false },
                template: { type: 'string', enum: ['letter', 'email', 'memo', 'note', 'raw'], default: 'letter' }
              }
            },
            llmOptions: {
              type: 'object',
              description: 'LLM generation parameters',
              properties: {
                temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
                maxTokens: { type: 'integer', minimum: 100, maximum: 4096, default: 1024 }
              }
            }
          },
          required: ['operation']
        }
      }
    );
  }
}

/**
 * Create a PersonaComposeTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {import('./llm-client.js').LLMClient} [llmClient]
 * @param {Object} [config]
 * @returns {PersonaComposeTool}
 */
export function createPersonaComposeTool(sandboxManager, llmClient, config) {
  return new PersonaComposeTool(sandboxManager, llmClient, config);
}

export default PersonaComposeTool;
