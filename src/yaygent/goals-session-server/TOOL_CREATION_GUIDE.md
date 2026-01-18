# Tool Creation Guide for Goals Session Server

> **Claude Skill**: Use this guide when creating new tools for the goals-session-server MCP tool registry. This skill provides templates, patterns, and best practices for tool development.

## Quick Reference

| Task | Section |
|------|---------|
| Create a new tool | [Quick Start Template](#quick-start-template) |
| Add LLM pre-processing | [LLM Pre/Post-Processing](#llm-prepost-processing) |
| Work with files | [Sandbox-Integrated Tools](#2-sandbox-integrated-tools) |
| Call external commands | [External Dependencies](#3-tools-with-external-dependencies) |
| Define parameters | [Input Schema](#input-schema-json-schema) |
| Register the tool | [Registering Your Tool](#registering-your-tool) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      ToolRouter                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  tools: Map<name, {handler, schema}>                │   │
│  │  registerTool(name, handler, schema)                │   │
│  │  executeTool(name, args) → Promise<MCPResponse>     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  ┌──────────┐          ┌──────────┐          ┌──────────┐
  │ YourTool │          │ AnotherT │          │ MoreTool │
  │  .js     │          │  ool.js  │          │  s.js    │
  └──────────┘          └──────────┘          └──────────┘
```

---

## Quick Start Template

Copy this template and modify for your tool:

```javascript
/**
 * @fileoverview My Custom Tool
 * @module my-custom-tool
 */

/**
 * My Custom Tool
 */
export class MyCustomTool {
  /**
   * @param {Object} sessionManager - Session manager instance
   * @param {Object} [options]
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.timeout = options.timeout || 30000;
    // Add your configuration options here
  }

  /**
   * Main handler for tool execution
   * @param {Object} args - Arguments from tool call
   * @param {Object} session - Session object
   * @returns {Promise<Object>} Result object
   */
  async handle(args, session) {
    const { action, param1, param2 } = args;

    switch (action) {
      case 'do_something':
        return this._handleDoSomething(args, session);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async _handleDoSomething(args, session) {
    const { param1, param2 = 'default' } = args;

    if (!param1) {
      throw new Error('param1 is required');
    }

    // Your tool logic here
    const result = await this.processData(param1, param2);

    return {
      success: true,
      result: result,
      metadata: { duration: 123 }
    };
  }

  /**
   * Register tools with the router
   * @param {ToolRouter} router - Tool router instance
   */
  registerTools(router) {
    router.registerTool('my_custom_tool', this.handle.bind(this), {
      name: 'my_custom_tool',
      description: 'Brief description of what this tool does. Be specific about the ACTION it performs.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['do_something', 'do_other'],
            description: 'Action to perform'
          },
          param1: {
            type: 'string',
            description: 'Description of param1'
          },
          param2: {
            type: 'string',
            default: 'default',
            description: 'Optional parameter with default'
          }
        },
        required: ['action', 'param1']
      }
    });
  }
}

export default MyCustomTool;
```

---

## LLM Pre/Post-Processing

When your tool accepts free-form text input that an LLM might provide with extra prose or explanation, you can add LLM pre-processing to clean and normalize the input before processing.

### When to Use LLM Pre-Processing

- Input may contain prose mixed with structured data
- LLMs tend to "explain" their output instead of just providing it
- The tool requires a specific format that LLMs don't consistently follow
- You need to convert natural language descriptions into structured notation

### Pattern: LLM Input Extraction

Here's the pattern used by the MIDI tool to extract clean note notation from potentially messy input:

```javascript
export class MyTool {
  /**
   * @param {Object} sessionManager
   * @param {Object} options
   * @param {Object} options.llmClient - LLM client for pre-processing
   */
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.llmClient = options.llmClient || null;
  }

  /**
   * Set the LLM client (can be set after construction)
   */
  setLLMClient(llmClient) {
    this.llmClient = llmClient;
  }

  /**
   * Pre-process input using LLM to extract clean structured data
   * @param {string} input - Raw input that may contain prose
   * @param {string} [sessionId] - Session ID for logging
   * @returns {Promise<string>} - Clean, structured output
   */
  async _extractWithLLM(input, sessionId) {
    // Skip if no LLM client
    if (!this.llmClient) {
      return input;
    }

    // Skip if input already looks clean (avoid unnecessary LLM calls)
    if (this._isAlreadyClean(input)) {
      return input;
    }

    const systemPrompt = `You are a data extraction assistant. Your ONLY job is to extract [SPECIFIC FORMAT] from the user's input.

OUTPUT FORMAT:
- Return ONLY the extracted data, nothing else
- Format: [describe your expected format]

EXAMPLES:
Input: "[messy example]" → Output: "[clean example]"
Input: "[another example]" → Output: "[clean output]"

RULES:
1. If the input already contains valid data, extract and clean it
2. If the input describes what's needed, convert it to the format
3. NEVER output explanations, markdown, or prose
4. NEVER output anything except the formatted data
5. If you cannot determine the data, output a sensible default`;

    const userPrompt = `Extract [FORMAT] from this input:\n\n${input}`;

    try {
      const response = await this.llmClient.send({
        systemPrompt,
        userPrompt,
        sessionId,
        operation: 'input_extraction',
        parameters: {
          temperature: 0.3,  // Low temperature for consistency
          maxTokens: 1024
        }
      });

      // Clean any markdown artifacts
      const cleaned = response.content.trim()
        .replace(/^```[\w]*\n?/gm, '')
        .replace(/\n?```$/gm, '')
        .trim();

      return cleaned || input;
    } catch (err) {
      // Graceful fallback - use original input
      console.error('LLM extraction failed:', err.message);
      return input;
    }
  }

  /**
   * Check if input is already in the expected clean format
   */
  _isAlreadyClean(input) {
    // Implement format-specific detection
    // Return true to skip LLM preprocessing
    return /^[expected pattern]$/.test(input.trim());
  }

  async _handleProcess(args, session) {
    const { input_text, llm_preprocess = true } = args;

    // Pre-process with LLM if enabled
    let cleanedInput = input_text;
    let wasPreprocessed = false;

    if (llm_preprocess && this.llmClient) {
      cleanedInput = await this._extractWithLLM(input_text, session?.id);
      wasPreprocessed = cleanedInput !== input_text;
    }

    // Now process the clean input
    const result = this._processCleanInput(cleanedInput);

    return {
      success: true,
      result,
      preprocessed: wasPreprocessed,
      input_used: cleanedInput
    };
  }
}
```

### Real Example: MIDI Note Extraction

The `MidiMp3Tool` uses this pattern to handle input like:

**Input (messy):**
```
Play a simple C major chord followed by a G major chord, each held for a half note
```

**After LLM preprocessing:**
```
[C4 E4 G4]:h [G4 B4 D5]:h
```

The key elements:

1. **Detection**: Skip preprocessing for clean input
```javascript
// Quick check: if input matches expected pattern, skip LLM
const noteTokenPattern = /^(tempo:\d+\s*)?(\[?[A-Ga-g][#b]?\d...)+$/;
if (noteTokenPattern.test(trimmed)) {
  return input;  // Already clean
}
```

2. **Extraction prompt**: Be extremely specific
```javascript
const systemPrompt = `You are a MIDI note extraction assistant...

EXAMPLES:
Input: "Play a C major scale" → Output: "C4:q D4:q E4:q F4:q G4:q A4:q B4:q C5:q"

RULES:
...
5. If you cannot determine notes, output a simple C major chord: "[C4 E4 G4]:h"`;
```

3. **Fallback**: Always handle LLM failure gracefully
```javascript
} catch (err) {
  console.error('Extraction failed, using raw input:', err.message);
  return input;  // Use original
}
```

4. **Optional flag**: Let users disable preprocessing
```javascript
const { input_text, llm_preprocess = true } = args;
```

### Wiring the LLM Client

Pass the LLM client when creating the tool in `tool-router.js`:

```javascript
// In createToolRouter():
const myTool = new MyTool(options.sessionManager, {
  llmClient: options.llmClient  // Passed from server.js
});
myTool.registerTools(router);
```

The server already creates and passes the LLM client:

```javascript
// In server.js:
const toolRouter = createToolRouter({
  llmClient: llmClient,  // Already passed
  sessionManager: sessionManager
});
```

---

## Tool Categories

### 1. Standalone Tools (No Sandbox)

Tools that don't need file system isolation:

```javascript
export class HttpRequestTool {
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.allowedHosts = options.allowedHosts || [];
    this.defaultTimeout = options.defaultTimeout || 30000;
  }

  async handle(args, session) {
    const { url, method = 'GET', headers, body, timeout } = args;

    // Validate URL host
    const parsedUrl = new URL(url);
    if (!this.isHostAllowed(parsedUrl.hostname)) {
      throw new Error(`Host not allowed: ${parsedUrl.hostname}`);
    }

    // ... implementation
  }

  isHostAllowed(hostname) {
    if (this.allowedHosts.length === 0) return false;
    if (this.allowedHosts.includes('*')) return true;
    return this.allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === allowed;
    });
  }
}
```

### 2. Sandbox-Integrated Tools

Tools that work with files in isolated sandboxes:

```javascript
export class FileProcessorTool {
  /**
   * @param {SandboxManager} sandboxManager
   * @param {Object} [options]
   */
  constructor(sandboxManager, options = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required');
    }
    this.sandboxManager = sandboxManager;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024;
  }

  async handle(args, session) {
    const { path, operation } = args;
    const sessionId = session?.id || session?.sessionId;

    if (!sessionId) {
      throw new Error('sessionId is required for sandbox isolation');
    }

    // Get sandbox path and resolve file path safely
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    // Now work with absPath - guaranteed within sandbox
    // ...
  }
}
```

### 3. Tools with External Dependencies

Tools that spawn processes or use external programs:

```javascript
import { spawn } from 'child_process';

export class ExternalCommandTool {
  constructor(sandboxManager, options = {}) {
    this.sandboxManager = sandboxManager;
    this.timeout = options.timeout || 60000;
  }

  async handle(args, session) {
    const { command } = args;
    const sessionId = session?.id;
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('/bin/bash', ['-c', command], {
        cwd: sandboxPath,
        env: {
          ...process.env,
          HOME: process.env.HOME || '/tmp',
          SANDBOX_PATH: sandboxPath
        }
      });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Command timed out'));
      }, this.timeout);

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });
  }
}
```

---

## Input Schema (JSON Schema)

The `inputSchema` defines what parameters your tool accepts:

### Basic Types

```javascript
inputSchema: {
  type: 'object',
  properties: {
    // String
    name: {
      type: 'string',
      description: 'User name',
      minLength: 1,
      maxLength: 100
    },

    // Integer
    count: {
      type: 'integer',
      minimum: 1,
      maximum: 1000,
      default: 10
    },

    // Number (float)
    ratio: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },

    // Boolean
    verbose: {
      type: 'boolean',
      default: false
    },

    // Enum
    format: {
      type: 'string',
      enum: ['json', 'text', 'xml'],
      default: 'json'
    },

    // Array
    tags: {
      type: 'array',
      items: { type: 'string' }
    },

    // Union type
    data: {
      type: ['string', 'number'],
      description: 'Can be string or number'
    }
  },
  required: ['name']
}
```

### Writing Good Descriptions

Tool descriptions should be **action-oriented** and tell the LLM exactly what the tool does:

```javascript
// GOOD - Action-oriented, specific
description: 'CREATE AN AUDIO FILE (MP3/WAV) from note notation. Synthesizes notes into a playable audio file.'

// BAD - Vague, passive
description: 'A tool for working with music and audio files.'
```

Parameter descriptions should include format requirements:

```javascript
// GOOD - Includes format and examples
notes: {
  type: 'string',
  description: 'MIDI notes in format "C4:q D4:h". Letters A-G, octave 0-8, duration: w/h/q/e/s'
}

// BAD - No format info
notes: {
  type: 'string',
  description: 'The notes to play'
}
```

---

## Security Best Practices

### 1. Host/URL Allowlisting

```javascript
constructor(options) {
  this.allowedHosts = options.allowedHosts || [];  // Empty = deny all
}

isHostAllowed(hostname) {
  if (this.allowedHosts.length === 0) return false;
  if (this.allowedHosts.includes('*')) return true;
  return this.allowedHosts.some(allowed => {
    if (allowed.startsWith('*.')) {
      return hostname.endsWith(allowed.slice(1));
    }
    return hostname === allowed;
  });
}
```

### 2. Resource Limits

```javascript
const LIMITS = {
  timeout: 60000,
  maxOutput: 1024 * 1024,
  maxFileSize: 10 * 1024 * 1024
};

// Enforce limits
const effectiveTimeout = Math.min(args.timeout || LIMITS.timeout, LIMITS.timeout);
```

### 3. Path Traversal Prevention

Always use SandboxManager:

```javascript
// GOOD - sandbox validates path
const absPath = await this.sandboxManager.resolvePath(sessionId, userPath);

// BAD - allows ../../etc/passwd
const absPath = path.join(baseDir, userPath);
```

---

## Registering Your Tool

### 1. Create the Tool File

Save as `goals-session-server/lib/my-tool.js`

### 2. Add Import to tool-router.js

```javascript
import { MyTool } from './my-tool.js';
```

### 3. Add to createToolRouter()

```javascript
export function createToolRouter(options = {}) {
  // ... existing setup ...

  // Initialize and register your tool
  const myTool = new MyTool(options.sessionManager, {
    someOption: options.myToolOption || 'default',
    llmClient: options.llmClient  // If using LLM preprocessing
  });
  myTool.registerTools(router);

  return router;
}
```

### 4. Update Exports

Add your tool to the exports at the bottom of tool-router.js:

```javascript
export default { ToolRouter, ..., MyTool, createToolRouter };
```

---

## Testing Your Tool

### Unit Test Pattern

```javascript
#!/usr/bin/env node
import { MyTool } from '../lib/my-tool.js';

async function runTest() {
  console.log('Testing MyTool...\n');

  const tool = new MyTool(null, {});

  // Test case 1
  console.log('Test 1: Basic operation');
  const result = await tool.handle({
    action: 'do_something',
    param1: 'test'
  }, null);

  console.log('Result:', result);
  console.log(result.success ? '✓ PASS' : '✗ FAIL');
}

runTest();
```

### With LLM Preprocessing

```javascript
import { MyTool } from '../lib/my-tool.js';
import { LLMClient } from '../lib/llm-client.js';

async function runTest() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('SKIP: No API key');
    process.exit(0);
  }

  const llmClient = new LLMClient({
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKey,
    model: 'claude-sonnet-4-20250514'
  });

  const tool = new MyTool(null, { llmClient });

  // Test with messy input
  const result = await tool.handle({
    action: 'process',
    input_text: 'Some messy input with prose...'
  }, null);

  console.log('Preprocessed:', result.preprocessed);
  console.log('Input used:', result.input_used);
}

runTest();
```

---

## Summary Checklist

When creating a new tool:

- [ ] Create class with constructor accepting `(sessionManager, options)`
- [ ] Implement `handle(args, session)` as main entry point
- [ ] Implement `registerTools(router)` with JSON Schema
- [ ] Use action-oriented tool descriptions
- [ ] Add LLM preprocessing if input may contain prose
- [ ] Validate required parameters
- [ ] Handle errors gracefully (throw Error, don't return error objects)
- [ ] Implement security measures (allowlists, limits, path validation)
- [ ] Add import to tool-router.js
- [ ] Register in createToolRouter()
- [ ] Add to exports
- [ ] Write tests
