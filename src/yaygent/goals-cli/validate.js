#!/usr/bin/env node

/**
 * @fileoverview Simple validation script to verify basic functionality
 * Run with: node validate.js
 */

import { GoalManager } from './lib/goal-manager.js';
import { ContextLoader } from './lib/context-loader.js';
import { parseArguments, validateRequiredArgs } from './lib/argument-parser.js';

async function main() {
  console.log('Goals CLI - Validation Script');
  console.log('==============================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Argument Parser
  console.log('Test 1: Argument Parser');
  try {
    const args = parseArguments(['-g', './goals.json', '-c', './context/']);
    if (args.goals === './goals.json' && args.context === './context/') {
      console.log('  ✓ Argument parsing works correctly');
      passed++;
    } else {
      throw new Error('Unexpected argument values');
    }
  } catch (err) {
    console.log('  ✗ Argument parsing failed:', err.message);
    failed++;
  }

  // Test 2: Goal Manager Validation
  console.log('\nTest 2: Goal Manager Validation');
  try {
    const manager = new GoalManager('./test/fixtures/valid-goals.json');
    const validDef = {
      version: '1.0',
      goals: [
        { id: 'test-goal', objective: 'A valid objective with enough characters' }
      ]
    };
    const result = manager.validate(validDef);
    if (result.valid) {
      console.log('  ✓ Validation logic works correctly');
      passed++;
    } else {
      throw new Error('Validation should have passed');
    }
  } catch (err) {
    console.log('  ✗ Validation failed:', err.message);
    failed++;
  }

  // Test 3: Goal Manager Invalid Detection
  console.log('\nTest 3: Invalid Goal Detection');
  try {
    const manager = new GoalManager('./test/fixtures/valid-goals.json');
    const invalidDef = {
      version: '1.0',
      goals: [
        { id: 'INVALID_ID', objective: 'short' }
      ]
    };
    const result = manager.validate(invalidDef);
    if (!result.valid && result.errors.length > 0) {
      console.log('  ✓ Invalid goals correctly detected');
      passed++;
    } else {
      throw new Error('Should have detected invalid goals');
    }
  } catch (err) {
    console.log('  ✗ Detection failed:', err.message);
    failed++;
  }

  // Test 4: Goal Loading
  console.log('\nTest 4: Goal Loading');
  try {
    const manager = new GoalManager('./test/fixtures/valid-goals.json');
    const goals = await manager.load();
    if (goals.goals && goals.goals.length > 0) {
      console.log(`  ✓ Loaded ${goals.goals.length} goals successfully`);
      passed++;
    } else {
      throw new Error('No goals loaded');
    }
  } catch (err) {
    console.log('  ✗ Goal loading failed:', err.message);
    failed++;
  }

  // Test 5: Context Loading
  console.log('\nTest 5: Context Loading');
  try {
    const loader = new ContextLoader('./test/fixtures/context');
    const bundle = await loader.load();
    if (bundle.files && bundle.files.length > 0) {
      console.log(`  ✓ Loaded ${bundle.files.length} context files successfully`);
      passed++;
    } else {
      throw new Error('No context files loaded');
    }
  } catch (err) {
    console.log('  ✗ Context loading failed:', err.message);
    failed++;
  }

  // Test 6: Context Formatting
  console.log('\nTest 6: Context Formatting');
  try {
    const loader = new ContextLoader('./test/fixtures/context');
    await loader.load();
    
    const xml = loader.getFormattedContext('xml');
    const md = loader.getFormattedContext('markdown');
    const json = loader.getFormattedContext('json');
    
    if (xml.includes('<context>') && md.includes('#') && json.includes('{')) {
      console.log('  ✓ All context formats work correctly');
      passed++;
    } else {
      throw new Error('Format output not as expected');
    }
  } catch (err) {
    console.log('  ✗ Context formatting failed:', err.message);
    failed++;
  }

  // Summary
  console.log('\n==============================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('\n✓ All validation tests passed!');
    console.log('\nThe Goals CLI component is ready for use.');
    console.log('Next: Run with your own goals and context:');
    console.log('  node goals-cli.js -g ./your-goals.json -c ./your-context/ --dry-run');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
