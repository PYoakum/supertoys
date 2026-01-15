#!/usr/bin/env node

/**
 * @fileoverview Goals Session Server - Main entry point
 * @module server
 */

import config from './server-config.js';
import { SessionManager } from './lib/session-manager.js';
import { createToolRouter } from './lib/tool-router.js';
import { LLMClient } from './lib/llm-client.js';
import { createApiHandler, jsonResponse } from './api/router.js';
import { createSessionTools, createToolTools } from './mcp/tools/session-tools.js';

/**
 * Logger utility
 */
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => {
    if (config.logging.level === 'debug') {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`);
    }
  }
};

/**
 * Initialize services
 * @returns {Object}
 */
function initializeServices() {
  logger.info('Initializing services...');
  
  // Initialize session manager
  const sessionManager = new SessionManager({
    storeOptions: config.session
  });
  logger.info('Session manager initialized');
  
  // Initialize tool router
  const toolRouter = createToolRouter({
    notepadDir: config.toolRouter.notepadDir
  });
  logger.info(`Tool router initialized with ${toolRouter.getAllTools().length} tools`);
  
  // Initialize LLM client (if API key is configured)
  let llmClient = null;
  if (config.llm.apiKey) {
    llmClient = new LLMClient({
      provider: config.llm.provider,
      endpoint: config.llm.endpoint,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      anthropicVersion: config.llm.anthropicVersion,
      parameters: config.llm.parameters.evaluation,
      retry: config.llm.retry,
      timeout: config.llm.timeout
    });
    logger.info(`LLM client initialized (provider: ${config.llm.provider}, model: ${config.llm.model})`);
  } else {
    logger.info('LLM client not initialized (no API key configured)');
    logger.info('Set LLM_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY to enable LLM features');
  }
  
  return { sessionManager, toolRouter, llmClient };
}

/**
 * Create HTTP server handler
 * @param {Object} services
 * @returns {Function}
 */
function createHttpHandler(services) {
  const apiHandler = createApiHandler({
    ...services,
    config
  });
  
  return async (request) => {
    const url = new URL(request.url);
    logger.debug(`${request.method} ${url.pathname}`);
    
    try {
      return await apiHandler(request);
    } catch (error) {
      logger.error(`Request error: ${error.message}`);
      return jsonResponse({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error.message
        }
      }, 500);
    }
  };
}

/**
 * Start the HTTP server
 * @param {Function} handler
 */
async function startHttpServer(handler) {
  const { port, host } = config.server;
  
  // Check if we're running in Bun
  if (typeof Bun !== 'undefined') {
    const server = Bun.serve({
      port,
      hostname: host,
      fetch: handler
    });
    
    logger.info(`HTTP server listening on http://${host}:${port}`);
    return server;
  }
  
  // Fallback for Node.js
  const http = await import('http');
  
  const server = http.createServer(async (req, res) => {
    // Convert Node request to Fetch API Request
    const url = `http://${req.headers.host}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0] : value);
    }
    
    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      });
    }
    
    const request = new Request(url, {
      method: req.method,
      headers,
      body
    });
    
    const response = await handler(request);
    
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    res.end(await response.text());
  });
  
  server.listen(port, host, () => {
    logger.info(`HTTP server listening on http://${host}:${port}`);
  });
  
  return server;
}

/**
 * Setup MCP tools (for future MCP server integration)
 * @param {Object} services
 * @returns {Object[]}
 */
function setupMcpTools(services) {
  const sessionTools = createSessionTools(services.sessionManager);
  const toolTools = createToolTools(services.toolRouter);
  
  return [...sessionTools, ...toolTools];
}

/**
 * Graceful shutdown handler
 * @param {Object} services
 */
function setupShutdown(services) {
  const shutdown = () => {
    logger.info('Shutting down...');
    services.sessionManager.shutdown();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Main entry point
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                  Goals Session Server v1.0.0                    ║
╚════════════════════════════════════════════════════════════════╝
`);
  
  try {
    // Initialize services
    const services = initializeServices();
    
    // Setup MCP tools (returns tool definitions)
    const mcpTools = setupMcpTools(services);
    logger.info(`MCP tools configured: ${mcpTools.length} tools available`);
    
    // Create HTTP handler
    const handler = createHttpHandler(services);
    
    // Start HTTP server
    await startHttpServer(handler);
    
    // Setup graceful shutdown
    setupShutdown(services);
    
    // Print available endpoints
    console.log(`
Available endpoints:
  POST   /api/sessions          Create a new session
  GET    /api/sessions          List all sessions
  GET    /api/sessions/:id      Get session by ID
  DELETE /api/sessions/:id      Delete a session
  POST   /api/evaluate          Evaluate goals (requires LLM)
  POST   /api/tasklist/generate Generate task list (requires LLM)
  GET    /api/tools             List available tools
  GET    /api/tools/:name       Get tool details
  GET    /health                Health check

Environment variables:
  PORT            HTTP port (default: 3000)
  LLM_API_KEY     LLM API key for evaluation/generation
  LLM_MODEL       LLM model name
  LLM_ENDPOINT    LLM API endpoint
`);
    
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
main();

export { initializeServices, createHttpHandler };
