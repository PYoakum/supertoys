#!/usr/bin/env node

/**
 * @fileoverview Output Evaluation Service - Main CLI entry point
 * @module output-eval
 */

import { parseArgs } from 'util';
import config from './output-eval-config.js';
import { BundleLoader } from './lib/bundle-loader.js';
import { LLMClient } from './lib/llm-client.js';
import { ScoreCalculator } from './lib/score-calculator.js';
import { ReportGenerator } from './lib/report-generator.js';
import { buildEvaluationPrompt, parseJsonResponse, validateEvaluationResponse } from './prompts/templates.js';
import { ConfigurationError } from './lib/errors.js';

/**
 * Parse command line arguments
 */
function parseArguments() {
  const options = {
    bundle: { type: 'string', short: 'b' },
    config: { type: 'string', short: 'c' },
    output: { type: 'string', short: 'o' },
    format: { type: 'string', short: 'f', default: 'all' },
    verbose: { type: 'boolean', short: 'v', default: false },
    'no-learnings': { type: 'boolean', default: false },
    'no-recommendations': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'V', default: false }
  };

  try {
    const { values } = parseArgs({ options, allowPositionals: false });
    return values;
  } catch (err) {
    console.error(`Error parsing arguments: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
Output Evaluation Service v1.0.0

Usage: output-eval --bundle <path> [options]

Options:
  -b, --bundle <path>      Path to session bundle directory (required)
  -c, --config <path>      Configuration file path
  -o, --output <path>      Output directory (default: ./evaluation-output)
  -f, --format <type>      Output format: markdown, json, all (default: all)
  -v, --verbose            Enable verbose logging
  --no-learnings           Skip learnings document
  --no-recommendations     Skip recommendation documents
  -h, --help               Show this help
  -V, --version            Show version

Environment Variables:
  LLM_API_KEY              LLM API key (required)
  LLM_MODEL                LLM model name
  OUTPUT_DIR               Default output directory

Examples:
  output-eval --bundle ./output/bundle-550e8400-...
  output-eval -b ./bundle -o ./my-evaluation
  output-eval -b ./bundle -f json
`);
}

/**
 * Show version
 */
function showVersion() {
  console.log('Output Evaluation Service v1.0.0');
}

/**
 * Print progress bar
 */
function printScoreBar(score) {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Main function
 */
async function main(args) {
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (args.version) {
    showVersion();
    process.exit(0);
  }

  if (!args.bundle) {
    console.error('Error: --bundle is required');
    showHelp();
    process.exit(2);
  }

  console.log(`
Output Evaluation Service v1.0.0
══════════════════════════════════════════════════════════════════════

Bundle: ${args.bundle}
`);

  // Validate configuration
  if (!config.evaluationLlm.apiKey) {
    throw new ConfigurationError('LLM API key is required. Set LLM_API_KEY environment variable.', 'evaluationLlm.apiKey');
  }

  const outputDir = args.output || config.output.baseDir;

  // Phase 1: Loading Bundle
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log('Phase 1: Loading Bundle');

  const bundleLoader = new BundleLoader(args.bundle, {
    validateIntegrity: config.input.validateIntegrity
  });

  const bundleData = await bundleLoader.load();
  const sessionId = bundleLoader.getSessionId();

  console.log('  [+] Manifest loaded');
  console.log('  [+] Session data loaded');
  console.log(`  [+] Goals loaded (${bundleData.goals?.items?.length || 0} goals)`);
  console.log(`  [+] Tasks loaded (${bundleData.tasks?.tasks?.length || 0} tasks)`);
  console.log(`  [+] Task outputs loaded (${bundleData.taskOutputs?.length || 0} files)`);
  console.log('  [+] Execution log loaded');

  console.log(`\nSession: ${sessionId}`);

  // Phase 2: Analyzing Session
  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log('Phase 2: Analyzing Session');
  console.log('  [...] Sending to evaluation LLM...');

  const startTime = Date.now();

  const llmClient = new LLMClient(config.evaluationLlm);
  const { systemPrompt, userPrompt } = buildEvaluationPrompt(bundleData);

  const response = await llmClient.send({ systemPrompt, userPrompt });
  const evaluationResult = parseJsonResponse(response.content);

  // Validate response
  const validation = validateEvaluationResponse(evaluationResult);
  if (!validation.valid) {
    console.error('  [!]  Warning: LLM response validation issues:', validation.errors.join(', '));
  }

  const durationSec = (Date.now() - startTime) / 1000;
  console.log(`  [+] Analysis complete (${durationSec.toFixed(1)}s)`);

  // Phase 3: Generating Reports
  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log('Phase 3: Generating Reports');

  const reportGenerator = new ReportGenerator(outputDir);
  const metadata = {
    evaluatedAt: new Date().toISOString(),
    version: '1.0.0',
    modelUsed: response.model || config.evaluationLlm.model,
    tokenUsage: response.usage,
    durationMs: Date.now() - startTime
  };

  const files = await reportGenerator.generateAll(sessionId, evaluationResult, metadata);

  console.log('  [+] evaluation-report.md generated');
  console.log('  [+] evaluation-report.json generated');
  
  if (!args['no-learnings']) {
    console.log('  [+] learnings.md generated');
  }
  
  if (!args['no-recommendations']) {
    console.log('  [+] recommendations/tool-router.md generated');
    console.log('  [+] recommendations/requirements.md generated');
    console.log('  [+] recommendations/language.md generated');
  }

  // Display Results
  const score = evaluationResult.qualityScore;
  const breakdown = score.breakdown || {};

  console.log(`
══════════════════════════════════════════════════════════════════════
Evaluation Complete!

┌─────────────────────────────────────────────────────────────────────┐
│                         Quality Score                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Overall: ${score.overall}/100 (${score.grade} - ${score.grade === 'A' ? 'Excellent' : score.grade === 'B' ? 'Good' : score.grade === 'C' ? 'Satisfactory' : score.grade === 'D' ? 'Needs Improvement' : 'Unsatisfactory'})${' '.repeat(Math.max(0, 30 - String(score.overall).length))}│
│                                                                      │
│   Task Completion:     ${(breakdown.taskCompletion?.score || 0).toString().padEnd(3)}/100  ${printScoreBar(breakdown.taskCompletion?.score || 0)}  (${(breakdown.taskCompletion?.weighted || 0).toFixed(1).padStart(4)})   │
│   Output Quality:      ${(breakdown.outputQuality?.score || 0).toString().padEnd(3)}/100  ${printScoreBar(breakdown.outputQuality?.score || 0)}  (${(breakdown.outputQuality?.weighted || 0).toFixed(1).padStart(4)})   │
│   Tool Utilization:    ${(breakdown.toolUtilization?.score || 0).toString().padEnd(3)}/100  ${printScoreBar(breakdown.toolUtilization?.score || 0)}  (${(breakdown.toolUtilization?.weighted || 0).toFixed(1).padStart(4)})   │
│   Goal Alignment:      ${(breakdown.goalAlignment?.score || 0).toString().padEnd(3)}/100  ${printScoreBar(breakdown.goalAlignment?.score || 0)}  (${(breakdown.goalAlignment?.weighted || 0).toFixed(1).padStart(4)})   │
│   Process Efficiency:  ${(breakdown.processEfficiency?.score || 0).toString().padEnd(3)}/100  ${printScoreBar(breakdown.processEfficiency?.score || 0)}  (${(breakdown.processEfficiency?.weighted || 0).toFixed(1).padStart(4)})   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

Key Findings:
  [#] ${evaluationResult.toolRouterRecommendations?.featureRequests?.length || 0} feature requests for tool router
  [!]  ${evaluationResult.requirementsAnalysis?.unclearRequirements?.length || 0} unclear requirements identified
  [*] ${evaluationResult.learningsSummary?.keyLearnings?.length || 0} key learnings extracted
  [>] ${evaluationResult.learningsSummary?.actionItems?.length || 0} action items generated

Reports saved to: ${outputDir}/${sessionId}/

══════════════════════════════════════════════════════════════════════
`);

  process.exit(0);
}

// Run
const args = parseArguments();
main(args).catch(err => {
  console.error(`Fatal error: ${err.message}`);
  if (err.details) {
    console.error(`Details: ${JSON.stringify(err.details)}`);
  }
  process.exit(1);
});
