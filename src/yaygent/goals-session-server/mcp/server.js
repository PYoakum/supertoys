/**
 * @fileoverview MCP Server setup for Goals Session Server
 * @module mcp/server
 */

import { createSessionTools } from './tools/session-tools.js';
import { createToolTools } from './tools/tool-tools.js';

/**
 * @typedef {Object} MCPServerConfig
 * @property {string} name - Server name
 * @property {string} version - Server version
 * @property {import('../lib/session-manager.js').SessionManager} sessionManager
 * @property {import('../lib/tool-router.js').ToolRouter} toolRouter
 */

/**
 * Create MCP server with all tools registered
 * @param {MCPServerConfig} config
 * @returns {Object} MCP server configuration
 */
export function createMCPServer(config) {
  const { name, version, sessionManager, toolRouter } = config;
  
  // Collect all tools
  const sessionTools = createSessionTools(sessionManager);
  const toolTools = createToolTools(toolRouter);
  
  const allTools = [...sessionTools, ...toolTools];
  
  // Build tool map for lookup
  const toolMap = new Map();
  for (const tool of allTools) {
    toolMap.set(tool.schema.name, tool);
  }
  
  return {
    name,
    version,
    
    /**
     * Get all tool schemas for ListTools response
     * @returns {Object[]}
     */
    getToolSchemas() {
      return allTools.map(t => t.schema);
    },
    
    /**
     * Execute a tool by name
     * @param {string} toolName
     * @param {Object} args
     * @returns {Promise<Object>}
     */
    async executeTool(toolName, args) {
      const tool = toolMap.get(toolName);
      
      if (!tool) {
        return {
          content: [{
            type: 'text',
            text: `Tool not found: ${toolName}`
          }],
          isError: true
        };
      }
      
      try {
        return await tool.handler(args);
      } catch (error) {
        return {
          content: [{
            type: 'text',
            text: `Error: ${error.message}`
          }],
          isError: true
        };
      }
    },
    
    /**
     * Check if a tool exists
     * @param {string} toolName
     * @returns {boolean}
     */
    hasTool(toolName) {
      return toolMap.has(toolName);
    }
  };
}

/**
 * Create MCP request handlers for use with MCP SDK
 * @param {Object} mcpServer - Server created by createMCPServer
 * @returns {Object} Request handlers
 */
export function createMCPHandlers(mcpServer) {
  return {
    /**
     * Handle ListTools request
     * @returns {Object}
     */
    handleListTools() {
      return {
        tools: mcpServer.getToolSchemas()
      };
    },
    
    /**
     * Handle CallTool request
     * @param {Object} request
     * @returns {Promise<Object>}
     */
    async handleCallTool(request) {
      const { name, arguments: args } = request.params;
      return await mcpServer.executeTool(name, args || {});
    }
  };
}

export default { createMCPServer, createMCPHandlers };
