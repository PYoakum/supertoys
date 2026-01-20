/**
 * @fileoverview Tests for PersonaComposeTool
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { PersonaComposeTool } from './persona-compose-tool.js';
import { SandboxManager } from './sandbox-manager.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';

const TEST_SANDBOX = './test-sandbox-persona';
const TEST_SESSION = 'test-session-persona';

// Sample PERSONAS.yml content
const SAMPLE_PERSONAS_YAML = `
version: "1.0"

metadata:
  name: "Test Persona Collection"
  description: "Test personas for unit testing"

personas:
  - name: "test-advisor"
    displayName: "Test Advisor"
    description: "A test persona for unit testing"

    tone:
      primary: "professional"
      secondary:
        - "supportive"
        - "confident"
      formality: 7
      warmth: 5
      assertiveness: 6

    personality:
      traits:
        - "analytical"
        - "helpful"
        - "patient"
      voice: "A knowledgeable advisor who explains things clearly"
      perspective: "first-person"

    language:
      primary: "en-US"
      vocabulary:
        level: "professional"
        jargonAllowed: true
        jargonDomains:
          - "business"
      sentenceStructure:
        averageLength: "medium"
        complexity: "moderate"

    motivations:
      - "Help readers understand complex topics"
      - "Build trust through transparency"

    wordChoice:
      preferred:
        - word: "opportunity"
          instead_of: "problem"
        - word: "consider"
          instead_of: "you should"
      avoided:
        - "actually"
        - "basically"
      signature_phrases:
        - "I appreciate your perspective"
        - "Let me explain"
      contractions: "minimal"

    emotion:
      baseline: "calm-confident"
      range:
        - "empathy"
        - "encouragement"
      intensity: 5
      expressiveness: 4

  - name: "casual-friend"
    displayName: "Casual Friend"
    description: "A friendly, casual persona"

    tone:
      primary: "friendly"
      secondary:
        - "casual"
      formality: 3
      warmth: 8

    personality:
      traits:
        - "approachable"
        - "helpful"
      voice: "A friendly person who keeps things light"
      perspective: "first-person"
`;

// Invalid PERSONAS.yml (missing required fields)
const INVALID_PERSONAS_YAML = `
version: "1.0"

personas:
  - name: "broken-persona"
    # Missing displayName, tone, personality
`;

describe('PersonaComposeTool', () => {
  let sandboxManager;
  let tool;

  beforeAll(async () => {
    // Create test sandbox
    await mkdir(TEST_SANDBOX, { recursive: true });
    await mkdir(join(TEST_SANDBOX, TEST_SESSION), { recursive: true });
    await mkdir(join(TEST_SANDBOX, TEST_SESSION, 'output'), { recursive: true });

    // Write test personas file
    await writeFile(
      join(TEST_SANDBOX, TEST_SESSION, 'PERSONAS.yml'),
      SAMPLE_PERSONAS_YAML
    );

    // Write invalid personas file for testing validation
    await writeFile(
      join(TEST_SANDBOX, TEST_SESSION, 'INVALID_PERSONAS.yml'),
      INVALID_PERSONAS_YAML
    );

    // Initialize sandbox manager and tool
    sandboxManager = new SandboxManager({
      baseDir: TEST_SANDBOX,
      maxFileSize: 1024 * 1024,
      maxSandboxSize: 10 * 1024 * 1024
    });

    // Create tool without LLM client (will use mock responses)
    tool = new PersonaComposeTool(sandboxManager, null, {
      defaultPersonasFile: 'PERSONAS.yml'
    });
  });

  afterAll(async () => {
    // Cleanup test sandbox
    await rm(TEST_SANDBOX, { recursive: true, force: true });
  });

  describe('list_personas', () => {
    test('should list all personas from PERSONAS.yml', async () => {
      const result = await tool.execute({
        operation: 'list_personas',
        sessionId: TEST_SESSION
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.operation).toBe('list_personas');
      expect(response.count).toBe(2);
      expect(response.personas).toHaveLength(2);
      expect(response.personas[0].name).toBe('test-advisor');
      expect(response.personas[1].name).toBe('casual-friend');
    });

    test('should return error for missing personas file', async () => {
      const result = await tool.execute({
        operation: 'list_personas',
        sessionId: TEST_SESSION,
        personasFile: 'NONEXISTENT.yml'
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERSONAS_FILE_NOT_FOUND');
    });
  });

  describe('get_persona', () => {
    test('should get full persona definition by name', async () => {
      const result = await tool.execute({
        operation: 'get_persona',
        sessionId: TEST_SESSION,
        personaName: 'test-advisor'
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.operation).toBe('get_persona');
      expect(response.persona.name).toBe('test-advisor');
      expect(response.persona.displayName).toBe('Test Advisor');
      expect(response.persona.tone.primary).toBe('professional');
      expect(response.persona.personality.traits).toContain('analytical');
    });

    test('should return error for non-existent persona', async () => {
      const result = await tool.execute({
        operation: 'get_persona',
        sessionId: TEST_SESSION,
        personaName: 'nonexistent-persona'
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERSONA_NOT_FOUND');
      expect(response.error.details.availablePersonas).toContain('test-advisor');
    });

    test('should return error when personaName is missing', async () => {
      const result = await tool.execute({
        operation: 'get_persona',
        sessionId: TEST_SESSION
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PROMPT_INCOMPLETE');
    });
  });

  describe('validate_personas', () => {
    test('should validate valid personas file', async () => {
      const result = await tool.execute({
        operation: 'validate_personas',
        sessionId: TEST_SESSION
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.valid).toBe(true);
      expect(response.personaCount).toBe(2);
    });

    test('should return validation errors for invalid file', async () => {
      const result = await tool.execute({
        operation: 'validate_personas',
        sessionId: TEST_SESSION,
        personasFile: 'INVALID_PERSONAS.yml'
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.valid).toBe(false);
      expect(response.errors.length).toBeGreaterThan(0);
    });
  });

  describe('preview', () => {
    test('should generate preview without saving', async () => {
      const result = await tool.execute({
        operation: 'preview',
        sessionId: TEST_SESSION,
        personaName: 'test-advisor',
        prompt: {
          subject: 'Test Subject',
          recipient: {
            name: 'John Doe',
            relationship: 'client'
          },
          purpose: 'inform',
          keyPoints: [
            'First important point',
            'Second important point'
          ]
        }
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.operation).toBe('preview');
      expect(response.result.content).toBeDefined();
      expect(response.result.persona).toBe('test-advisor');
      expect(response.result.wordCount).toBeGreaterThan(0);
    });

    test('should return error for missing prompt fields', async () => {
      const result = await tool.execute({
        operation: 'preview',
        sessionId: TEST_SESSION,
        personaName: 'test-advisor',
        prompt: {
          subject: 'Test'
          // Missing recipient and purpose
        }
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PROMPT_INCOMPLETE');
    });
  });

  describe('compose', () => {
    test('should compose and save content to file', async () => {
      const result = await tool.execute({
        operation: 'compose',
        sessionId: TEST_SESSION,
        personaName: 'casual-friend',
        prompt: {
          subject: 'Weekend Plans',
          recipient: {
            name: 'Sarah',
            relationship: 'friend'
          },
          purpose: 'inform',
          keyPoints: [
            'Planning a barbecue',
            'Saturday at 4pm'
          ]
        },
        output: {
          format: 'text',
          template: 'note',
          path: 'output/test-letter.txt'
        }
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(true);
      expect(response.operation).toBe('compose');
      expect(response.result.content).toBeDefined();
      expect(response.result.persona).toBe('casual-friend');
      expect(response.result.outputFile.path).toBe('output/test-letter.txt');
      expect(response.result.outputFile.size).toBeGreaterThan(0);
      expect(response.metadata.timestamp).toBeDefined();
    });

    test('should return error for non-existent persona', async () => {
      const result = await tool.execute({
        operation: 'compose',
        sessionId: TEST_SESSION,
        personaName: 'nonexistent',
        prompt: {
          subject: 'Test',
          recipient: { name: 'Test' },
          purpose: 'inform'
        }
      });

      const response = JSON.parse(result.content[0].text);

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('PERSONA_NOT_FOUND');
    });
  });

  describe('buildSystemPrompt', () => {
    test('should build comprehensive system prompt from persona', () => {
      const persona = {
        displayName: 'Test Persona',
        description: 'A test persona',
        tone: {
          primary: 'professional',
          secondary: ['supportive'],
          formality: 7,
          warmth: 5,
          assertiveness: 6
        },
        personality: {
          traits: ['analytical', 'helpful'],
          voice: 'A clear communicator',
          perspective: 'first-person'
        },
        motivations: ['Help others'],
        wordChoice: {
          preferred: [{ word: 'opportunity', instead_of: 'problem' }],
          avoided: ['actually'],
          signature_phrases: ['Let me help'],
          contractions: 'minimal'
        },
        emotion: {
          baseline: 'calm',
          range: ['empathy'],
          intensity: 5,
          expressiveness: 4
        }
      };

      const prompt = { purpose: 'inform' };
      const systemPrompt = tool.buildSystemPrompt(persona, prompt);

      expect(systemPrompt).toContain('Test Persona');
      expect(systemPrompt).toContain('professional');
      expect(systemPrompt).toContain('analytical');
      expect(systemPrompt).toContain('opportunity');
      expect(systemPrompt).toContain('actually');
      expect(systemPrompt).toContain('calm');
    });
  });

  describe('buildUserPrompt', () => {
    test('should build user prompt with all fields', () => {
      const prompt = {
        subject: 'Quarterly Review',
        recipient: {
          name: 'John Smith',
          relationship: 'client',
          context: 'Long-term customer'
        },
        purpose: 'inform',
        keyPoints: ['Revenue increased', 'New opportunities'],
        additionalInstructions: 'Keep it concise',
        constraints: {
          maxLength: 500,
          formality: 'override',
          formalityLevel: 8
        }
      };

      const userPrompt = tool.buildUserPrompt(prompt);

      expect(userPrompt).toContain('Quarterly Review');
      expect(userPrompt).toContain('John Smith');
      expect(userPrompt).toContain('client');
      expect(userPrompt).toContain('Long-term customer');
      expect(userPrompt).toContain('Revenue increased');
      expect(userPrompt).toContain('Keep it concise');
      expect(userPrompt).toContain('500 characters');
      expect(userPrompt).toContain('8/10');
    });
  });

  describe('caching', () => {
    test('should cache parsed personas file', async () => {
      // First call - loads from file
      await tool.execute({
        operation: 'list_personas',
        sessionId: TEST_SESSION
      });

      // Cache should have the entry
      const cacheKey = `${TEST_SESSION}:PERSONAS.yml`;
      expect(tool.personaCache.has(cacheKey)).toBe(true);

      // Second call - should use cache
      const result = await tool.execute({
        operation: 'list_personas',
        sessionId: TEST_SESSION
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });
  });
});

console.log('Running PersonaComposeTool tests...');
