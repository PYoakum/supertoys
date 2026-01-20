#!/usr/bin/env node

/**
 * @fileoverview Validation script for Output Evaluation Service
 */

import { ScoreCalculator } from './lib/score-calculator.js';
import { ReportGenerator } from './lib/report-generator.js';
import { parseJsonResponse, validateEvaluationResponse } from './prompts/templates.js';
import { rm } from 'fs/promises';

async function main() {
  console.log('Output Evaluation Service - Validation Script');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Score Calculator - Overall Score
  console.log('Test 1: Score Calculator - Overall Score');
  try {
    const calc = new ScoreCalculator();
    const result = calc.calculateOverall({
      taskCompletion: { score: 85, rationale: 'Good', strengths: [], weaknesses: [] },
      outputQuality: { score: 80, rationale: 'Good', strengths: [], weaknesses: [] },
      toolUtilization: { score: 75, rationale: 'OK', strengths: [], weaknesses: [] },
      goalAlignment: { score: 90, rationale: 'Great', strengths: [], weaknesses: [] },
      processEfficiency: { score: 70, rationale: 'Adequate', strengths: [], weaknesses: [] }
    });

    // Expected: 85*0.30 + 80*0.25 + 75*0.20 + 90*0.15 + 70*0.10 = 25.5 + 20 + 15 + 13.5 + 7 = 81
    if (Math.abs(result.overall - 81) > 1) {
      throw new Error(`Expected ~81, got ${result.overall}`);
    }
    if (result.grade !== 'B') {
      throw new Error(`Expected grade B, got ${result.grade}`);
    }
    
    console.log('  [+] Score calculation works correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Score calculation failed:', err.message);
    failed++;
  }

  // Test 2: Score Calculator - Grade Mapping
  console.log('\nTest 2: Score Calculator - Grade Mapping');
  try {
    const calc = new ScoreCalculator();
    
    if (calc.scoreToGrade(95) !== 'A') throw new Error('95 should be A');
    if (calc.scoreToGrade(85) !== 'B') throw new Error('85 should be B');
    if (calc.scoreToGrade(75) !== 'C') throw new Error('75 should be C');
    if (calc.scoreToGrade(65) !== 'D') throw new Error('65 should be D');
    if (calc.scoreToGrade(50) !== 'F') throw new Error('50 should be F');
    
    console.log('  [+] Grade mapping works correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Grade mapping failed:', err.message);
    failed++;
  }

  // Test 3: Score Calculator - Task Completion Score
  console.log('\nTest 3: Score Calculator - Task Completion Score');
  try {
    const calc = new ScoreCalculator();
    
    const score1 = calc.calculateTaskCompletionScore({ totalTasks: 10, completedCount: 10, failedCount: 0 });
    if (score1 !== 100) throw new Error(`Full completion should be 100, got ${score1}`);
    
    const score2 = calc.calculateTaskCompletionScore({ totalTasks: 10, completedCount: 5, failedCount: 5 });
    if (score2 < 30 || score2 > 50) throw new Error(`50% completion with failures should be 30-50, got ${score2}`);
    
    console.log('  [+] Task completion scoring works correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Task completion scoring failed:', err.message);
    failed++;
  }

  // Test 4: JSON Response Parsing
  console.log('\nTest 4: JSON Response Parsing');
  try {
    const json1 = '{"qualityScore": {"overall": 85}}';
    const parsed1 = parseJsonResponse(json1);
    if (parsed1.qualityScore.overall !== 85) throw new Error('Basic JSON failed');
    
    const json2 = '```json\n{"qualityScore": {"overall": 90}}\n```';
    const parsed2 = parseJsonResponse(json2);
    if (parsed2.qualityScore.overall !== 90) throw new Error('Markdown JSON failed');
    
    console.log('  [+] JSON response parsing works correctly');
    passed++;
  } catch (err) {
    console.log('  [x] JSON response parsing failed:', err.message);
    failed++;
  }

  // Test 5: Evaluation Response Validation
  console.log('\nTest 5: Evaluation Response Validation');
  try {
    const valid = {
      qualityScore: {
        overall: 85,
        grade: 'B',
        breakdown: {
          taskCompletion: { score: 85, weight: 0.30, weighted: 25.5 },
          outputQuality: { score: 80, weight: 0.25, weighted: 20 },
          toolUtilization: { score: 75, weight: 0.20, weighted: 15 },
          goalAlignment: { score: 90, weight: 0.15, weighted: 13.5 },
          processEfficiency: { score: 70, weight: 0.10, weighted: 7 }
        }
      },
      toolRouterRecommendations: {},
      requirementsAnalysis: {},
      languageRecommendations: {},
      learningsSummary: {}
    };
    
    const v1 = validateEvaluationResponse(valid);
    if (!v1.valid) throw new Error('Valid response marked invalid: ' + v1.errors.join(', '));
    
    const invalid = { qualityScore: { overall: 150 } };
    const v2 = validateEvaluationResponse(invalid);
    if (v2.valid) throw new Error('Invalid response marked valid');
    
    console.log('  [+] Evaluation response validation works correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Evaluation response validation failed:', err.message);
    failed++;
  }

  // Test 6: Report Generator
  console.log('\nTest 6: Report Generator');
  try {
    const generator = new ReportGenerator('./test-eval-output');
    
    const mockResult = {
      qualityScore: {
        overall: 82,
        grade: 'B',
        summary: 'Test summary',
        breakdown: {
          taskCompletion: { score: 85, weight: 0.30, weighted: 25.5, rationale: 'Good', strengths: ['A'], weaknesses: ['B'] },
          outputQuality: { score: 80, weight: 0.25, weighted: 20, rationale: 'OK', strengths: [], weaknesses: [] },
          toolUtilization: { score: 75, weight: 0.20, weighted: 15, rationale: 'OK', strengths: [], weaknesses: [] },
          goalAlignment: { score: 90, weight: 0.15, weighted: 13.5, rationale: 'Great', strengths: [], weaknesses: [] },
          processEfficiency: { score: 70, weight: 0.10, weighted: 7, rationale: 'Adequate', strengths: [], weaknesses: [] }
        }
      },
      toolRouterRecommendations: { featureRequests: [], enhancements: [], newTools: [] },
      requirementsAnalysis: { unclearRequirements: [], missingRequirements: [] },
      languageRecommendations: { promptImprovements: [], encoding: [] },
      learningsSummary: { keyLearnings: [], successPatterns: [], failurePatterns: [], actionItems: [] }
    };
    
    const metadata = {
      evaluatedAt: new Date().toISOString(),
      version: '1.0.0',
      modelUsed: 'test-model'
    };
    
    const files = await generator.generateAll('test-session', mockResult, metadata);
    
    if (!files.reportMd) throw new Error('Report MD not generated');
    if (!files.reportJson) throw new Error('Report JSON not generated');
    
    console.log('  [+] Report generator works correctly');
    passed++;
    
    // Cleanup
    await rm('./test-eval-output', { recursive: true, force: true });
  } catch (err) {
    console.log('  [x] Report generator failed:', err.message);
    failed++;
    try { await rm('./test-eval-output', { recursive: true, force: true }); } catch (e) {}
  }

  // Summary
  console.log('\n=============================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('\n[+] All validation tests passed!');
    console.log('\nUsage: node output-eval.js --bundle <path>');
    console.log('Note: Requires a session bundle and LLM API key.');
    process.exit(0);
  } else {
    console.log('\n[x] Some tests failed.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
