/**
 * @fileoverview Tests for Report Generator
 */

import { describe, test, expect } from 'bun:test';
import { ReportGenerator } from '../lib/report-generator.js';

describe('ReportGenerator', () => {
  describe('constructor', () => {
    test('initializes with output directory', () => {
      const generator = new ReportGenerator('./output');
      expect(generator.outputDir).toBe('./output');
    });
  });

  describe('formatDetailedScoring', () => {
    test('returns message for null breakdown', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatDetailedScoring(null);
      expect(result).toBe('No breakdown available.');
    });

    test('formats breakdown into markdown sections', () => {
      const generator = new ReportGenerator('./output');
      const breakdown = {
        taskCompletion: {
          score: 85,
          rationale: 'Most tasks completed',
          strengths: ['Fast execution'],
          weaknesses: ['Some failures']
        }
      };

      const result = generator.formatDetailedScoring(breakdown);

      expect(result).toContain('task Completion');
      expect(result).toContain('85/100');
      expect(result).toContain('Most tasks completed');
      expect(result).toContain('Fast execution');
      expect(result).toContain('Some failures');
    });

    test('handles missing strengths and weaknesses', () => {
      const generator = new ReportGenerator('./output');
      const breakdown = {
        taskCompletion: {
          score: 90,
          rationale: 'Done'
        }
      };

      const result = generator.formatDetailedScoring(breakdown);

      expect(result).toContain('None identified');
    });
  });

  describe('formatToolRecommendations', () => {
    test('returns message for null recommendations', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatToolRecommendations(null);
      expect(result).toBe('No recommendations.');
    });

    test('formats feature requests', () => {
      const generator = new ReportGenerator('./output');
      const recs = {
        featureRequests: [
          { title: 'Add caching', toolName: 'http_request', priority: 'high', description: 'Cache responses' }
        ]
      };

      const result = generator.formatToolRecommendations(recs);

      expect(result).toContain('Feature Requests');
      expect(result).toContain('FR-001');
      expect(result).toContain('Add caching');
      expect(result).toContain('http_request');
      expect(result).toContain('high');
    });

    test('formats new tool suggestions', () => {
      const generator = new ReportGenerator('./output');
      const recs = {
        newTools: [
          { proposedName: 'email_send', description: 'Send emails via SMTP' }
        ]
      };

      const result = generator.formatToolRecommendations(recs);

      expect(result).toContain('New Tool Suggestions');
      expect(result).toContain('NT-001');
      expect(result).toContain('email_send');
    });

    test('formats usage analysis', () => {
      const generator = new ReportGenerator('./output');
      const recs = {
        usageAnalysis: { observations: 'Heavy use of notepad tools' }
      };

      const result = generator.formatToolRecommendations(recs);

      expect(result).toContain('Usage Analysis');
      expect(result).toContain('Heavy use of notepad tools');
    });
  });

  describe('formatRequirementsAnalysis', () => {
    test('returns message for null analysis', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatRequirementsAnalysis(null);
      expect(result).toBe('No analysis available.');
    });

    test('formats unclear requirements', () => {
      const generator = new ReportGenerator('./output');
      const analysis = {
        unclearRequirements: [
          { originalText: 'Make it fast', issue: 'Vague', suggestedRevision: 'Response time < 100ms' }
        ]
      };

      const result = generator.formatRequirementsAnalysis(analysis);

      expect(result).toContain('Unclear Requirements');
      expect(result).toContain('UR-001');
      expect(result).toContain('Make it fast');
      expect(result).toContain('Vague');
      expect(result).toContain('Response time < 100ms');
    });

    test('formats missing requirements', () => {
      const generator = new ReportGenerator('./output');
      const analysis = {
        missingRequirements: [
          { description: 'Error handling not specified' }
        ]
      };

      const result = generator.formatRequirementsAnalysis(analysis);

      expect(result).toContain('Missing Requirements');
      expect(result).toContain('MR-001');
      expect(result).toContain('Error handling not specified');
    });

    test('returns no issues message for empty analysis', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatRequirementsAnalysis({});
      expect(result).toBe('No issues identified.');
    });
  });

  describe('formatLanguageRecommendations', () => {
    test('returns message for null recommendations', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatLanguageRecommendations(null);
      expect(result).toBe('No recommendations.');
    });

    test('formats prompt improvements', () => {
      const generator = new ReportGenerator('./output');
      const recs = {
        promptImprovements: [
          { issue: 'Too verbose' },
          'Be more specific'
        ]
      };

      const result = generator.formatLanguageRecommendations(recs);

      expect(result).toContain('Prompt Improvements');
      expect(result).toContain('Too verbose');
      expect(result).toContain('Be more specific');
    });

    test('formats encoding recommendations', () => {
      const generator = new ReportGenerator('./output');
      const recs = {
        encoding: [
          { recommendation: 'Use UTF-8' }
        ]
      };

      const result = generator.formatLanguageRecommendations(recs);

      expect(result).toContain('Encoding Recommendations');
      expect(result).toContain('Use UTF-8');
    });
  });

  describe('formatLearnings', () => {
    test('returns message for null learnings', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatLearnings(null);
      expect(result).toBe('No learnings captured.');
    });

    test('formats key learnings', () => {
      const generator = new ReportGenerator('./output');
      const learnings = {
        keyLearnings: [
          { title: 'Parallel execution', description: 'Running tasks in parallel improves speed' }
        ]
      };

      const result = generator.formatLearnings(learnings);

      expect(result).toContain('Parallel execution');
      expect(result).toContain('Running tasks in parallel');
    });

    test('formats success patterns', () => {
      const generator = new ReportGenerator('./output');
      const learnings = {
        successPatterns: [
          { pattern: 'Clear goal definitions' }
        ]
      };

      const result = generator.formatLearnings(learnings);

      expect(result).toContain('Success Patterns');
      expect(result).toContain('Clear goal definitions');
    });

    test('formats failure patterns', () => {
      const generator = new ReportGenerator('./output');
      const learnings = {
        failurePatterns: [
          { pattern: 'Missing error handling' }
        ]
      };

      const result = generator.formatLearnings(learnings);

      expect(result).toContain('Failure Patterns');
      expect(result).toContain('Missing error handling');
    });
  });

  describe('formatActionItems', () => {
    test('returns message for null items', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatActionItems(null);
      expect(result).toBe('No action items.');
    });

    test('returns message for empty items', () => {
      const generator = new ReportGenerator('./output');
      const result = generator.formatActionItems([]);
      expect(result).toBe('No action items.');
    });

    test('formats action items as table rows', () => {
      const generator = new ReportGenerator('./output');
      const items = [
        { priority: 'high', action: 'Fix bug', owner: 'Dev Team' },
        { action: 'Add tests' }
      ];

      const result = generator.formatActionItems(items);

      expect(result).toContain('high');
      expect(result).toContain('Fix bug');
      expect(result).toContain('Dev Team');
      expect(result).toContain('Add tests');
      expect(result).toContain('medium'); // Default priority
      expect(result).toContain('TBD'); // Default owner
    });
  });
});
