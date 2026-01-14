# MCP Tool Requirements

This document specifies the requirements for three new MCP tools: `code_editor`, `file_create`, and `javascript_execute`.

## Overview

These tools share a **common sandbox workspace** per session, enabling coordinated file operations and code execution within an isolated environment. All tools use **VM-based isolation** for security.

---

## 1. code_editor

A utility that allows the MCP server to write and edit code files within a sandboxed environment.

### 1.1 Purpose

Provide a safe mechanism for creating, reading, updating, and managing code files without exposing the host file system.

### 1.2 Operations

| Operation | Description |
|-----------|-------------|
| `create` | Create a new file with optional initial content |
| `read` | Read the contents of an existing file |
| `write` | Overwrite a file with new content |
| `patch` | Apply a partial edit (line range or search/replace) |
| `delete` | Remove a file from the sandbox |
| `list` | List files in the sandbox (with optional glob pattern) |
| `stat` | Get file metadata (size, modified time, permissions) |

### 1.3 Input Schema

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "enum": ["create", "read", "write", "patch", "delete", "list", "stat"],
      "description": "The operation to perform"
    },
    "path": {
      "type": "string",
      "description": "Relative path within the sandbox (required for all except 'list')"
    },
    "content": {
      "type": "string",
      "description": "File content (for create/write operations)"
    },
    "patch": {
      "type": "object",
      "description": "Patch specification (for patch operation)",
      "properties": {
        "type": {
          "type": "string",
          "enum": ["line_range", "search_replace"],
          "description": "Type of patch to apply"
        },
        "startLine": {
          "type": "integer",
          "description": "Starting line number (1-indexed, for line_range)"
        },
        "endLine": {
          "type": "integer",
          "description": "Ending line number (inclusive, for line_range)"
        },
        "replacement": {
          "type": "string",
          "description": "Replacement content"
        },
        "search": {
          "type": "string",
          "description": "Text or regex pattern to find (for search_replace)"
        },
        "replaceAll": {
          "type": "boolean",
          "description": "Replace all occurrences (default: false)"
        }
      }
    },
    "pattern": {
      "type": "string",
      "description": "Glob pattern for list operation (default: '**/*')"
    },
    "encoding": {
      "type": "string",
      "enum": ["utf-8", "base64", "binary"],
      "default": "utf-8",
      "description": "Content encoding"
    }
  },
  "required": ["operation"]
}
```

### 1.4 Response Format

```json
{
  "success": true,
  "operation": "read",
  "path": "src/index.js",
  "data": {
    "content": "...",
    "encoding": "utf-8",
    "size": 1234,
    "modified": "2024-01-15T10:30:00Z"
  }
}
```

### 1.5 Security Constraints

- All paths must be relative and contained within the sandbox root
- Path traversal attempts (`../`) must be rejected
- Maximum file size: 10MB per file
- Maximum total sandbox size: 100MB
- Symlinks are not permitted
- Hidden files (`.` prefix) are allowed but configurable

### 1.6 Sandbox Isolation

- Uses VM-based isolation (isolated-vm or similar)
- Sandbox directory is session-scoped and ephemeral
- Files persist for the duration of the session
- Cleanup occurs on session termination or TTL expiry

---

## 2. file_create

A utility for creating files from various input data types within the shared sandbox.

### 2.1 Purpose

Provide flexible file creation supporting multiple input formats: strings, buffers, base64-encoded data, and streams.

### 2.2 Supported Input Types

| Type | Description |
|------|-------------|
| `string` | Plain text content (UTF-8) |
| `buffer` | Raw binary data (as array of bytes) |
| `base64` | Base64-encoded binary data |
| `json` | JSON object (serialized with optional formatting) |
| `stream` | Reference to a stream source (URL or stream ID) |

### 2.3 Input Schema

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Relative path for the new file"
    },
    "inputType": {
      "type": "string",
      "enum": ["string", "buffer", "base64", "json", "stream"],
      "default": "string",
      "description": "Type of input data"
    },
    "data": {
      "oneOf": [
        { "type": "string" },
        { "type": "array", "items": { "type": "integer", "minimum": 0, "maximum": 255 } },
        { "type": "object" }
      ],
      "description": "The content to write"
    },
    "options": {
      "type": "object",
      "properties": {
        "overwrite": {
          "type": "boolean",
          "default": false,
          "description": "Overwrite if file exists"
        },
        "createDirectories": {
          "type": "boolean",
          "default": true,
          "description": "Create parent directories if needed"
        },
        "mode": {
          "type": "string",
          "pattern": "^[0-7]{3,4}$",
          "default": "0644",
          "description": "File permissions (octal)"
        },
        "jsonIndent": {
          "type": "integer",
          "minimum": 0,
          "maximum": 8,
          "default": 2,
          "description": "JSON indentation spaces (for json inputType)"
        }
      }
    },
    "streamOptions": {
      "type": "object",
      "description": "Options for stream input type",
      "properties": {
        "url": {
          "type": "string",
          "format": "uri",
          "description": "URL to fetch content from"
        },
        "headers": {
          "type": "object",
          "description": "HTTP headers for URL fetch"
        },
        "maxSize": {
          "type": "integer",
          "description": "Maximum bytes to read from stream"
        },
        "timeout": {
          "type": "integer",
          "default": 30000,
          "description": "Stream timeout in milliseconds"
        }
      }
    }
  },
  "required": ["path", "data"]
}
```

### 2.4 Response Format

```json
{
  "success": true,
  "path": "assets/image.png",
  "size": 45678,
  "checksum": "sha256:abc123...",
  "created": "2024-01-15T10:30:00Z",
  "inputType": "base64"
}
```

### 2.5 Security Constraints

- All constraints from code_editor apply (path validation, size limits)
- Stream URLs must pass allowlist validation (configurable)
- Stream fetches subject to timeout and size limits
- No execution of fetched content

### 2.6 Error Handling

| Error Code | Description |
|------------|-------------|
| `FILE_EXISTS` | File exists and overwrite=false |
| `PATH_TRAVERSAL` | Attempted directory traversal |
| `SIZE_EXCEEDED` | File exceeds maximum size |
| `INVALID_INPUT` | Data doesn't match inputType |
| `STREAM_ERROR` | Failed to read from stream source |
| `QUOTA_EXCEEDED` | Sandbox storage quota exceeded |

---

## 3. javascript_execute

A multi-runtime JavaScript execution utility supporting Node.js, Bun, and Workerd (Cloudflare Workers runtime).

### 3.1 Purpose

Execute JavaScript code in isolated sandbox environments with configurable runtime, permissions, and resource limits.

### 3.2 Supported Runtimes

| Runtime | Description | Use Case |
|---------|-------------|----------|
| `node` | Node.js (v18+) | General purpose, npm ecosystem |
| `bun` | Bun runtime | Fast execution, TypeScript native |
| `workerd` | Cloudflare Workers | Edge-compatible, Web APIs |

### 3.3 Input Schema

```json
{
  "type": "object",
  "properties": {
    "runtime": {
      "type": "string",
      "enum": ["node", "bun", "workerd"],
      "default": "node",
      "description": "JavaScript runtime to use"
    },
    "code": {
      "type": "string",
      "description": "JavaScript code to execute"
    },
    "entryPoint": {
      "type": "string",
      "description": "Path to entry file in sandbox (alternative to inline code)"
    },
    "args": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Command-line arguments passed to script"
    },
    "env": {
      "type": "object",
      "additionalProperties": { "type": "string" },
      "description": "Environment variables"
    },
    "permissions": {
      "type": "object",
      "description": "Security permissions (configurable per execution)",
      "properties": {
        "network": {
          "type": "boolean",
          "default": false,
          "description": "Allow network access"
        },
        "fileSystem": {
          "type": "string",
          "enum": ["none", "read", "write"],
          "default": "read",
          "description": "File system access level (within sandbox only)"
        },
        "allowedHosts": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Allowlist of network hosts (when network=true)"
        },
        "allowedModules": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Allowlist of importable modules"
        },
        "denyModules": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Denylist of modules (child_process, fs by default)"
        }
      }
    },
    "limits": {
      "type": "object",
      "description": "Resource limits (configurable within max bounds)",
      "properties": {
        "timeout": {
          "type": "integer",
          "minimum": 100,
          "maximum": 300000,
          "default": 30000,
          "description": "Execution timeout in milliseconds"
        },
        "memory": {
          "type": "integer",
          "minimum": 16,
          "maximum": 2048,
          "default": 512,
          "description": "Memory limit in MB"
        },
        "cpu": {
          "type": "number",
          "minimum": 0.1,
          "maximum": 2.0,
          "default": 1.0,
          "description": "CPU limit (cores)"
        },
        "outputSize": {
          "type": "integer",
          "minimum": 1024,
          "maximum": 10485760,
          "default": 1048576,
          "description": "Maximum output size in bytes"
        }
      }
    },
    "input": {
      "type": "object",
      "description": "Input data passed to the script",
      "properties": {
        "stdin": {
          "type": "string",
          "description": "Data provided via stdin"
        },
        "globals": {
          "type": "object",
          "description": "Global variables injected into execution context"
        }
      }
    },
    "options": {
      "type": "object",
      "properties": {
        "typescript": {
          "type": "boolean",
          "default": false,
          "description": "Enable TypeScript (Bun native, transpiled for Node)"
        },
        "esm": {
          "type": "boolean",
          "default": true,
          "description": "Use ES modules (vs CommonJS)"
        },
        "captureConsole": {
          "type": "boolean",
          "default": true,
          "description": "Capture console.log/error output"
        },
        "returnValue": {
          "type": "boolean",
          "default": true,
          "description": "Capture and return the script's export/return value"
        }
      }
    }
  },
  "required": ["code"]
}
```

### 3.4 Response Format

```json
{
  "success": true,
  "runtime": "bun",
  "execution": {
    "exitCode": 0,
    "duration": 234,
    "timedOut": false
  },
  "output": {
    "stdout": "Hello, world!\n",
    "stderr": "",
    "console": [
      { "level": "log", "args": ["Hello, world!"], "timestamp": 1705312200000 }
    ],
    "returnValue": { "result": 42 }
  },
  "resources": {
    "memoryUsed": 45,
    "cpuTime": 12
  },
  "sandbox": {
    "filesModified": ["output.json"],
    "filesCreated": ["temp/data.txt"]
  }
}
```

### 3.5 Runtime-Specific Behavior

#### 3.5.1 Node.js

- Executed via `node` binary with `--experimental-vm-modules`
- Sandbox isolation via `vm` module with custom context
- Module resolution restricted to sandbox + allowed modules
- Default denied modules: `child_process`, `cluster`, `dgram`, `dns`, `net`, `tls`, `worker_threads`

#### 3.5.2 Bun

- Executed via `bun` binary
- Native TypeScript support without transpilation
- Faster startup and execution
- Uses Bun's built-in test runner if test files detected
- Default denied: `Bun.spawn`, `Bun.spawnSync`, `Bun.file` (outside sandbox)

#### 3.5.3 Workerd (Cloudflare)

- Executed via `workerd` or miniflare
- Web Platform APIs (fetch, Request, Response, etc.)
- No Node.js APIs unless polyfilled
- Automatic module bundling
- Simulates edge runtime environment
- 128MB memory limit (Cloudflare default)
- CPU time limits enforced

### 3.6 Security Model

```
┌─────────────────────────────────────────────────────────────┐
│                     Host System                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  VM Isolation Layer                     │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │              Sandbox Environment                  │  │ │
│  │  │  ┌─────────────┐  ┌─────────────┐               │  │ │
│  │  │  │   Sandbox   │  │   Runtime   │               │  │ │
│  │  │  │    Files    │◄─┤  (node/bun/ │               │  │ │
│  │  │  │             │  │   workerd)  │               │  │ │
│  │  │  └─────────────┘  └──────┬──────┘               │  │ │
│  │  │                          │                       │  │ │
│  │  │         ┌────────────────┴────────────────┐     │  │ │
│  │  │         │       Permission Gate           │     │  │ │
│  │  │         │  (network/fs/module checks)     │     │  │ │
│  │  │         └─────────────────────────────────┘     │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.7 Default Permission Profiles

| Profile | Network | FileSystem | Modules |
|---------|---------|------------|---------|
| `strict` | disabled | none | minimal (console, JSON, Math) |
| `sandbox` | disabled | read | safe stdlib (path, util, assert) |
| `standard` | disabled | write | most stdlib (no child_process, net) |
| `permissive` | enabled (allowlist) | write | all except dangerous |

### 3.8 Error Handling

| Error Code | Description |
|------------|-------------|
| `SYNTAX_ERROR` | JavaScript syntax error |
| `RUNTIME_ERROR` | Uncaught exception during execution |
| `TIMEOUT` | Execution exceeded time limit |
| `MEMORY_EXCEEDED` | Memory limit exceeded |
| `PERMISSION_DENIED` | Attempted disallowed operation |
| `MODULE_NOT_ALLOWED` | Attempted to import blocked module |
| `NETWORK_BLOCKED` | Network access denied or host not in allowlist |
| `RUNTIME_UNAVAILABLE` | Requested runtime not installed |

---

## Shared Sandbox Architecture

### Session-Scoped Workspace

All three tools operate on a shared sandbox workspace that is:

1. **Session-scoped**: Created when session starts, destroyed on session end
2. **Isolated**: VM-based isolation prevents host system access
3. **Quota-managed**: Total storage limited (default 100MB)
4. **Ephemeral**: No persistence beyond session lifetime

### Workspace Structure

```
/sandbox/{session-id}/
├── src/           # Source code files (code_editor)
├── assets/        # Binary/data files (file_create)
├── output/        # Execution output (javascript_execute)
├── node_modules/  # Allowed dependencies (pre-populated or on-demand)
└── .sandbox/      # Metadata and state
    ├── manifest.json
    └── history.log
```

### Cross-Tool Operations

Example workflow:

1. `file_create` → Create `src/data.json` with input data
2. `code_editor` → Create `src/process.js` with processing logic
3. `javascript_execute` → Run `src/process.js` which reads `src/data.json`
4. `code_editor` → Read `output/result.json` created by script

---

## Implementation Notes

### Dependencies

- **isolated-vm**: VM isolation for Node.js
- **Bun**: Native runtime (if available)
- **miniflare/workerd**: Cloudflare Workers simulation

### Configuration

Tools should respect server-config.js settings:

```javascript
{
  sandbox: {
    baseDir: '/tmp/sandbox',
    maxSizeBytes: 104857600,      // 100MB
    maxFileSize: 10485760,        // 10MB
    defaultTimeout: 30000,
    maxTimeout: 300000,
    defaultMemory: 512,
    maxMemory: 2048,
    allowedStreamHosts: ['*'],    // or specific hosts
    runtimes: {
      node: { enabled: true, path: 'node' },
      bun: { enabled: true, path: 'bun' },
      workerd: { enabled: true, path: 'workerd' }
    }
  }
}
```

### Error Response Format

All tools should return errors in MCP-compatible format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { }
  }
}
```

---

## Future Considerations

- **Persistent sandboxes**: Optional persistence across sessions
- **Snapshot/restore**: Save and restore sandbox state
- **Dependency management**: npm/yarn/pnpm integration for Node.js
- **Multi-file execution**: Project-based execution with package.json
- **WASM support**: WebAssembly execution in Workerd
- **Debugging**: Step-through debugging support
- **Streaming output**: Real-time stdout/stderr streaming
