#!/usr/bin/env node
/**
 * Test analyze_research and review_research tools
 * Tests the research analysis pipeline with mock session data
 */

import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

import { AnalyzeResearchTool } from '../lib/analyze-research-tool.js';
import { ReviewResearchTool } from '../lib/review-research-tool.js';
import { LLMClient } from '../lib/llm-client.js';

// Test constants
const TEST_SESSION_ID = 'test-research-' + Date.now();
const TEST_SANDBOX_BASE = '/tmp/yaygent-test-research';

// Sample research content (simulating context_research_browser output)
const SAMPLE_RESEARCH_1 = `---
title: "JavaScript Async/Await Guide"
url: "https://example.com/js-async"
fetched_at: "2025-01-18T10:00:00.000Z"
source: context_research_browser
---

# JavaScript Async/Await Guide

> Source: [https://example.com/js-async](https://example.com/js-async)

## Introduction

Async/await is a modern JavaScript feature that simplifies working with promises.
It makes asynchronous code look and behave more like synchronous code.

## Basic Syntax

\`\`\`javascript
async function fetchData() {
  const response = await fetch('/api/data');
  const data = await response.json();
  return data;
}
\`\`\`

## Error Handling

Use try/catch blocks to handle errors in async functions:

\`\`\`javascript
async function getData() {
  try {
    const result = await fetchData();
    console.log(result);
  } catch (error) {
    console.error('Failed:', error);
  }
}
\`\`\`

## Best Practices

- Always handle errors with try/catch
- Use Promise.all for parallel operations
- Avoid mixing callbacks and async/await
- Consider using async iterators for streams

## Conclusion

Async/await provides cleaner syntax for asynchronous operations.
`;

const SAMPLE_RESEARCH_2 = `---
title: "Node.js Event Loop Explained"
url: "https://example.com/node-event-loop"
fetched_at: "2025-01-18T10:05:00.000Z"
source: context_research_browser
---

# Node.js Event Loop Explained

> Source: [https://example.com/node-event-loop](https://example.com/node-event-loop)

## Overview

The event loop is what allows Node.js to perform non-blocking I/O operations.
It offloads operations to the system kernel whenever possible.

## Phases

1. **Timers** - executes callbacks scheduled by setTimeout and setInterval
2. **Pending callbacks** - executes I/O callbacks deferred to the next loop iteration
3. **Idle, prepare** - only used internally
4. **Poll** - retrieve new I/O events
5. **Check** - setImmediate callbacks
6. **Close callbacks** - close event callbacks

## Code Example

\`\`\`javascript
console.log('Start');

setTimeout(() => console.log('Timeout'), 0);
setImmediate(() => console.log('Immediate'));

process.nextTick(() => console.log('NextTick'));

console.log('End');
\`\`\`

Output order: Start, End, NextTick, Timeout/Immediate (order may vary)

## References

- [Node.js Documentation](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick)
- [Event Loop Visualizer](https://example.com/visualizer)
`;

/**
 * Mock Session Manager for testing
 */
class MockSessionManager {
  constructor(sandboxPath) {
    this.sessions = new Map();
    this.sandboxPath = sandboxPath;
    this.store = {
      update: (sessionId, updates) => {
        const session = this.sessions.get(sessionId);
        if (session) {
          Object.assign(session, updates);
        }
      }
    };
  }

  createMockSession(sessionId, contextFiles = []) {
    const session = {
      id: sessionId,
      sandboxPath: this.sandboxPath,
      context: {
        files: contextFiles,
        metadata: {
          totalFiles: contextFiles.length,
          totalSize: contextFiles.reduce((sum, f) => sum + (f.size || 0), 0)
        }
      },
      notes: {}
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
}

/**
 * Create LLM client if API key available
 */
function createLLMClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new LLMClient({
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKey,
    model: 'claude-sonnet-4-20250514',
    parameters: { temperature: 0.3, maxTokens: 2048 }
  });
}

/**
 * Setup test environment
 */
async function setup() {
  const sandboxPath = join(TEST_SANDBOX_BASE, TEST_SESSION_ID);

  // Create directories
  await mkdir(join(sandboxPath, 'context'), { recursive: true });
  await mkdir(join(sandboxPath, 'artifacts'), { recursive: true });

  // Write sample research files
  await writeFile(
    join(sandboxPath, 'context', 'js-async-guide.md'),
    SAMPLE_RESEARCH_1,
    'utf-8'
  );
  await writeFile(
    join(sandboxPath, 'context', 'node-event-loop.md'),
    SAMPLE_RESEARCH_2,
    'utf-8'
  );

  // Create mock session manager
  const sessionManager = new MockSessionManager(sandboxPath);

  // Create session with research files
  sessionManager.createMockSession(TEST_SESSION_ID, [
    {
      path: 'context/js-async-guide.md',
      content: SAMPLE_RESEARCH_1,
      type: 'text/markdown',
      size: SAMPLE_RESEARCH_1.length,
      metadata: {
        sourceUrl: 'https://example.com/js-async',
        pageTitle: 'JavaScript Async/Await Guide',
        fetchedAt: '2025-01-18T10:00:00.000Z',
        tool: 'context_research_browser'
      }
    },
    {
      path: 'context/node-event-loop.md',
      content: SAMPLE_RESEARCH_2,
      type: 'text/markdown',
      size: SAMPLE_RESEARCH_2.length,
      metadata: {
        sourceUrl: 'https://example.com/node-event-loop',
        pageTitle: 'Node.js Event Loop Explained',
        fetchedAt: '2025-01-18T10:05:00.000Z',
        tool: 'context_research_browser'
      }
    }
  ]);

  return { sandboxPath, sessionManager };
}

/**
 * Cleanup test environment
 */
async function cleanup() {
  try {
    if (existsSync(TEST_SANDBOX_BASE)) {
      await rm(TEST_SANDBOX_BASE, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('Cleanup warning:', err.message);
  }
}

/**
 * Test analyze_research tool
 */
async function testAnalyzeResearch(sessionManager, llmClient) {
  console.log('\n=== Testing analyze_research ===\n');

  const tool = new AnalyzeResearchTool(sessionManager, {
    llmClient,
    maxIterations: 2,
    confidenceThreshold: 0.6
  });

  const result = await tool.handle({
    sessionId: TEST_SESSION_ID,
    include_raw: true
  }, null);

  // Parse result
  const data = JSON.parse(result.content[0].text);

  console.log('Result:');
  console.log('  Success:', data.success);
  console.log('  Analyzed count:', data.analyzed_count);
  console.log('  Artifacts dir:', data.artifacts_directory);
  console.log('  Raw research path:', data.raw_research_path);
  console.log('');

  if (data.results) {
    for (const item of data.results) {
      console.log(`  Item: ${item.source}`);
      console.log(`    Analysis file: ${item.analysis_file}`);
      console.log(`    Iterations: ${item.iterations}`);
      console.log(`    Confidence: ${item.confidence}`);
      console.log(`    Tags count: ${item.tags_count}`);
      console.log(`    Concepts count: ${item.concepts_count}`);
      console.log('');
    }
  }

  // Verify files were created
  const sandboxPath = sessionManager.sandboxPath;
  const rawResearchExists = existsSync(join(sandboxPath, 'artifacts', 'raw_research.md'));
  console.log('  raw_research.md exists:', rawResearchExists);

  // Check for analysis YAML files
  const analysisFiles = data.results?.map(r => r.analysis_file) || [];
  for (const af of analysisFiles) {
    const exists = existsSync(join(sandboxPath, af));
    console.log(`  ${af} exists:`, exists);

    if (exists) {
      const content = await readFile(join(sandboxPath, af), 'utf-8');
      console.log(`    Preview (first 500 chars):`);
      console.log('    ' + content.slice(0, 500).replace(/\n/g, '\n    '));
      console.log('');
    }
  }

  if (data.success && data.analyzed_count === 2) {
    console.log('✓ analyze_research PASSED\n');
    return true;
  } else {
    console.log('✗ analyze_research FAILED\n');
    return false;
  }
}

/**
 * Test review_research tool
 */
async function testReviewResearch(sessionManager, llmClient) {
  console.log('\n=== Testing review_research ===\n');

  const tool = new ReviewResearchTool(sessionManager, {
    llmClient,
    minRelevancyScore: 0.5
  });

  const result = await tool.handle({
    sessionId: TEST_SESSION_ID,
    intent: 'Learn about JavaScript asynchronous programming patterns and Node.js internals',
    include_item_reviews: true
  }, null);

  // Parse result
  const data = JSON.parse(result.content[0].text);

  console.log('Result:');
  console.log('  Success:', data.success);
  console.log('  Overall score:', data.overall_score?.toFixed(2));
  console.log('  Verdict:', data.verdict);
  console.log('  Summary:', data.summary);
  console.log('');

  if (data.criteria_scores) {
    console.log('  Criteria Scores:');
    for (const [key, value] of Object.entries(data.criteria_scores)) {
      console.log(`    ${key}: ${typeof value === 'number' ? value.toFixed(2) : value}`);
    }
    console.log('');
  }

  if (data.recommendations) {
    console.log('  Recommendations:');
    console.log(`    Keep: ${data.recommendations.keep_count} items`);
    console.log(`    Remove: ${data.recommendations.remove_count} items`);
    console.log('');
  }

  if (data.context_efficiency) {
    console.log('  Context Efficiency:');
    console.log(`    Total tokens estimate: ${data.context_efficiency.total_tokens_estimate}`);
    console.log(`    Recommended tokens: ${data.context_efficiency.recommended_tokens}`);
    console.log(`    Reduction possible: ${(data.context_efficiency.reduction_possible * 100).toFixed(1)}%`);
    console.log('');
  }

  if (data.item_reviews) {
    console.log('  Item Reviews:');
    for (const review of data.item_reviews) {
      console.log(`    ${review.source}:`);
      console.log(`      Score: ${review.score?.toFixed(2)}`);
      console.log(`      Keep: ${review.keep}`);
      if (review.strengths?.length) {
        console.log(`      Strengths: ${review.strengths.join(', ')}`);
      }
      if (review.weaknesses?.length) {
        console.log(`      Weaknesses: ${review.weaknesses.join(', ')}`);
      }
    }
    console.log('');
  }

  // Verify artifact was created
  const sandboxPath = sessionManager.sandboxPath;
  const reviewExists = existsSync(join(sandboxPath, 'artifacts', 'research_review.yml'));
  console.log('  research_review.yml exists:', reviewExists);

  if (reviewExists) {
    const content = await readFile(join(sandboxPath, 'artifacts', 'research_review.yml'), 'utf-8');
    console.log('  Preview (first 800 chars):');
    console.log('    ' + content.slice(0, 800).replace(/\n/g, '\n    '));
    console.log('');
  }

  if (data.success && data.overall_score !== undefined) {
    console.log('✓ review_research PASSED\n');
    return true;
  } else {
    console.log('✗ review_research FAILED\n');
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('Research Tools Test Suite');
  console.log('=========================\n');

  const llmClient = createLLMClient();
  if (llmClient) {
    console.log('LLM client: Enabled (using Anthropic API)');
  } else {
    console.log('LLM client: Disabled (no API key, using basic heuristics)');
  }

  let passed = 0;
  let failed = 0;

  try {
    const { sandboxPath, sessionManager } = await setup();
    console.log(`Test sandbox: ${sandboxPath}\n`);

    // Run tests
    if (await testAnalyzeResearch(sessionManager, llmClient)) {
      passed++;
    } else {
      failed++;
    }

    if (await testReviewResearch(sessionManager, llmClient)) {
      passed++;
    } else {
      failed++;
    }

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log('=========================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=========================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
