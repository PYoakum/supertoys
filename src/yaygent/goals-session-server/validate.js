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

  // Test 7: Code Editor - Create and Read
  console.log('\nTest 7: Code Editor - Create and Read');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Create a file
    const createResult = await router.executeTool('code_editor', {
      operation: 'create',
      path: 'test.js',
      content: 'console.log("hello");'
    });
    const createData = JSON.parse(createResult.content[0].text);
    if (!createData.success) throw new Error('Create failed');

    // Read the file
    const readResult = await router.executeTool('code_editor', {
      operation: 'read',
      path: 'test.js'
    });
    const readData = JSON.parse(readResult.content[0].text);
    if (readData.content === 'console.log("hello");') {
      console.log('  ✓ Code editor create/read works correctly');
      passed++;
    } else {
      throw new Error('Content mismatch');
    }
  } catch (err) {
    console.log('  ✗ Code editor create/read failed:', err.message);
    failed++;
  }

  // Test 8: Code Editor - Write and Patch
  console.log('\nTest 8: Code Editor - Write and Patch');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Write multi-line content
    await router.executeTool('code_editor', {
      operation: 'write',
      path: 'multi.js',
      content: 'line1\nline2\nline3\nline4'
    });

    // Patch using line_range
    const patchResult = await router.executeTool('code_editor', {
      operation: 'patch',
      path: 'multi.js',
      patch: {
        type: 'line_range',
        startLine: 2,
        endLine: 3,
        replacement: 'replaced'
      }
    });
    const patchData = JSON.parse(patchResult.content[0].text);

    // Read and verify
    const readResult = await router.executeTool('code_editor', {
      operation: 'read',
      path: 'multi.js'
    });
    const readData = JSON.parse(readResult.content[0].text);
    if (readData.content === 'line1\nreplaced\nline4') {
      console.log('  ✓ Code editor write/patch works correctly');
      passed++;
    } else {
      throw new Error(`Content mismatch: ${readData.content}`);
    }
  } catch (err) {
    console.log('  ✗ Code editor write/patch failed:', err.message);
    failed++;
  }

  // Test 9: Code Editor - List and Stat
  console.log('\nTest 9: Code Editor - List and Stat');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Create some files first for listing
    await router.executeTool('code_editor', {
      operation: 'write',
      path: 'list-test-1.js',
      content: 'file1'
    });
    await router.executeTool('code_editor', {
      operation: 'write',
      path: 'subdir/list-test-2.js',
      content: 'file2'
    });

    // List files
    const listResult = await router.executeTool('code_editor', {
      operation: 'list'
    });
    const listData = JSON.parse(listResult.content[0].text);
    if (listData.files.length >= 2) {
      console.log(`  ✓ Code editor list found ${listData.files.length} files`);
      passed++;
    } else {
      throw new Error(`Expected at least 2 files, got ${listData.files.length}`);
    }

    // Stat a file
    const statResult = await router.executeTool('code_editor', {
      operation: 'stat',
      path: 'list-test-1.js'
    });
    const statData = JSON.parse(statResult.content[0].text);
    if (statData.isFile && statData.size > 0) {
      console.log('  ✓ Code editor stat works correctly');
      passed++;
    } else {
      throw new Error('Stat returned unexpected data');
    }
  } catch (err) {
    console.log('  ✗ Code editor list/stat failed:', err.message);
    failed++;
  }

  // Test 10: Code Editor - Delete
  console.log('\nTest 10: Code Editor - Delete');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Create a file to delete
    await router.executeTool('code_editor', {
      operation: 'write',
      path: 'to-delete.js',
      content: 'delete me'
    });

    // Delete the file
    const deleteResult = await router.executeTool('code_editor', {
      operation: 'delete',
      path: 'to-delete.js'
    });
    const deleteData = JSON.parse(deleteResult.content[0].text);
    if (deleteData.deleted) {
      console.log('  ✓ Code editor delete works correctly');
      passed++;
    } else {
      throw new Error('Delete failed');
    }
  } catch (err) {
    console.log('  ✗ Code editor delete failed:', err.message);
    failed++;
  }

  // Test 11: Code Editor - Path Traversal Prevention
  console.log('\nTest 11: Code Editor - Path Traversal Prevention');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Attempt path traversal
    try {
      await router.executeTool('code_editor', {
        operation: 'read',
        path: '../../../etc/passwd'
      });
      console.log('  ✗ Path traversal was NOT blocked (security issue!)');
      failed++;
    } catch (err) {
      if (err.code === 'PATH_TRAVERSAL' || err.message.includes('traversal')) {
        console.log('  ✓ Path traversal correctly blocked');
        passed++;
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.log('  ✗ Path traversal test failed:', err.message);
    failed++;
  }

  // Test 12: File Create - String Input
  console.log('\nTest 12: File Create - String Input');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('file_create', {
      path: 'string-file.txt',
      inputType: 'string',
      data: 'Hello, World!'
    });
    const resultData = JSON.parse(result.content[0].text);
    if (resultData.success && resultData.checksum.startsWith('sha256:')) {
      console.log('  ✓ File create with string input works');
      passed++;
    } else {
      throw new Error('Unexpected result');
    }
  } catch (err) {
    console.log('  ✗ File create string failed:', err.message);
    failed++;
  }

  // Test 13: File Create - JSON Input
  console.log('\nTest 13: File Create - JSON Input');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('file_create', {
      path: 'data.json',
      inputType: 'json',
      data: { name: 'test', values: [1, 2, 3] },
      options: { jsonIndent: 2 }
    });
    const resultData = JSON.parse(result.content[0].text);

    // Verify content via code_editor
    const readResult = await router.executeTool('code_editor', {
      operation: 'read',
      path: 'data.json'
    });
    const readData = JSON.parse(readResult.content[0].text);
    const parsed = JSON.parse(readData.content);

    if (resultData.success && parsed.name === 'test' && parsed.values.length === 3) {
      console.log('  ✓ File create with JSON input works');
      passed++;
    } else {
      throw new Error('JSON content mismatch');
    }
  } catch (err) {
    console.log('  ✗ File create JSON failed:', err.message);
    failed++;
  }

  // Test 14: File Create - Base64 Input
  console.log('\nTest 14: File Create - Base64 Input');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // "Hello" in base64
    const base64Data = Buffer.from('Hello').toString('base64');
    const result = await router.executeTool('file_create', {
      path: 'binary-file.bin',
      inputType: 'base64',
      data: base64Data
    });
    const resultData = JSON.parse(result.content[0].text);

    // Verify content
    const readResult = await router.executeTool('code_editor', {
      operation: 'read',
      path: 'binary-file.bin'
    });
    const readData = JSON.parse(readResult.content[0].text);

    if (resultData.success && readData.content === 'Hello') {
      console.log('  ✓ File create with base64 input works');
      passed++;
    } else {
      throw new Error('Base64 content mismatch');
    }
  } catch (err) {
    console.log('  ✗ File create base64 failed:', err.message);
    failed++;
  }

  // Test 15: File Create - Buffer Input
  console.log('\nTest 15: File Create - Buffer Input');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Create file from byte array [72, 105] = "Hi"
    const result = await router.executeTool('file_create', {
      path: 'buffer-file.txt',
      inputType: 'buffer',
      data: [72, 105]
    });
    const resultData = JSON.parse(result.content[0].text);

    // Verify content
    const readResult = await router.executeTool('code_editor', {
      operation: 'read',
      path: 'buffer-file.txt'
    });
    const readData = JSON.parse(readResult.content[0].text);

    if (resultData.success && readData.content === 'Hi') {
      console.log('  ✓ File create with buffer input works');
      passed++;
    } else {
      throw new Error('Buffer content mismatch');
    }
  } catch (err) {
    console.log('  ✗ File create buffer failed:', err.message);
    failed++;
  }

  // Test 16: File Create - Overwrite Protection
  console.log('\nTest 16: File Create - Overwrite Protection');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Create initial file
    await router.executeTool('file_create', {
      path: 'no-overwrite.txt',
      inputType: 'string',
      data: 'original'
    });

    // Try to overwrite without flag
    try {
      await router.executeTool('file_create', {
        path: 'no-overwrite.txt',
        inputType: 'string',
        data: 'new content'
      });
      console.log('  ✗ Overwrite protection failed (should have thrown)');
      failed++;
    } catch (err) {
      if (err.code === 'FILE_EXISTS') {
        console.log('  ✓ Overwrite protection works correctly');
        passed++;
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.log('  ✗ Overwrite protection test failed:', err.message);
    failed++;
  }

  // Test 17: JavaScript Execute - Node.js
  console.log('\nTest 17: JavaScript Execute - Node.js');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('javascript_execute', {
      runtime: 'node',
      code: `
        const x = 2 + 2;
        console.log('Result:', x);
        return { answer: x };
      `,
      limits: { timeout: 5000 }
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.output?.returnValue?.answer === 4 &&
        resultData.execution?.exitCode === 0) {
      console.log('  ✓ JavaScript execute with Node.js works');
      passed++;
    } else {
      throw new Error('Unexpected result: ' + JSON.stringify(resultData));
    }
  } catch (err) {
    console.log('  ✗ JavaScript execute Node.js failed:', err.message);
    failed++;
  }

  // Test 18: JavaScript Execute - Bun
  console.log('\nTest 18: JavaScript Execute - Bun');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('javascript_execute', {
      runtime: 'bun',
      code: `
        const arr = [1, 2, 3, 4, 5];
        const sum = arr.reduce((a, b) => a + b, 0);
        console.log('Sum:', sum);
        return { sum };
      `,
      limits: { timeout: 5000 }
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.output?.returnValue?.sum === 15 &&
        resultData.execution?.exitCode === 0) {
      console.log('  ✓ JavaScript execute with Bun works');
      passed++;
    } else {
      throw new Error('Unexpected result: ' + JSON.stringify(resultData));
    }
  } catch (err) {
    console.log('  ✗ JavaScript execute Bun failed:', err.message);
    failed++;
  }

  // Test 19: JavaScript Execute - Console Capture
  console.log('\nTest 19: JavaScript Execute - Console Capture');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('javascript_execute', {
      runtime: 'node',
      code: `
        console.log('Hello');
        console.warn('Warning');
        console.error('Error');
      `,
      limits: { timeout: 5000 }
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.output?.console?.length === 3 &&
        resultData.output.console[0].level === 'log' &&
        resultData.output.console[1].level === 'warn' &&
        resultData.output.console[2].level === 'error') {
      console.log('  ✓ Console capture works correctly');
      passed++;
    } else {
      throw new Error('Console not captured correctly');
    }
  } catch (err) {
    console.log('  ✗ Console capture failed:', err.message);
    failed++;
  }

  // Test 20: JavaScript Execute - Timeout
  console.log('\nTest 20: JavaScript Execute - Timeout');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('javascript_execute', {
      runtime: 'node',
      code: `
        // Infinite loop
        while(true) {}
      `,
      limits: { timeout: 1000 }
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success && resultData.execution?.timedOut === true) {
      console.log('  ✓ Timeout works correctly');
      passed++;
    } else {
      throw new Error('Timeout not triggered');
    }
  } catch (err) {
    console.log('  ✗ Timeout test failed:', err.message);
    failed++;
  }

  // Test 21: SQLite Create
  console.log('\nTest 21: SQLite Create');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('sqlite_create', {
      path: 'test.db',
      options: {
        pragmas: { journal_mode: 'WAL' }
      }
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success && resultData.path === 'test.db') {
      console.log('  ✓ SQLite create works correctly');
      passed++;
    } else {
      throw new Error('Unexpected result');
    }
  } catch (err) {
    console.log('  ✗ SQLite create failed:', err.message);
    failed++;
  }

  // Test 22: Database Execute - Create Tables
  console.log('\nTest 22: Database Execute - Create Tables');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('database_execute', {
      path: 'test.db',
      statements: [
        `CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`,
        `CREATE INDEX idx_posts_user ON posts(user_id)`
      ]
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.schema.tables.includes('users') &&
        resultData.schema.tables.includes('posts') &&
        resultData.schema.indexes.includes('idx_posts_user')) {
      console.log('  ✓ Database execute creates tables and indexes');
      passed++;
    } else {
      throw new Error('Schema not created correctly');
    }
  } catch (err) {
    console.log('  ✗ Database execute failed:', err.message);
    failed++;
  }

  // Test 23: SQL Runner - INSERT
  console.log('\nTest 23: SQL Runner - INSERT');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('sql_runner', {
      path: 'test.db',
      query: 'INSERT INTO users (name, email) VALUES (?, ?)',
      params: ['Alice', 'alice@example.com']
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.queryType === 'INSERT' &&
        resultData.changes === 1 &&
        resultData.lastInsertRowid === 1) {
      console.log('  ✓ SQL Runner INSERT works correctly');
      passed++;
    } else {
      throw new Error('INSERT failed: ' + JSON.stringify(resultData));
    }
  } catch (err) {
    console.log('  ✗ SQL Runner INSERT failed:', err.message);
    failed++;
  }

  // Test 24: SQL Runner - SELECT
  console.log('\nTest 24: SQL Runner - SELECT');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    // Insert another user first
    await router.executeTool('sql_runner', {
      path: 'test.db',
      query: 'INSERT INTO users (name, email) VALUES (?, ?)',
      params: ['Bob', 'bob@example.com']
    });

    const result = await router.executeTool('sql_runner', {
      path: 'test.db',
      query: 'SELECT id, name, email FROM users ORDER BY id'
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.queryType === 'SELECT' &&
        resultData.rowCount === 2 &&
        resultData.rows[0].name === 'Alice' &&
        resultData.rows[1].name === 'Bob') {
      console.log('  ✓ SQL Runner SELECT works correctly');
      passed++;
    } else {
      throw new Error('SELECT failed: ' + JSON.stringify(resultData));
    }
  } catch (err) {
    console.log('  ✗ SQL Runner SELECT failed:', err.message);
    failed++;
  }

  // Test 25: SQL Runner - UPDATE
  console.log('\nTest 25: SQL Runner - UPDATE');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('sql_runner', {
      path: 'test.db',
      query: 'UPDATE users SET name = ? WHERE email = ?',
      params: ['Alice Smith', 'alice@example.com']
    });
    const resultData = JSON.parse(result.content[0].text);

    if (resultData.success &&
        resultData.queryType === 'UPDATE' &&
        resultData.changes === 1) {
      console.log('  ✓ SQL Runner UPDATE works correctly');
      passed++;
    } else {
      throw new Error('UPDATE failed');
    }
  } catch (err) {
    console.log('  ✗ SQL Runner UPDATE failed:', err.message);
    failed++;
  }

  // Test 26: SQL Runner - DELETE
  console.log('\nTest 26: SQL Runner - DELETE');
  try {
    const router = createToolRouter({ sandboxDir: './test-sandbox' });

    const result = await router.executeTool('sql_runner', {
      path: 'test.db',
      query: 'DELETE FROM users WHERE email = ?',
      params: ['bob@example.com']
    });
    const resultData = JSON.parse(result.content[0].text);

    // Verify deletion
    const selectResult = await router.executeTool('sql_runner', {
      path: 'test.db',
      query: 'SELECT COUNT(*) as count FROM users'
    });
    const selectData = JSON.parse(selectResult.content[0].text);

    if (resultData.success &&
        resultData.queryType === 'DELETE' &&
        resultData.changes === 1 &&
        selectData.rows[0].count === 1) {
      console.log('  ✓ SQL Runner DELETE works correctly');
      passed++;
    } else {
      throw new Error('DELETE failed');
    }
  } catch (err) {
    console.log('  ✗ SQL Runner DELETE failed:', err.message);
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
    try { await rm('./test-sandbox', { recursive: true, force: true }); } catch (e) {}
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
