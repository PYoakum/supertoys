/**
 * @fileoverview Tests for Score Calculator
 */

import { describe, test, expect } from 'bun:test';
import { ScoreCalculator } from '../lib/score-calculator.js';

describe('ScoreCalculator', () => {
  describe('constructor', () => {
    test('uses default weights when none provided', () => {
      const calc = new ScoreCalculator();
      expect(calc.weights.taskCompletion).toBe(0.30);
      expect(calc.weights.outputQuality).toBe(0.25);
      expect(calc.weights.toolUtilization).toBe(0.20);
      expect(calc.weights.goalAlignment).toBe(0.15);
      expect(calc.weights.processEfficiency).toBe(0.10);
    });

    test('merges custom weights with defaults', () => {
      const calc = new ScoreCalculator({ taskCompletion: 0.40, processEfficiency: 0.00 });
      expect(calc.weights.taskCompletion).toBe(0.40);
      expect(calc.weights.processEfficiency).toBe(0.00);
    });

    test('throws if weights do not sum to 1.0', () => {
      expect(() => new ScoreCalculator({ taskCompletion: 0.50 })).toThrow('Weights must sum to 1.0');
    });
  });

  describe('scoreToGrade', () => {
    test('returns A for scores >= 90', () => {
      const calc = new ScoreCalculator();
      expect(calc.scoreToGrade(90)).toBe('A');
      expect(calc.scoreToGrade(95)).toBe('A');
      expect(calc.scoreToGrade(100)).toBe('A');
    });

    test('returns B for scores 80-89', () => {
      const calc = new ScoreCalculator();
      expect(calc.scoreToGrade(80)).toBe('B');
      expect(calc.scoreToGrade(89)).toBe('B');
    });

    test('returns C for scores 70-79', () => {
      const calc = new ScoreCalculator();
      expect(calc.scoreToGrade(70)).toBe('C');
      expect(calc.scoreToGrade(79)).toBe('C');
    });

    test('returns D for scores 60-69', () => {
      const calc = new ScoreCalculator();
      expect(calc.scoreToGrade(60)).toBe('D');
      expect(calc.scoreToGrade(69)).toBe('D');
    });

    test('returns F for scores below 60', () => {
      const calc = new ScoreCalculator();
      expect(calc.scoreToGrade(59)).toBe('F');
      expect(calc.scoreToGrade(0)).toBe('F');
    });
  });

  describe('gradeDescription', () => {
    test('returns correct descriptions', () => {
      const calc = new ScoreCalculator();
      expect(calc.gradeDescription('A')).toBe('Excellent');
      expect(calc.gradeDescription('B')).toBe('Good');
      expect(calc.gradeDescription('C')).toBe('Satisfactory');
      expect(calc.gradeDescription('D')).toBe('Needs Improvement');
      expect(calc.gradeDescription('F')).toBe('Unsatisfactory');
    });

    test('returns Unknown for invalid grades', () => {
      const calc = new ScoreCalculator();
      expect(calc.gradeDescription('X')).toBe('Unknown');
    });
  });

  describe('formatDimensionName', () => {
    test('formats camelCase to Title Case', () => {
      const calc = new ScoreCalculator();
      expect(calc.formatDimensionName('taskCompletion')).toBe('Task Completion');
      expect(calc.formatDimensionName('outputQuality')).toBe('Output Quality');
      expect(calc.formatDimensionName('processEfficiency')).toBe('Process Efficiency');
    });
  });

  describe('calculateOverall', () => {
    test('calculates weighted overall score', () => {
      const calc = new ScoreCalculator();
      const dimensionScores = {
        taskCompletion: { score: 100, rationale: 'All tasks done' },
        outputQuality: { score: 100, rationale: 'High quality' },
        toolUtilization: { score: 100, rationale: 'Good tool use' },
        goalAlignment: { score: 100, rationale: 'Goals met' },
        processEfficiency: { score: 100, rationale: 'Efficient' }
      };

      const result = calc.calculateOverall(dimensionScores);
      expect(result.overall).toBe(100);
      expect(result.grade).toBe('A');
    });

    test('handles missing dimension scores', () => {
      const calc = new ScoreCalculator();
      const dimensionScores = {
        taskCompletion: { score: 80 }
      };

      const result = calc.calculateOverall(dimensionScores);
      expect(result.overall).toBe(24); // 80 * 0.30
      expect(result.grade).toBe('F');
    });

    test('includes breakdown in result', () => {
      const calc = new ScoreCalculator();
      const dimensionScores = {
        taskCompletion: { score: 90, rationale: 'Good', strengths: ['Fast'], weaknesses: ['None'] }
      };

      const result = calc.calculateOverall(dimensionScores);
      expect(result.breakdown.taskCompletion.score).toBe(90);
      expect(result.breakdown.taskCompletion.weight).toBe(0.30);
      expect(result.breakdown.taskCompletion.rationale).toBe('Good');
      expect(result.breakdown.taskCompletion.strengths).toContain('Fast');
    });

    test('generates summary text', () => {
      const calc = new ScoreCalculator();
      const dimensionScores = {
        taskCompletion: { score: 90 },
        outputQuality: { score: 85 },
        toolUtilization: { score: 80 },
        goalAlignment: { score: 75 },
        processEfficiency: { score: 70 }
      };

      const result = calc.calculateOverall(dimensionScores);
      expect(result.summary).toContain('overall score');
      expect(result.summary).toContain('Strongest area');
      expect(result.summary).toContain('Area for improvement');
    });
  });

  describe('calculateTaskCompletionScore', () => {
    test('returns 0 for null metrics', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateTaskCompletionScore(null)).toBe(0);
    });

    test('returns 0 for zero total tasks', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateTaskCompletionScore({ totalTasks: 0 })).toBe(0);
    });

    test('calculates score based on completion rate', () => {
      const calc = new ScoreCalculator();
      const metrics = { totalTasks: 10, completedCount: 10, failedCount: 0 };
      expect(calc.calculateTaskCompletionScore(metrics)).toBe(100);
    });

    test('applies penalty for failures', () => {
      const calc = new ScoreCalculator();
      const metrics = { totalTasks: 10, completedCount: 8, failedCount: 2 };
      const score = calc.calculateTaskCompletionScore(metrics);
      expect(score).toBeLessThan(80);
    });

    test('clamps score between 0 and 100', () => {
      const calc = new ScoreCalculator();
      const metrics = { totalTasks: 10, completedCount: 0, failedCount: 10 };
      const score = calc.calculateTaskCompletionScore(metrics);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateOutputQualityScore', () => {
    test('returns 50 for null evaluations', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateOutputQualityScore(null)).toBe(50);
    });

    test('returns 50 for empty evaluations', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateOutputQualityScore([])).toBe(50);
    });

    test('calculates score for successful evaluations', () => {
      const calc = new ScoreCalculator();
      const evaluations = [
        { success: true, criteriaMatched: ['a', 'b'], criteriaUnmatched: [], issues: [] }
      ];
      const score = calc.calculateOutputQualityScore(evaluations);
      expect(score).toBeGreaterThan(85);
    });

    test('gives lower score for failed evaluations', () => {
      const calc = new ScoreCalculator();
      const evaluations = [{ success: false }];
      const score = calc.calculateOutputQualityScore(evaluations);
      expect(score).toBe(30);
    });
  });

  describe('calculateToolUtilizationScore', () => {
    test('returns 50 for null task list', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateToolUtilizationScore(null, [])).toBe(50);
    });

    test('returns 50 for empty task list', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateToolUtilizationScore({ tasks: [] }, [])).toBe(50);
    });

    test('gives bonus for tool variety', () => {
      const calc = new ScoreCalculator();
      const taskList = {
        tasks: [
          { tool: { toolName: 'tool1' } },
          { tool: { toolName: 'tool2' } },
          { tool: { toolName: 'tool3' } }
        ]
      };
      const score = calc.calculateToolUtilizationScore(taskList, []);
      expect(score).toBeGreaterThan(80);
    });
  });

  describe('calculateGoalAlignmentScore', () => {
    test('returns 50 for null goals', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateGoalAlignmentScore(null, [])).toBe(50);
    });

    test('returns 50 for empty goals', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateGoalAlignmentScore({ items: [] }, [])).toBe(50);
    });

    test('gives 100 for completed goals', () => {
      const calc = new ScoreCalculator();
      const goals = {
        items: [{ status: { state: 'completed' } }]
      };
      expect(calc.calculateGoalAlignmentScore(goals, [])).toBe(100);
    });

    test('gives partial score for in-progress goals', () => {
      const calc = new ScoreCalculator();
      const goals = {
        items: [{ status: { state: 'in_progress', progress: 75 } }]
      };
      expect(calc.calculateGoalAlignmentScore(goals, [])).toBe(75);
    });

    test('gives low score for failed goals', () => {
      const calc = new ScoreCalculator();
      const goals = {
        items: [{ status: { state: 'failed' } }]
      };
      expect(calc.calculateGoalAlignmentScore(goals, [])).toBe(20);
    });
  });

  describe('calculateProcessEfficiencyScore', () => {
    test('returns base score for null metrics', () => {
      const calc = new ScoreCalculator();
      expect(calc.calculateProcessEfficiencyScore(null, null)).toBe(80);
    });

    test('gives bonus for fast execution', () => {
      const calc = new ScoreCalculator();
      const metrics = { totalTasks: 10, totalExecutionTimeMs: 100000 }; // 10s per task
      const score = calc.calculateProcessEfficiencyScore(metrics, null);
      expect(score).toBeGreaterThan(80);
    });

    test('applies penalty for errors in log', () => {
      const calc = new ScoreCalculator();
      const executionLog = {
        entries: [
          { status: 'error' },
          { status: 'error' }
        ]
      };
      const score = calc.calculateProcessEfficiencyScore({}, executionLog);
      expect(score).toBeLessThan(80);
    });
  });
});
