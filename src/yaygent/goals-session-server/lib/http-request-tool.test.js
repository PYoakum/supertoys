/**
 * @fileoverview Tests for HTTP Request Tool
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { HttpRequestTool } from './http-request-tool.js';

describe('HttpRequestTool', () => {
  describe('constructor', () => {
    test('uses default values when no config provided', () => {
      const tool = new HttpRequestTool();
      expect(tool.allowedHosts).toEqual([]);
      expect(tool.defaultTimeout).toBe(30000);
      expect(tool.maxResponseSize).toBe(10 * 1024 * 1024);
    });

    test('uses provided config values', () => {
      const tool = new HttpRequestTool({
        allowedHosts: ['example.com'],
        defaultTimeout: 5000,
        maxResponseSize: 1024
      });
      expect(tool.allowedHosts).toEqual(['example.com']);
      expect(tool.defaultTimeout).toBe(5000);
      expect(tool.maxResponseSize).toBe(1024);
    });
  });

  describe('isHostAllowed', () => {
    test('returns false when allowedHosts is empty', () => {
      const tool = new HttpRequestTool({ allowedHosts: [] });
      expect(tool.isHostAllowed('example.com')).toBe(false);
    });

    test('returns true when allowedHosts contains wildcard *', () => {
      const tool = new HttpRequestTool({ allowedHosts: ['*'] });
      expect(tool.isHostAllowed('example.com')).toBe(true);
      expect(tool.isHostAllowed('any.domain.org')).toBe(true);
    });

    test('matches exact hostname', () => {
      const tool = new HttpRequestTool({ allowedHosts: ['api.example.com'] });
      expect(tool.isHostAllowed('api.example.com')).toBe(true);
      expect(tool.isHostAllowed('example.com')).toBe(false);
      expect(tool.isHostAllowed('other.example.com')).toBe(false);
    });

    test('matches wildcard subdomain pattern', () => {
      const tool = new HttpRequestTool({ allowedHosts: ['*.example.com'] });
      expect(tool.isHostAllowed('api.example.com')).toBe(true);
      expect(tool.isHostAllowed('www.example.com')).toBe(true);
      expect(tool.isHostAllowed('sub.api.example.com')).toBe(true);
      expect(tool.isHostAllowed('example.com')).toBe(true);
      expect(tool.isHostAllowed('notexample.com')).toBe(false);
    });

    test('matches multiple patterns', () => {
      const tool = new HttpRequestTool({
        allowedHosts: ['api.github.com', '*.example.com']
      });
      expect(tool.isHostAllowed('api.github.com')).toBe(true);
      expect(tool.isHostAllowed('api.example.com')).toBe(true);
      expect(tool.isHostAllowed('github.com')).toBe(false);
    });
  });

  describe('formatResponse', () => {
    test('formats data as MCP-compatible response', () => {
      const tool = new HttpRequestTool();
      const result = tool.formatResponse({ status: 200, body: 'test' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe(200);
      expect(parsed.body).toBe('test');
    });
  });

  describe('formatError', () => {
    test('formats error as MCP-compatible response', () => {
      const tool = new HttpRequestTool();
      const result = tool.formatError('Something went wrong');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBe(true);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Something went wrong');
    });
  });

  describe('execute', () => {
    let tool;

    beforeEach(() => {
      tool = new HttpRequestTool({ allowedHosts: ['*'] });
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
      const restrictedTool = new HttpRequestTool({ allowedHosts: ['allowed.com'] });
      const result = await restrictedTool.execute({ url: 'https://blocked.com/api' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Host not allowed');
    });

    test('returns error for invalid responseType', async () => {
      const result = await tool.execute({
        url: 'https://example.com',
        responseType: 'invalid'
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Invalid responseType');
    });
  });

  describe('registerTools', () => {
    test('registers http_request tool with router', () => {
      const tool = new HttpRequestTool();
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };

      tool.registerTools(mockRouter);

      expect(mockRouter.registeredTools).toHaveLength(1);
      expect(mockRouter.registeredTools[0].name).toBe('http_request');
      expect(mockRouter.registeredTools[0].schema.name).toBe('http_request');
      expect(mockRouter.registeredTools[0].schema.inputSchema.required).toContain('url');
    });
  });
});
