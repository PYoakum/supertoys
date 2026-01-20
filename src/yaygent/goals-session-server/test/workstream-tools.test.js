/**
 * @fileoverview Workstream Tools Test Suite
 * @module test/workstream-tools
 *
 * Tests the document processing and utility tools:
 * - docx_md: DOCX to Markdown conversion
 * - md_docx: Markdown to DOCX conversion
 * - token_replace: Template token replacement
 * - pdf_export: PDF export functionality
 * - framework_exec: Bun framework execution
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Import tools
import { SandboxManager } from '../lib/sandbox-manager.js';
import { DocxMdTool } from '../lib/docx-md-tool.js';
import { MdDocxTool } from '../lib/md-docx-tool.js';
import { TokenReplaceTool } from '../lib/token-replace-tool.js';
import { PdfExportTool } from '../lib/pdf-export-tool.js';
import { FrameworkExecTool } from '../lib/framework-exec-tool.js';
import { ComposeEmailTool } from '../lib/compose-email-tool.js';
import { GolangExecTool } from '../lib/golang-exec-tool.js';
import { ContextResearchBrowserTool } from '../lib/context-research-browser-tool.js';
import { TablemakerTool } from '../lib/tablemaker-tool.js';

// Test constants
const TEST_SESSION_ID = 'test-workstream-' + Date.now();
const TEST_SANDBOX_BASE = '/tmp/yaygent-test-sandbox';

// Shared instances
let sandboxManager;
let sandboxPath;

// Sample test content
const SAMPLE_MARKDOWN = `# Test Document

This is a **test document** with various _formatting_.

## Features List

- Bold text support
- Italic text support
- Code blocks
- Tables

## Code Example

\`\`\`javascript
function hello() {
  console.log('Hello, World!');
}
\`\`\`

## Data Table

| Name | Value | Status |
|------|-------|--------|
| Alpha | 100 | Active |
| Beta | 200 | Pending |
| Gamma | 300 | Complete |

## Conclusion

This document tests the markdown conversion pipeline.
`;

const SAMPLE_TEMPLATE = `Hello {{NAME}},

Welcome to {{COMPANY}}!

Your account ID is: {{ACCOUNT_ID}}

Best regards,
{{SENDER}}
`;

const SAMPLE_YAYMAP = `# Token replacement map
NAME=John Doe
COMPANY=Acme Corp
ACCOUNT_ID=AC-12345
SENDER=Support Team
`;

describe('Workstream Tools Test Suite', () => {

  beforeAll(async () => {
    // Create sandbox manager with test base directory
    sandboxManager = new SandboxManager({ baseDir: TEST_SANDBOX_BASE });
    sandboxPath = await sandboxManager.ensureSandbox(TEST_SESSION_ID);

    // Create test files in sandbox
    await writeFile(join(sandboxPath, 'sample.md'), SAMPLE_MARKDOWN);
    await writeFile(join(sandboxPath, 'template.txt'), SAMPLE_TEMPLATE);
    await writeFile(join(sandboxPath, 'tokens.yaymap'), SAMPLE_YAYMAP);

    console.log(`Test sandbox created: ${sandboxPath}`);
  });

  afterAll(async () => {
    // Cleanup test sandbox
    try {
      await rm(sandboxPath, { recursive: true, force: true });
      console.log('Test sandbox cleaned up');
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }
  });

  describe('TokenReplaceTool', () => {
    let tokenReplaceTool;

    beforeAll(() => {
      tokenReplaceTool = new TokenReplaceTool(sandboxManager);
    });

    test('should replace tokens from .yaymap file', async () => {
      const result = await tokenReplaceTool.execute({
        sessionId: TEST_SESSION_ID,
        mapPath: 'tokens.yaymap',
        inputPath: 'template.txt',
        outputPath: 'output-replaced.txt'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.replacementCount).toBeGreaterThan(0);

      // Verify output file
      const output = await readFile(join(sandboxPath, 'output-replaced.txt'), 'utf-8');
      expect(output).toContain('John Doe');
      expect(output).toContain('Acme Corp');
      expect(output).toContain('AC-12345');
      expect(output).not.toContain('{{NAME}}');
    });

    test('should support inline content with additionalTokens', async () => {
      const result = await tokenReplaceTool.execute({
        sessionId: TEST_SESSION_ID,
        inputContent: 'Hello {{USER}}, today is {{DAY}}.',
        additionalTokens: {
          USER: 'Alice',
          DAY: 'Monday'
        }
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toBe('Hello Alice, today is Monday.');
    });

    test('should support custom delimiters', async () => {
      const result = await tokenReplaceTool.execute({
        sessionId: TEST_SESSION_ID,
        inputContent: 'Hello $NAME$, welcome to $PLACE$.',
        delimiter: '$$',
        additionalTokens: {
          NAME: 'Bob',
          PLACE: 'Earth'
        }
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.result).toBe('Hello Bob, welcome to Earth.');
    });

    test('should handle missing sessionId', async () => {
      const result = await tokenReplaceTool.execute({
        inputContent: 'test'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('sessionId is required');
    });
  });

  describe('MdDocxTool', () => {
    let mdDocxTool;

    beforeAll(() => {
      mdDocxTool = new MdDocxTool(sandboxManager);
    });

    test('should convert markdown file to DOCX', async () => {
      const result = await mdDocxTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'sample.md',
        outputPath: 'sample.docx',
        title: 'Test Document',
        author: 'Test Runner'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.outputPath).toBe('sample.docx');
      expect(parsed.elementCount).toBeGreaterThan(0);

      // Verify DOCX file exists
      const docxPath = join(sandboxPath, 'sample.docx');
      expect(existsSync(docxPath)).toBe(true);

      // Verify it's a valid ZIP (DOCX is a ZIP file)
      const buffer = await readFile(docxPath);
      expect(buffer[0]).toBe(0x50); // 'P' in PK ZIP header
      expect(buffer[1]).toBe(0x4B); // 'K' in PK ZIP header
    });

    test('should convert inline markdown content to DOCX', async () => {
      const result = await mdDocxTool.execute({
        sessionId: TEST_SESSION_ID,
        inputContent: '# Hello\n\nThis is a **test**.',
        outputPath: 'inline-test.docx'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    test('should handle missing input', async () => {
      const result = await mdDocxTool.execute({
        sessionId: TEST_SESSION_ID
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('inputPath or inputContent is required');
    });
  });

  describe('PdfExportTool', () => {
    let pdfExportTool;

    beforeAll(() => {
      pdfExportTool = new PdfExportTool(sandboxManager);
    });

    test('should export markdown file to PDF', async () => {
      const result = await pdfExportTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'sample.md',
        outputPath: 'sample.pdf',
        title: 'Test PDF Document',
        author: 'Test Runner',
        pageSize: 'letter'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.outputPath).toBe('sample.pdf');
      expect(parsed.pageCount).toBeGreaterThan(0);

      // Verify PDF file exists
      const pdfPath = join(sandboxPath, 'sample.pdf');
      expect(existsSync(pdfPath)).toBe(true);

      // Verify PDF header
      const buffer = await readFile(pdfPath);
      const header = buffer.slice(0, 5).toString('utf-8');
      expect(header).toBe('%PDF-');
    });

    test('should export inline content to PDF', async () => {
      const result = await pdfExportTool.execute({
        sessionId: TEST_SESSION_ID,
        content: 'This is a test PDF with inline content.\n\nSecond paragraph here.',
        outputPath: 'inline.pdf',
        title: 'Inline Test'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    test('should support different page sizes', async () => {
      const result = await pdfExportTool.execute({
        sessionId: TEST_SESSION_ID,
        content: 'A4 page size test',
        outputPath: 'a4-test.pdf',
        pageSize: 'a4'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    test('should handle custom font size and margins', async () => {
      const result = await pdfExportTool.execute({
        sessionId: TEST_SESSION_ID,
        content: 'Custom formatting test with larger font.',
        outputPath: 'custom-format.pdf',
        fontSize: 14,
        margin: 72 // 1 inch
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });
  });

  describe('DocxMdTool', () => {
    let docxMdTool;

    beforeAll(() => {
      docxMdTool = new DocxMdTool(sandboxManager);
    });

    test('should convert DOCX to Markdown (roundtrip test)', async () => {
      // Use the DOCX created in the previous test
      const docxPath = join(sandboxPath, 'sample.docx');
      if (!existsSync(docxPath)) {
        console.warn('Skipping: sample.docx not found (run md_docx test first)');
        return;
      }

      const result = await docxMdTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'sample.docx',
        outputPath: 'roundtrip.md'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.outputPath).toBe('roundtrip.md');

      // Verify markdown output
      const mdOutput = await readFile(join(sandboxPath, 'roundtrip.md'), 'utf-8');
      expect(mdOutput.length).toBeGreaterThan(0);

      // Should contain some of the original content
      expect(mdOutput.toLowerCase()).toContain('test');
    });

    test('should handle missing DOCX file', async () => {
      const result = await docxMdTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'nonexistent.docx'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('FrameworkExecTool', () => {
    let frameworkExecTool;

    beforeAll(async () => {
      frameworkExecTool = new FrameworkExecTool(sandboxManager);

      // Create a minimal package.json for testing
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          test: 'echo "Tests passed!"',
          build: 'echo "Build complete!"'
        }
      };
      await writeFile(
        join(sandboxPath, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
    });

    test('should run test script', async () => {
      const result = await frameworkExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'test'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.output).toContain('Tests passed!');
    });

    test('should run build script', async () => {
      const result = await frameworkExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'build'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.output).toContain('Build complete!');
    });

    test('should run custom script', async () => {
      const result = await frameworkExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run-script',
        scriptName: 'test'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    test('should reject unknown action', async () => {
      const result = await frameworkExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'unknown-action'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unsupported action');
    });
  });

  describe('ComposeEmailTool', () => {
    let composeEmailTool;

    beforeAll(() => {
      composeEmailTool = new ComposeEmailTool(sandboxManager);
    });

    test('should create new email with placeholder addresses', async () => {
      const result = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'Test Email Subject',
        body: 'This is the initial body text.'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.notepad.to).toBe('RECIPIENT@RECIPIENT.RECEIVE');
      expect(parsed.notepad.from).toBe('SENDER@SENDER.SEND');
    });

    test('should append text to email body (streaming)', async () => {
      // First create a new email
      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'Streaming Test'
      });

      // Append text in multiple calls (simulating streaming)
      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'append',
        text: 'First paragraph of the email.'
      });

      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'append',
        text: 'Second paragraph with more content.'
      });

      // Get status
      const result = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'status'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.hasComposition).toBe(true);
      expect(parsed.email.bodyLength).toBeGreaterThan(50);
    });

    test('should update specific fields', async () => {
      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'Original Subject'
      });

      const result = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'set',
        field: 'subject',
        value: 'Updated Subject Line'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.field).toBe('subject');
    });

    test('should preview email in summary format', async () => {
      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'Preview Test',
        body: 'Body content for preview.',
        fromName: 'Test Sender',
        toName: 'Test Recipient'
      });

      const result = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'preview',
        format: 'summary'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.email.subject).toBe('Preview Test');
      expect(parsed.placeholderInfo.senderPlaceholder).toBe('SENDER@SENDER.SEND');
    });

    test('should export email as .eml file', async () => {
      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'Export Test Email',
        body: 'This email will be exported to .eml format.\n\nBest regards,\nThe Sender'
      });

      const result = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'export',
        filename: 'test-email.eml'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.outputPath).toBe('test-email.eml');

      // Verify .eml file exists and has correct format
      const emlPath = join(sandboxPath, 'test-email.eml');
      expect(existsSync(emlPath)).toBe(true);

      const emlContent = await readFile(emlPath, 'utf-8');
      expect(emlContent).toContain('From: SENDER@SENDER.SEND');
      expect(emlContent).toContain('To: RECIPIENT@RECIPIENT.RECEIVE');
      expect(emlContent).toContain('Subject: Export Test Email');
      expect(emlContent).toContain('MIME-Version: 1.0');
    });

    test('should support custom addresses instead of placeholders', async () => {
      const result = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'Custom Address Test',
        to: 'john@example.com',
        from: 'jane@company.org',
        toName: 'John Doe',
        fromName: 'Jane Smith',
        usePlaceholders: false
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.notepad.to).toBe('john@example.com');
      expect(parsed.notepad.from).toBe('jane@company.org');
    });

    test('should clear email composition', async () => {
      await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'compose',
        subject: 'To Be Cleared'
      });

      const clearResult = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'clear'
      });

      expect(clearResult.isError).toBeFalsy();

      const statusResult = await composeEmailTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'status'
      });

      const parsed = JSON.parse(statusResult.content[0].text);
      expect(parsed.hasComposition).toBe(false);
    });
  });

  describe('GolangExecTool', () => {
    let golangExecTool;

    beforeAll(() => {
      golangExecTool = new GolangExecTool(sandboxManager);
    });

    test('should run simple Go code', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run',
        code: `package main

import "fmt"

func main() {
    fmt.Println("Hello from Go!")
}`
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.stdout).toContain('Hello from Go!');
    });

    test('should run Go code with command-line arguments', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run',
        code: `package main

import (
    "fmt"
    "os"
)

func main() {
    for i, arg := range os.Args[1:] {
        fmt.Printf("Arg %d: %s\\n", i, arg)
    }
}`,
        args: ['hello', 'world', '123']
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.stdout).toContain('Arg 0: hello');
      expect(parsed.stdout).toContain('Arg 1: world');
    });

    test('should block unsafe imports', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run',
        code: `package main

import (
    "fmt"
    "os/exec"
)

func main() {
    cmd := exec.Command("ls")
    fmt.Println(cmd)
}`
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Blocked import');
    });

    test('should block syscall import', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run',
        code: `package main

import "syscall"

func main() {
    syscall.Exit(0)
}`
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Blocked import');
    });

    test('should block unsafe import', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run',
        code: `package main

import "unsafe"

func main() {
    var x int = 42
    _ = unsafe.Pointer(&x)
}`
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Blocked import');
    });

    test('should initialize Go module', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'mod-init',
        moduleName: 'test/mymodule',
        workingDir: 'go-test-project'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.moduleName).toBe('test/mymodule');
    });

    test('should format Go code', async () => {
      // First create an unformatted Go file
      const unformattedCode = `package main
import "fmt"
func main(){fmt.Println("unformatted")}`;

      await writeFile(join(sandboxPath, 'unformatted.go'), unformattedCode);

      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'fmt',
        filePath: 'unformatted.go'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.action).toBe('fmt');
    });

    test('should handle stdin input', async () => {
      const result = await golangExecTool.execute({
        sessionId: TEST_SESSION_ID,
        action: 'run',
        code: `package main

import (
    "bufio"
    "fmt"
    "os"
)

func main() {
    scanner := bufio.NewScanner(os.Stdin)
    for scanner.Scan() {
        fmt.Println("Received:", scanner.Text())
    }
}`,
        inputData: 'line1\nline2\nline3'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.stdout).toContain('Received: line1');
      expect(parsed.stdout).toContain('Received: line2');
    });

    test('should require sessionId', async () => {
      const result = await golangExecTool.execute({
        action: 'run',
        code: 'package main'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('sessionId is required');
    });
  });

  describe('ContextResearchBrowserTool', () => {
    let contextResearchTool;

    beforeAll(() => {
      contextResearchTool = new ContextResearchBrowserTool(sandboxManager, null, {
        allowedHosts: ['*'],
        timeout: 30000
      });
    });

    test('should require sessionId', async () => {
      const result = await contextResearchTool.execute({
        url: 'https://example.com'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('sessionId is required');
    });

    test('should require url', async () => {
      const result = await contextResearchTool.execute({
        sessionId: TEST_SESSION_ID
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('url is required');
    });

    test('should reject invalid URL', async () => {
      const result = await contextResearchTool.execute({
        sessionId: TEST_SESSION_ID,
        url: 'not-a-valid-url'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid URL');
    });

    test('should fetch and convert web content to markdown', async () => {
      const result = await contextResearchTool.execute({
        sessionId: TEST_SESSION_ID,
        url: 'https://example.com',
        filename: 'example-test.md',
        includeMetadata: true
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.outputPath).toBe('context/example-test.md');
      expect(parsed.contentLength).toBeGreaterThan(0);

      // Verify file was created
      const outputPath = join(sandboxPath, 'context', 'example-test.md');
      expect(existsSync(outputPath)).toBe(true);

      // Verify content has metadata header
      const content = await readFile(outputPath, 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('url:');
      expect(content).toContain('example.com');
    });

    test('should auto-generate filename from URL', async () => {
      const result = await contextResearchTool.execute({
        sessionId: TEST_SESSION_ID,
        url: 'https://httpbin.org/html'
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.outputPath).toMatch(/context\/.*\.md$/);
    });

    test('should respect host allowlist when configured', async () => {
      const restrictedTool = new ContextResearchBrowserTool(sandboxManager, null, {
        allowedHosts: ['allowed.com'],
        timeout: 10000
      });

      const result = await restrictedTool.execute({
        sessionId: TEST_SESSION_ID,
        url: 'https://blocked.com/page'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Host not allowed');
    });

    test('should support wildcard host patterns', async () => {
      const wildcardTool = new ContextResearchBrowserTool(sandboxManager, null, {
        allowedHosts: ['*.example.com'],
        timeout: 10000
      });

      // Should allow subdomain
      expect(wildcardTool.isHostAllowed('docs.example.com')).toBe(true);
      expect(wildcardTool.isHostAllowed('api.example.com')).toBe(true);

      // Should not allow different domain
      expect(wildcardTool.isHostAllowed('example.org')).toBe(false);
    });
  });

  describe('TablemakerTool', () => {
    let tablemakerTool;

    beforeAll(() => {
      tablemakerTool = new TablemakerTool(sandboxManager);
    });

    test('should create HTML table from JSON input', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/json-table.html',
        inputFormat: 'json',
        data: {
          headers: ['Name', 'Email', 'Status'],
          rows: [
            ['Alice', 'alice@example.com', 'Active'],
            ['Bob', 'bob@example.com', 'Pending'],
            ['Charlie', 'charlie@example.com', 'Inactive']
          ]
        },
        options: {
          title: 'User Directory',
          theme: 'default'
        }
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.rowCount).toBe(3);
      expect(parsed.columnCount).toBe(3);
      expect(parsed.headers).toEqual(['Name', 'Email', 'Status']);

      // Verify HTML file exists
      const htmlPath = join(sandboxPath, 'tables', 'json-table.html');
      expect(existsSync(htmlPath)).toBe(true);

      // Verify HTML content
      const htmlContent = await readFile(htmlPath, 'utf-8');
      expect(htmlContent).toContain('<!DOCTYPE html>');
      expect(htmlContent).toContain('User Directory');
      expect(htmlContent).toContain('Alice');
      expect(htmlContent).toContain('alice@example.com');
      expect(htmlContent).toContain('data-table');
    });

    test('should create HTML table from CSV input', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/csv-table.html',
        inputFormat: 'csv',
        data: `Product,Price,Quantity
Widget,25.00,100
Gadget,50.00,50
Gizmo,15.00,200`,
        options: {
          title: 'Inventory List',
          theme: 'minimal'
        }
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.rowCount).toBe(3);
      expect(parsed.columnCount).toBe(3);
      expect(parsed.headers).toEqual(['Product', 'Price', 'Quantity']);
    });

    test('should create HTML table from object array input', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/object-table.html',
        inputFormat: 'object',
        data: [
          { id: 1, task: 'Write tests', complete: true },
          { id: 2, task: 'Review code', complete: false },
          { id: 3, task: 'Deploy', complete: false }
        ],
        options: {
          title: 'Task List'
        }
      });

      expect(result.isError).toBeFalsy();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.rowCount).toBe(3);
      expect(parsed.headers).toContain('id');
      expect(parsed.headers).toContain('task');
      expect(parsed.headers).toContain('complete');
    });

    test('should support dark theme', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/dark-table.html',
        inputFormat: 'json',
        data: {
          headers: ['Col1', 'Col2'],
          rows: [['A', 'B']]
        },
        options: {
          title: 'Dark Theme Test',
          theme: 'dark'
        }
      });

      expect(result.isError).toBeFalsy();

      const htmlPath = join(sandboxPath, 'tables', 'dark-table.html');
      const htmlContent = await readFile(htmlPath, 'utf-8');
      expect(htmlContent).toContain('#1a1a2e'); // Dark theme background
    });

    test('should disable editable and sortable options', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/static-table.html',
        inputFormat: 'json',
        data: {
          headers: ['X', 'Y'],
          rows: [['1', '2']]
        },
        options: {
          title: 'Static Table',
          editable: false,
          sortable: false,
          exportCsv: false
        }
      });

      expect(result.isError).toBeFalsy();

      const htmlPath = join(sandboxPath, 'tables', 'static-table.html');
      const htmlContent = await readFile(htmlPath, 'utf-8');
      // Should not have input elements when not editable
      expect(htmlContent).not.toContain('<input type="text"');
      // Should not have sortable class when not sortable
      expect(htmlContent).not.toContain('class="sortable"');
      // Should not have export button
      expect(htmlContent).not.toContain('export-csv');
    });

    test('should handle CSV with quoted values', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/quoted-csv.html',
        inputFormat: 'csv',
        data: `Name,Description,Value
"Widget, Large","A large widget with ""special"" features",100
"Gadget",Simple gadget,50`,
        options: {
          title: 'Quoted CSV Test'
        }
      });

      expect(result.isError).toBeFalsy();

      const htmlPath = join(sandboxPath, 'tables', 'quoted-csv.html');
      const htmlContent = await readFile(htmlPath, 'utf-8');
      expect(htmlContent).toContain('Widget, Large');
      expect(htmlContent).toContain('&quot;special&quot;'); // Escaped quotes in HTML
    });

    test('should require path parameter', async () => {
      try {
        await tablemakerTool.execute({
          sessionId: TEST_SESSION_ID,
          data: { headers: ['A'], rows: [] }
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err.message).toContain('path is required');
      }
    });

    test('should require data parameter', async () => {
      try {
        await tablemakerTool.execute({
          sessionId: TEST_SESSION_ID,
          path: 'test.html'
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err.message).toContain('data is required');
      }
    });

    test('should reject invalid input format', async () => {
      try {
        await tablemakerTool.execute({
          sessionId: TEST_SESSION_ID,
          path: 'test.html',
          inputFormat: 'xml',
          data: '<data/>'
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err.message).toContain('Unknown input format');
      }
    });

    test('should reject invalid JSON input (missing headers)', async () => {
      try {
        await tablemakerTool.execute({
          sessionId: TEST_SESSION_ID,
          path: 'test.html',
          inputFormat: 'json',
          data: { rows: [['a', 'b']] }
        });
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err.message).toContain('headers');
      }
    });

    test('should escape HTML in cell values', async () => {
      const result = await tablemakerTool.execute({
        sessionId: TEST_SESSION_ID,
        path: 'tables/escaped-table.html',
        inputFormat: 'json',
        data: {
          headers: ['Script Test'],
          rows: [['<script>alert("xss")</script>']]
        }
      });

      expect(result.isError).toBeFalsy();

      const htmlPath = join(sandboxPath, 'tables', 'escaped-table.html');
      const htmlContent = await readFile(htmlPath, 'utf-8');
      // The cell value should be escaped (page itself has legit script tags)
      expect(htmlContent).toContain('&lt;script&gt;alert');
      // Verify no unescaped alert() in table values
      expect(htmlContent).not.toContain('value="<script>');
    });
  });

  describe('Integration: Document Processing Pipeline', () => {

    test('should complete full document pipeline: MD -> DOCX -> MD -> PDF', async () => {
      const mdDocxTool = new MdDocxTool(sandboxManager);
      const docxMdTool = new DocxMdTool(sandboxManager);
      const pdfExportTool = new PdfExportTool(sandboxManager);

      // Step 1: Create source markdown
      const sourceContent = `# Pipeline Test

This document will go through the full conversion pipeline.

## Step by Step

1. Start as Markdown
2. Convert to DOCX
3. Convert back to Markdown
4. Export to PDF

## Verification

If all steps complete, the pipeline is working correctly.
`;
      await writeFile(join(sandboxPath, 'pipeline-source.md'), sourceContent);

      // Step 2: MD -> DOCX
      const step1 = await mdDocxTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'pipeline-source.md',
        outputPath: 'pipeline-step1.docx',
        title: 'Pipeline Test Document'
      });
      expect(step1.isError).toBeFalsy();
      console.log('  Step 1: MD -> DOCX [+]');

      // Step 3: DOCX -> MD
      const step2 = await docxMdTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'pipeline-step1.docx',
        outputPath: 'pipeline-step2.md'
      });
      expect(step2.isError).toBeFalsy();
      console.log('  Step 2: DOCX -> MD [+]');

      // Step 4: MD -> PDF
      const step3 = await pdfExportTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'pipeline-step2.md',
        outputPath: 'pipeline-final.pdf',
        title: 'Pipeline Final Output'
      });
      expect(step3.isError).toBeFalsy();
      console.log('  Step 3: MD -> PDF [+]');

      // Verify all outputs exist
      expect(existsSync(join(sandboxPath, 'pipeline-step1.docx'))).toBe(true);
      expect(existsSync(join(sandboxPath, 'pipeline-step2.md'))).toBe(true);
      expect(existsSync(join(sandboxPath, 'pipeline-final.pdf'))).toBe(true);

      console.log('  Pipeline complete [+]');
    });

    test('should complete template processing pipeline: tokens + export', async () => {
      const tokenReplaceTool = new TokenReplaceTool(sandboxManager);
      const pdfExportTool = new PdfExportTool(sandboxManager);

      // Step 1: Create template and tokens
      const template = `# Invoice for {{CUSTOMER}}

Date: {{DATE}}
Invoice #: {{INVOICE_ID}}

## Items

{{ITEMS}}

## Total: {{TOTAL}}

Thank you for your business!
`;

      const tokens = `CUSTOMER=Acme Corporation
DATE=2025-01-15
INVOICE_ID=INV-2025-001
ITEMS=Widget Pro x 10 @ $25.00 = $250.00
TOTAL=$250.00
`;

      await writeFile(join(sandboxPath, 'invoice-template.md'), template);
      await writeFile(join(sandboxPath, 'invoice-tokens.yaymap'), tokens);

      // Step 2: Replace tokens
      const step1 = await tokenReplaceTool.execute({
        sessionId: TEST_SESSION_ID,
        mapPath: 'invoice-tokens.yaymap',
        inputPath: 'invoice-template.md',
        outputPath: 'invoice-filled.md'
      });
      expect(step1.isError).toBeFalsy();
      console.log('  Step 1: Token replacement [+]');

      // Verify token replacement
      const filledContent = await readFile(join(sandboxPath, 'invoice-filled.md'), 'utf-8');
      expect(filledContent).toContain('Acme Corporation');
      expect(filledContent).toContain('INV-2025-001');
      expect(filledContent).not.toContain('{{CUSTOMER}}');

      // Step 3: Export to PDF
      const step2 = await pdfExportTool.execute({
        sessionId: TEST_SESSION_ID,
        inputPath: 'invoice-filled.md',
        outputPath: 'invoice-final.pdf',
        title: 'Invoice INV-2025-001'
      });
      expect(step2.isError).toBeFalsy();
      console.log('  Step 2: PDF export [+]');

      // Verify PDF exists
      expect(existsSync(join(sandboxPath, 'invoice-final.pdf'))).toBe(true);

      console.log('  Template pipeline complete [+]');
    });
  });
});

// Run summary
console.log('\n=== Workstream Tools Test Suite ===\n');
console.log('Testing document processing tools:');
console.log('  - TokenReplaceTool (.yaymap token replacement)');
console.log('  - MdDocxTool (Markdown to DOCX)');
console.log('  - DocxMdTool (DOCX to Markdown)');
console.log('  - PdfExportTool (PDF generation)');
console.log('  - FrameworkExecTool (Bun framework execution)');
console.log('  - ComposeEmailTool (Email composition with .eml export)');
console.log('  - GolangExecTool (Go code execution with sandbox)');
console.log('  - ContextResearchBrowserTool (Web research to context)');
console.log('  - TablemakerTool (HTML table generation from JSON/CSV/objects)');
console.log('\nPlaceholder addresses for email:');
console.log('  - Sender: SENDER@SENDER.SEND');
console.log('  - Recipient: RECIPIENT@RECIPIENT.RECEIVE');
console.log('\nGo security:');
console.log('  - Blocked: os/exec, syscall, unsafe, plugin, CGO');
console.log('\nContext Research:');
console.log('  - Fetches web pages with headless browser');
console.log('  - Converts to markdown and saves to context/');
console.log('\n');
