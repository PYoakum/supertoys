#!/usr/bin/env node

/**
 * @fileoverview Validation script for Goals Watcher Service
 */

import { DirectoryWatcher } from './lib/directory-watcher.js';
import { FileProcessor } from './lib/file-processor.js';
import { SessionClient } from './lib/session-client.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';

const TEST_DIR = './test-watch-dir';

async function setup() {
  await mkdir(TEST_DIR, { recursive: true });
  await mkdir(join(TEST_DIR, 'context'), { recursive: true });
}

async function cleanup() {
  await rm(TEST_DIR, { recursive: true, force: true });
}

async function main() {
  console.log('Goals Watcher Service - Validation Script');
  console.log('==========================================\n');

  let passed = 0;
  let failed = 0;

  await setup();

  // Test 1: Directory Watcher - Initialization
  console.log('Test 1: Directory Watcher - Initialization');
  try {
    const watcher = new DirectoryWatcher(TEST_DIR, {
      pollIntervalMs: 100,
      filePattern: '*.json'
    });
    
    const status = watcher.getStatus();
    if (status.watchPath !== TEST_DIR) throw new Error('Wrong watch path');
    if (status.running !== false) throw new Error('Should not be running yet');
    
    console.log('  [+] Directory watcher initializes correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Directory watcher init failed:', err.message);
    failed++;
  }

  // Test 2: Directory Watcher - File Detection
  console.log('\nTest 2: Directory Watcher - File Detection');
  try {
    const watcher = new DirectoryWatcher(TEST_DIR, {
      pollIntervalMs: 100,
      stabilityThresholdMs: 200,
      filePattern: '*.json'
    });

    let detected = false;
    let stable = false;

    watcher.on('detected', () => { detected = true; });
    watcher.on('stable', () => { stable = true; });

    await watcher.start();

    // Create a test file
    const testFile = join(TEST_DIR, 'test-goals.json');
    await writeFile(testFile, JSON.stringify({ version: '1.0', goals: [] }));

    // Wait for detection
    await new Promise(r => setTimeout(r, 500));

    watcher.stop();

    if (!detected) throw new Error('File not detected');
    if (!stable) throw new Error('File not marked stable');

    console.log('  [+] Directory watcher detects files correctly');
    passed++;
  } catch (err) {
    console.log('  [x] File detection failed:', err.message);
    failed++;
  }

  // Test 3: File Processor - Valid Goals
  console.log('\nTest 3: File Processor - Valid Goals');
  try {
    const processor = new FileProcessor({ moveProcessed: false });
    
    const goalsFile = join(TEST_DIR, 'valid-goals.json');
    await writeFile(goalsFile, JSON.stringify({
      version: '1.0',
      metadata: { name: 'Test' },
      goals: [
        { id: 'goal-1', objective: 'Test objective', priority: 1 }
      ]
    }, null, 2));

    const result = await processor.process(goalsFile);
    
    if (!result.goals) throw new Error('Goals not parsed');
    if (result.goals.goals.length !== 1) throw new Error('Wrong goals count');
    if (result.goals.goals[0].id !== 'goal-1') throw new Error('Wrong goal ID');

    console.log('  [+] File processor validates goals correctly');
    passed++;
  } catch (err) {
    console.log('  [x] File processor failed:', err.message);
    failed++;
  }

  // Test 4: File Processor - Invalid Goals
  console.log('\nTest 4: File Processor - Invalid Goals');
  try {
    const processor = new FileProcessor({ moveProcessed: false });
    
    const invalidFile = join(TEST_DIR, 'invalid-goals.json');
    await writeFile(invalidFile, JSON.stringify({
      version: '1.0',
      goals: []  // Empty goals array should fail
    }));

    let errorThrown = false;
    try {
      await processor.process(invalidFile);
    } catch (err) {
      errorThrown = true;
      if (!err.message.includes('at least one goal')) {
        throw new Error('Wrong error message');
      }
    }

    if (!errorThrown) throw new Error('Should have thrown validation error');

    console.log('  [+] File processor rejects invalid goals');
    passed++;
  } catch (err) {
    console.log('  [x] Invalid goals test failed:', err.message);
    failed++;
  }

  // Test 5: File Processor - Context Loading
  console.log('\nTest 5: File Processor - Context Loading');
  try {
    const processor = new FileProcessor({ 
      moveProcessed: false,
      includeContext: true,
      contextDirName: 'context'
    });
    
    // Create context file
    await writeFile(join(TEST_DIR, 'context', 'readme.md'), '# Test Context');
    
    const goalsFile = join(TEST_DIR, 'goals-with-context.json');
    await writeFile(goalsFile, JSON.stringify({
      version: '1.0',
      goals: [{ id: 'g1', objective: 'Test' }]
    }));

    const result = await processor.process(goalsFile);
    
    if (result.context.files.length === 0) throw new Error('Context not loaded');
    if (result.context.files[0].path !== 'readme.md') throw new Error('Wrong context file');

    console.log('  [+] File processor loads context correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Context loading failed:', err.message);
    failed++;
  }

  // Test 6: Session Client - Initialization
  console.log('\nTest 6: Session Client - Initialization');
  try {
    const client = new SessionClient({
      baseUrl: 'http://localhost:3000',
      timeout: 5000
    });

    if (!client.baseUrl) throw new Error('Base URL not set');
    
    console.log('  [+] Session client initializes correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Session client init failed:', err.message);
    failed++;
  }

  // Test 7: Pattern Matching
  console.log('\nTest 7: File Pattern Matching');
  try {
    const watcher = new DirectoryWatcher(TEST_DIR, {
      filePattern: '*.goals.json'
    });

    // Test internal pattern matching
    if (!watcher.matchesPattern('test.goals.json')) {
      throw new Error('Should match *.goals.json pattern');
    }
    if (watcher.matchesPattern('test.json')) {
      throw new Error('Should not match plain .json');
    }

    console.log('  [+] Pattern matching works correctly');
    passed++;
  } catch (err) {
    console.log('  [x] Pattern matching failed:', err.message);
    failed++;
  }

  // Cleanup
  await cleanup();

  // Summary
  console.log('\n==========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('\n[+] All validation tests passed!');
    console.log('\nUsage: node goals-watcher.js --watch ./inbox');
    console.log('Note: Requires a running Goals Session Server.');
    process.exit(0);
  } else {
    console.log('\n[x] Some tests failed.');
    process.exit(1);
  }
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await cleanup().catch(() => {});
  process.exit(1);
});