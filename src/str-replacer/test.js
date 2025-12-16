#!/usr/bin/env node

import { readFile } from 'fs/promises';
import { exit } from 'process';

/**
 * Test helper function
 */
function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Test failed: ${message}`);
    exit(1);
  }
}

/**
 * Apply replacements (copy from main file)
 */
function applyReplacements(text, config) {
  let result = text;

  for (const rule of config.replacements) {
    result = result.replaceAll(rule.from, rule.to);
  }

  return result;
}

/**
 * Run tests
 */
async function runTests() {
  console.log('Running tests...\n');

  // Test 1: Single replacement
  {
    const config = {
      replacements: [
        { from: 'hello', to: 'hi' }
      ]
    };
    const result = applyReplacements('hello world', config);
    assert(result === 'hi world', 'Single replacement');
    console.log('✓ Test 1: Single replacement');
  }

  // Test 2: Multiple replacements
  {
    const config = {
      replacements: [
        { from: 'foo', to: 'bar' },
        { from: 'baz', to: 'qux' }
      ]
    };
    const result = applyReplacements('foo and baz', config);
    assert(result === 'bar and qux', 'Multiple replacements');
    console.log('✓ Test 2: Multiple replacements');
  }

  // Test 3: Character replacement
  {
    const config = {
      replacements: [
        { from: 'a', to: '@' }
      ]
    };
    const result = applyReplacements('banana', config);
    assert(result === 'b@n@n@', 'Character replacement');
    console.log('✓ Test 3: Character replacement');
  }

  // Test 4: Multiple spaces
  {
    const config = {
      replacements: [
        { from: '  ', to: ' ' }
      ]
    };
    const result = applyReplacements('hello  world', config);
    assert(result === 'hello world', 'Multiple spaces replacement');
    console.log('✓ Test 4: Multiple spaces replacement');
  }

  // Test 5: Order matters
  {
    const config = {
      replacements: [
        { from: 'cat', to: 'dog' },
        { from: 'dog', to: 'bird' }
      ]
    };
    const result = applyReplacements('cat', config);
    assert(result === 'bird', 'Order of replacements matters');
    console.log('✓ Test 5: Order of replacements');
  }

  // Test 6: No replacement needed
  {
    const config = {
      replacements: [
        { from: 'xyz', to: 'abc' }
      ]
    };
    const result = applyReplacements('hello world', config);
    assert(result === 'hello world', 'No replacement when pattern not found');
    console.log('✓ Test 6: No replacement when pattern not found');
  }

  // Test 7: Empty replacement
  {
    const config = {
      replacements: [
        { from: 'hello', to: '' }
      ]
    };
    const result = applyReplacements('hello world', config);
    assert(result === ' world', 'Empty replacement (deletion)');
    console.log('✓ Test 7: Empty replacement (deletion)');
  }

  console.log('\n✅ All tests passed!');
}

runTests().catch(error => {
  console.error('Test error:', error);
  exit(1);
});