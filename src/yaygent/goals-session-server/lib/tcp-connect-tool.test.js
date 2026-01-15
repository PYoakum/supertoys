/**
 * @fileoverview Tests for TCP Connect Tool
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { TcpConnectTool } from './tcp-connect-tool.js';

describe('TcpConnectTool', () => {
  describe('constructor', () => {
    test('uses default values when no config provided', () => {
      const tool = new TcpConnectTool();
      expect(tool.allowedHosts).toEqual([]);
      expect(tool.allowedPorts).toEqual([]);
      expect(tool.defaultTimeout).toBe(10000);
      expect(tool.defaultReadTimeout).toBe(5000);
      expect(tool.maxResponseSize).toBe(65536);
    });

    test('uses provided config values', () => {
      const tool = new TcpConnectTool({
        allowedHosts: ['localhost'],
        allowedPorts: [80, 443],
        defaultTimeout: 5000,
        defaultReadTimeout: 2000,
        maxResponseSize: 1024
      });
      expect(tool.allowedHosts).toEqual(['localhost']);
      expect(tool.allowedPorts).toEqual([80, 443]);
      expect(tool.defaultTimeout).toBe(5000);
      expect(tool.defaultReadTimeout).toBe(2000);
      expect(tool.maxResponseSize).toBe(1024);
    });
  });

  describe('isHostAllowed', () => {
    test('returns false when allowedHosts is empty', () => {
      const tool = new TcpConnectTool({ allowedHosts: [] });
      expect(tool.isHostAllowed('localhost')).toBe(false);
    });

    test('returns true when allowedHosts contains wildcard *', () => {
      const tool = new TcpConnectTool({ allowedHosts: ['*'] });
      expect(tool.isHostAllowed('localhost')).toBe(true);
      expect(tool.isHostAllowed('192.168.1.1')).toBe(true);
    });

    test('matches exact hostname', () => {
      const tool = new TcpConnectTool({ allowedHosts: ['localhost', '127.0.0.1'] });
      expect(tool.isHostAllowed('localhost')).toBe(true);
      expect(tool.isHostAllowed('127.0.0.1')).toBe(true);
      expect(tool.isHostAllowed('192.168.1.1')).toBe(false);
    });

    test('matches wildcard subdomain pattern', () => {
      const tool = new TcpConnectTool({ allowedHosts: ['*.internal.net'] });
      expect(tool.isHostAllowed('db.internal.net')).toBe(true);
      expect(tool.isHostAllowed('cache.internal.net')).toBe(true);
      expect(tool.isHostAllowed('internal.net')).toBe(true);
      expect(tool.isHostAllowed('external.net')).toBe(false);
    });
  });

  describe('isPortAllowed', () => {
    test('returns false when allowedPorts is empty', () => {
      const tool = new TcpConnectTool({ allowedPorts: [] });
      expect(tool.isPortAllowed(80)).toBe(false);
    });

    test('returns true when allowedPorts contains 0 (all ports)', () => {
      const tool = new TcpConnectTool({ allowedPorts: [0] });
      expect(tool.isPortAllowed(80)).toBe(true);
      expect(tool.isPortAllowed(443)).toBe(true);
      expect(tool.isPortAllowed(65535)).toBe(true);
    });

    test('matches specific ports', () => {
      const tool = new TcpConnectTool({ allowedPorts: [80, 443, 8080] });
      expect(tool.isPortAllowed(80)).toBe(true);
      expect(tool.isPortAllowed(443)).toBe(true);
      expect(tool.isPortAllowed(8080)).toBe(true);
      expect(tool.isPortAllowed(22)).toBe(false);
      expect(tool.isPortAllowed(3000)).toBe(false);
    });
  });

  describe('formatResponse', () => {
    test('formats data as MCP-compatible response', () => {
      const tool = new TcpConnectTool();
      const result = tool.formatResponse({ connected: true, host: 'localhost', port: 80 });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeUndefined();

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.connected).toBe(true);
      expect(parsed.host).toBe('localhost');
      expect(parsed.port).toBe(80);
    });
  });

  describe('formatError', () => {
    test('formats error as MCP-compatible response', () => {
      const tool = new TcpConnectTool();
      const result = tool.formatError('Connection refused');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBe(true);

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('Connection refused');
    });
  });

  describe('assembleResponse', () => {
    test('assembles chunks as utf8', () => {
      const tool = new TcpConnectTool();
      const chunks = [Buffer.from('Hello '), Buffer.from('World')];
      const result = tool.assembleResponse(chunks, 'utf8');
      expect(result).toBe('Hello World');
    });

    test('assembles chunks as hex', () => {
      const tool = new TcpConnectTool();
      const chunks = [Buffer.from([0x48, 0x69])];
      const result = tool.assembleResponse(chunks, 'hex');
      expect(result).toBe('4869');
    });

    test('assembles chunks as base64', () => {
      const tool = new TcpConnectTool();
      const chunks = [Buffer.from('Hi')];
      const result = tool.assembleResponse(chunks, 'base64');
      expect(result).toBe('SGk=');
    });
  });

  describe('execute', () => {
    let tool;

    beforeEach(() => {
      tool = new TcpConnectTool({
        allowedHosts: ['*'],
        allowedPorts: [0]
      });
    });

    test('returns error when host is missing', async () => {
      const result = await tool.execute({ port: 80 });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('host is required');
    });

    test('returns error when port is missing', async () => {
      const result = await tool.execute({ host: 'localhost' });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe('port is required');
    });

    test('returns error for invalid port range', async () => {
      const result = await tool.execute({ host: 'localhost', port: 70000 });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('port must be between');
    });

    test('returns error when host is not allowed', async () => {
      const restrictedTool = new TcpConnectTool({
        allowedHosts: ['localhost'],
        allowedPorts: [0]
      });
      const result = await restrictedTool.execute({ host: 'remote.server.com', port: 80 });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Host not allowed');
    });

    test('returns error when port is not allowed', async () => {
      const restrictedTool = new TcpConnectTool({
        allowedHosts: ['*'],
        allowedPorts: [80, 443]
      });
      const result = await restrictedTool.execute({ host: 'localhost', port: 22 });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Port not allowed');
    });

    test('returns error for invalid action', async () => {
      const result = await tool.execute({
        host: 'localhost',
        port: 80,
        action: 'invalid'
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('Invalid action');
    });

    test('returns error when data missing for send action', async () => {
      const result = await tool.execute({
        host: 'localhost',
        port: 80,
        action: 'send'
      });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain('data is required');
    });
  });

  describe('registerTools', () => {
    test('registers tcp_connect tool with router', () => {
      const tool = new TcpConnectTool();
      const mockRouter = {
        registeredTools: [],
        registerTool(name, handler, schema) {
          this.registeredTools.push({ name, handler, schema });
        }
      };

      tool.registerTools(mockRouter);

      expect(mockRouter.registeredTools).toHaveLength(1);
      expect(mockRouter.registeredTools[0].name).toBe('tcp_connect');
      expect(mockRouter.registeredTools[0].schema.name).toBe('tcp_connect');
      expect(mockRouter.registeredTools[0].schema.inputSchema.required).toContain('host');
      expect(mockRouter.registeredTools[0].schema.inputSchema.required).toContain('port');
    });
  });
});
