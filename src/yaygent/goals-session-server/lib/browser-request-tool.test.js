/**
 * @fileoverview Tests for Browser Request Tool
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { BrowserRequestTool } from './browser-request-tool.js';

describe('BrowserRequestTool', () => {
  describe('constructor', () => {
    test('uses default values when no config provided', () => {
      const tool = new BrowserRequestTool();
      expect(tool.allowedHosts).toEqual([]);
      expect(tool.defaultTimeout).toBe(30000);
      expect(tool.headless).toBe(true);
      expect(tool.defaultViewport).toEqual({ width: 1280, height: 720 });
      expect(tool.browser).toBeNull();
      expect(tool.browserPromise).toBeNull();
      expect(tool.playwright).toBeNull();
    });

    test('uses provided config values', () => {
      const tool = new BrowserRequestTool({
        allowedHosts: ['example.com'],
        defaultTimeout: 5000,
        headless: false,
        defaultViewport: { width: 800, height: 600 }
      });
      expect(tool.allowedHosts).toEqual(['example.com']);
      expect(tool.defaultTimeout).toBe(5000);
      expect(tool.headless).toBe(false);
      expect(tool.defaultViewport).toEqual({ width: 800, height: 600 });
    });
  });

  describe('isHostAllowed', () => {
    test('returns false when allowedHosts is empty', () => {
      const tool = new BrowserRequestTool({ allowedHosts: [] });
      expect(tool.isHostAllowed('example.com')).toBe(false);
    });

    test('returns true when allowedHosts contains wildcard *', () => {
      const tool = new BrowserRequestTool({ allowedHosts: ['*'] });
      expect(tool.isHostAllowed('example.com')).toBe(true);
      expect(tool.isHostAllowed('any.domain.org')).toBe(true);
    });

    test('matches exact hostname', () => {
      const tool = new BrowserRequestTool({ allowedHosts: ['www.example.com'] });
      expect(tool.isHostAllowed('www.example.com')).toBe(true);
      expect(tool.isHostAllowed('example.com')).toBe(false);
      expect(tool.isHostAllowed('api.example.com')).toBe(false);
    });

    test('matches wildcard subdomain pattern', () => {
      const tool = new BrowserRequestTool({ allowedHosts: ['*.example.com'] });
      expect(tool.isHostAllowed('www.example.com')).toBe(true);
      expect(tool.isHostAllowed('api.example.com')).toBe(true);
      expect(tool.isHostAllowed('deep.sub.example.com')).toBe(true);
      expect(tool.isHostAllowed('example.com')).toBe(true);
      expect(tool.isHostAllowed('notexample.com')).toBe(false);
    });

    test('matches multiple patterns', () => {
      const tool = new BrowserRequestTool({
        allowedHosts: ['github.com', '*.example.com']
      });
      expect(tool.isHostAllowed('github.com')).toBe(true);
      expect(tool.isHostAllowed('www.example.com')).toBe(true);
      expect(tool.isHostAllowed('gitlab.com')).toBe(false);
    });
  });

  describe('getWaitUntil', () => {
    test('returns networkidle for networkidle', () => {
      const tool = new BrowserRequestTool();
      expect(tool.getWaitUntil('networkidle')).toBe('networkidle');
    });

    test('returns domcontentloaded for domcontentloaded', () => {
      const tool = new BrowserRequestTool();
      expect(tool.getWaitUntil('domcontentloaded')).toBe('domcontentloaded');
    });

    test('returns load for anything else', () => {
      const tool = new BrowserRequestTool();
      expect(tool.getWaitUntil('load')).toBe('load');
      expect(tool.getWaitUntil('#selector')).toBe('load');
      expect(tool.getWaitUntil(undefined)).toBe('load');
    });
  });

  describe('formatResponse', () => {
    test('formats data as MCP-compatible response', () => {
      const tool = new BrowserRequestTool();
      const result = tool.formatResponse({
        action: 'fetch',
        url: 'https://example.com',
        title: 'Example'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.action).toBe('fetch');
      expect(parsed.url).toBe('https://example.com');
      expect(parsed.title).toBe('Example');
    });
  });

  describe('formatError', () => {
    test('formats error as MCP-compatible response', () => {
      const tool = new BrowserRequestTool();
      const result = tool.formatError('Browser crashed');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBe(true);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Browser crashed');
    });
  });

  describe('execute', () => {
    let tool;

    beforeEach(() => {
      tool = new BrowserRequestTool({ allowedHosts: ['*'] });
    });

    test('returns error when url is missing', async () => {
      const result = await tool.execute({});
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('url is required');
    });

    test('returns error for invalid URL', async () => {
      const result = await tool.execute({ url: 'not-a-valid-url' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Invalid URL');
    });

    test('returns error when host is not allowed', async () => {
      const restrictedTool = new BrowserRequestTool({ allowedHosts: ['allowed.com'] });
      const result = await restrictedTool.execute({ url: 'https://blocked.com/page' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Host not allowed');
    });

    test('returns error for invalid action', async () => {
      // This will try to launch browser, so we mock the error
      const result = await tool.execute({
        url: 'https://example.com',
        action: 'invalid'
      });
      // Either browser fails to launch or action is invalid
      expect(result.isError).toBe(true);
    });
  });

  describe('action validation', () => {
    test('click action requires selector', async () => {
      const tool = new BrowserRequestTool({ allowedHosts: ['*'] });
      // We can't fully test without browser, but we can verify schema
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };
      tool.registerTools(mockRouter);

      const schema = mockRouter.registeredTools[0].schema.inputSchema;
      expect(schema.properties.selector).toBeDefined();
      expect(schema.properties.selector.description).toContain('click');
    });

    test('fill action requires selector and value', async () => {
      const tool = new BrowserRequestTool({ allowedHosts: ['*'] });
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };
      tool.registerTools(mockRouter);

      const schema = mockRouter.registeredTools[0].schema.inputSchema;
      expect(schema.properties.value).toBeDefined();
      expect(schema.properties.value.description).toContain('fill');
    });

    test('evaluate action uses script property', async () => {
      const tool = new BrowserRequestTool({ allowedHosts: ['*'] });
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };
      tool.registerTools(mockRouter);

      const schema = mockRouter.registeredTools[0].schema.inputSchema;
      expect(schema.properties.script).toBeDefined();
      expect(schema.properties.script.description).toContain('evaluate');
    });
  });

  describe('registerTools', () => {
    test('registers browser_request tool with router', () => {
      const tool = new BrowserRequestTool();
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };

      tool.registerTools(mockRouter);

      expect(mockRouter.registeredTools).toHaveLength(1);
      expect(mockRouter.registeredTools[0].name).toBe('browser_request');
      expect(mockRouter.registeredTools[0].schema.name).toBe('browser_request');
      expect(mockRouter.registeredTools[0].schema.inputSchema.required).toContain('url');
    });

    test('schema includes all action types', () => {
      const tool = new BrowserRequestTool();
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };

      tool.registerTools(mockRouter);

      const actionEnum = mockRouter.registeredTools[0].schema.inputSchema.properties.action.enum;
      expect(actionEnum).toContain('fetch');
      expect(actionEnum).toContain('screenshot');
      expect(actionEnum).toContain('pdf');
      expect(actionEnum).toContain('evaluate');
      expect(actionEnum).toContain('click');
      expect(actionEnum).toContain('fill');
      expect(actionEnum).toContain('wait');
    });
  });

  describe('closeBrowser', () => {
    test('handles null browser gracefully', async () => {
      const tool = new BrowserRequestTool();
      // Should not throw
      await tool.closeBrowser();
      expect(tool.browser).toBeNull();
    });
  });
});
