#!/usr/bin/env node

/**
 * @fileoverview Validation script for Goals Session Server
 */

import { SessionManager, SessionState, GoalState } from './lib/session-manager.js';
import { createToolRouter } from './lib/tool-router.js';
import { SessionStore } from './lib/session-store.js';

async function main() {
  console.log('Goals Session Server - Validation Script');
  console.log('=========================================\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Session Store
  console.log('Test 1: Session Store');
  try {
    const store = new SessionStore({ ttlMs: 60000 });
    const session = store.create({
      id: 'test-session-1',
      state: 'LOADED',
      goals: { items: [] },
      context: { files: [] }
    });
    if (session.id === 'test-session-1' && store.has('test-session-1')) {
      console.log('  ✓ Session store works correctly');
      passed++;
    } else {
      throw new Error('Session not created');
    }
    store.stopCleanup();
  } catch (err) {
    console.log('  ✗ Session store failed:', err.message);
    failed++;
  }

  // Test 2: Session Manager - Create Session
  console.log('\nTest 2: Session Manager - Create Session');
  try {
    const manager = new SessionManager();
    const session = manager.createSession({
      goals: {
        version: '1.0',
        goals: [
          { id: 'goal-1', objective: 'First test goal with enough text' },
          { id: 'goal-2', objective: 'Second test goal depends on first', dependencies: ['goal-1'] }
        ]
      },
      context: {
        files: [{ path: 'test.md', content: '# Test', extension: '.md', size: 6 }]
      }
    });
    if (session.id && session.state === SessionState.LOADED && session.goals.items.length === 2) {
      console.log(`  ✓ Session created: ${session.id}`);
      passed++;
    } else {
      throw new Error('Session not created correctly');
    }
    manager.shutdown();
  } catch (err) {
    console.log('  ✗ Session creation failed:', err.message);
    failed++;
  }

  // Test 3: Tool Router
  console.log('\nTest 3: Tool Router');
  try {
    const router = createToolRouter({ notepadDir: './test-notes' });
    const tools = router.getAllTools();
    if (tools.length >= 5 && router.hasTool('notepad_create')) {
      console.log(`  ✓ Tool router initialized with ${tools.length} tools`);
      passed++;
    } else {
      throw new Error('Tool router not initialized correctly');
    }
  } catch (err) {
    console.log('  ✗ Tool router failed:', err.message);
    failed++;
  }

  // Test 4: Tool Execution
  console.log('\nTest 4: Tool Execution');
  try {
    const router = createToolRouter({ notepadDir: './test-notes' });
    const result = await router.executeTool('notepad_create', {
      filename: 'test-note.txt',
      content: 'Test content'
    });
    if (result.content[0].text.includes('Successfully created')) {
      console.log('  ✓ Tool execution works correctly');
      passed++;
    } else {
      throw new Error('Unexpected result');
    }
    try { await router.executeTool('notepad_delete', { filename: 'test-note.txt' }); } catch (e) {}
  } catch (err) {
    console.log('  ✗ Tool execution failed:', err.message);
    failed++;
  }

  // Test 5: Tool Manifest
  console.log('\nTest 5: Tool Manifest');
  try {
    const router = createToolRouter();
    const manifest = router.getManifest();
    if (manifest.serverName === 'goals-session-server' && manifest.tools.length > 0) {
      console.log('  ✓ Tool manifest generated correctly');
      passed++;
    } else {
      throw new Error('Manifest format incorrect');
    }
  } catch (err) {
    console.log('  ✗ Tool manifest failed:', err.message);
    failed++;
  }

  // Test 6: Session Update Goal
  console.log('\nTest 6: Session Update Goal');
  try {
    const manager = new SessionManager();
    const session = manager.createSession({
      goals: { version: '1.0', goals: [{ id: 'test-goal', objective: 'Test goal with sufficient length' }] },
      context: { files: [] }
    });
    const updated = manager.updateGoal(session.id, 'test-goal', {
      status: { state: GoalState.IN_PROGRESS, progress: 50 }
    });
    const goal = updated.goals.items[0];
    if (goal.status.state === GoalState.IN_PROGRESS && goal.status.progress === 50) {
      console.log('  ✓ Goal update works correctly');
      passed++;
    } else {
      throw new Error('Goal not updated correctly');
    }
    manager.shutdown();
  } catch (err) {
    console.log('  ✗ Goal update failed:', err.message);
    failed++;
  }

  // Summary
  console.log('\n=========================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('\n✓ All validation tests passed!');
    console.log('\nStart the server with: node server.js');
    const { rm } = await import('fs/promises');
    try { await rm('./test-notes', { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
