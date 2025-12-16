/**
 * Usage Examples for Bun Request Handler
 * 
 * Various ways to use the request handler in your Bun applications.
 */

import { 
  createHandler, 
  startServer, 
  createFetchHandler,
  RequestHandler 
} from './request-handler.js';

// ============================================================================
// Example 1: Quick Start (Simplest)
// ============================================================================

async function example1_quickStart() {
  // Start server with default configuration
  await startServer({
    port: 3000,
    dbPath: './content.db',
    configPath: './config.yaml'
  });
  
  // Server is now running at http://localhost:3000
  // Available endpoints:
  //   GET /api/posts          - List all posts
  //   GET /api/posts/:slug    - Get post by slug
  //   GET /api/posts/:id      - Get post by ID
  //   GET /api/posts/stream   - Stream all posts
  //   GET /api/content/:table - Generic content endpoint
}

// ============================================================================
// Example 2: Custom Configuration
// ============================================================================

async function example2_customConfig() {
  await startServer({
    // Server settings
    port: 8080,
    hostname: '127.0.0.1',
    
    // Database
    dbPath: './my-database.db',
    configPath: './my-config.yaml',
    
    // Routes
    basePath: '/v1',
    
    // Caching
    enableCache: true,
    cacheTTL: 600, // 10 minutes
    
    // Formatting
    prettyPrint: true,
    
    // Security
    enableCORS: true,
    allowedOrigins: ['https://mysite.com', 'https://admin.mysite.com'],
    
    // Rate limiting
    rateLimit: {
      enabled: true,
      maxRequests: 100,
      windowMs: 60000 // 1 minute
    },
    
    // Site info (available in templates)
    siteName: 'My Awesome Blog',
    siteUrl: 'https://mysite.com',
    
    // Error handling
    showErrorDetails: process.env.NODE_ENV !== 'production'
  });
}

// ============================================================================
// Example 3: Using with Existing Bun.serve
// ============================================================================

async function example3_existingServer() {
  // Create handler without starting server
  const handler = await createHandler({
    dbPath: './content.db',
    configPath: './config.yaml',
    basePath: '/api'
  });

  // Use in your own Bun.serve configuration
  Bun.serve({
    port: 3000,
    
    async fetch(req) {
      const url = new URL(req.url);
      
      // Handle API routes with the handler
      if (url.pathname.startsWith('/api')) {
        return handler.handle(req);
      }
      
      // Handle other routes yourself
      if (url.pathname === '/') {
        return new Response('<h1>Welcome!</h1>', {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      if (url.pathname === '/about') {
        return new Response('<h1>About Us</h1>', {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      return new Response('Not Found', { status: 404 });
    }
  });

  console.log('Server running with mixed routes');
}

// ============================================================================
// Example 4: Custom Filters
// ============================================================================

async function example4_customFilters() {
  const handler = await createHandler({
    dbPath: './content.db',
    configPath: './config.yaml'
  });

  // Register custom filters for template processing
  
  // Currency formatter
  handler.registerFilter('currency', (value, args) => {
    const currency = args && args[0] ? args[0] : 'USD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(Number(value));
  });

  // Relative time (e.g., "2 days ago")
  handler.registerFilter('timeAgo', (value) => {
    const date = new Date(value);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString();
  });

  // Word count
  handler.registerFilter('wordCount', (value) => {
    const words = String(value).split(/\s+/).filter(w => w.length > 0);
    return words.length;
  });

  // Markdown to plain text (strip all formatting)
  handler.registerFilter('plainText', (value) => {
    return String(value)
      .replace(/<[^>]*>/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#+\s+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
  });

  // Start server with custom filters
  handler.start();
  
  // Now you can use these in your markdown templates:
  // {{price | currency:"EUR"}}
  // {{created_at | timeAgo}}
  // {{content | wordCount}} words
  // {{content | plainText | truncate:100}}
}

// ============================================================================
// Example 5: Multiple Handler Instances
// ============================================================================

async function example5_multipleHandlers() {
  // Create separate handlers for different databases
  const blogHandler = await createHandler({
    dbPath: './blog.db',
    configPath: './blog-config.yaml',
    basePath: '/blog'
  });

  const docsHandler = await createHandler({
    dbPath: './docs.db',
    configPath: './docs-config.yaml',
    basePath: '/docs'
  });

  const wikiHandler = await createHandler({
    dbPath: './wiki.db',
    configPath: './wiki-config.yaml',
    basePath: '/wiki'
  });

  Bun.serve({
    port: 3000,
    
    async fetch(req) {
      const url = new URL(req.url);
      
      if (url.pathname.startsWith('/blog')) {
        return blogHandler.handle(req);
      }
      
      if (url.pathname.startsWith('/docs')) {
        return docsHandler.handle(req);
      }
      
      if (url.pathname.startsWith('/wiki')) {
        return wikiHandler.handle(req);
      }
      
      return new Response('Not Found', { status: 404 });
    }
  });

  console.log('Multi-database server running');
}

// ============================================================================
// Example 6: With Authentication Middleware
// ============================================================================

async function example6_withAuth() {
  const handler = await createHandler({
    dbPath: './content.db',
    basePath: '/api'
  });

  // Simple API key authentication
  function authenticate(req) {
    const apiKey = req.headers.get('X-API-Key');
    const validKeys = ['key1', 'key2', 'key3']; // In practice, use env vars
    return validKeys.includes(apiKey);
  }

  // Simple JWT verification (simplified example)
  function verifyJWT(token) {
    // In practice, use proper JWT verification
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp > Date.now() / 1000;
    } catch {
      return false;
    }
  }

  Bun.serve({
    port: 3000,
    
    async fetch(req) {
      const url = new URL(req.url);
      
      // Public routes (no auth required)
      if (url.pathname === '/' || url.pathname.startsWith('/public')) {
        return handler.handle(req);
      }
      
      // Protected API routes
      if (url.pathname.startsWith('/api')) {
        // Check for API key
        if (!authenticate(req)) {
          // Check for Bearer token
          const authHeader = req.headers.get('Authorization');
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          const token = authHeader.substring(7);
          if (!verifyJWT(token)) {
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        }
        
        return handler.handle(req);
      }
      
      return new Response('Not Found', { status: 404 });
    }
  });

  console.log('Authenticated server running');
}

// ============================================================================
// Example 7: Full HTML Page Wrapper
// ============================================================================

async function example7_fullPage() {
  const handler = await createHandler({
    dbPath: './content.db',
    basePath: '/api'
  });

  // HTML template wrapper
  function wrapInPage(content, title = 'My Site') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    h1, h2, h3 { color: #111; }
    a { color: #0066cc; }
    article { 
      margin-bottom: 40px; 
      padding-bottom: 20px; 
      border-bottom: 1px solid #eee; 
    }
    .meta { color: #666; font-size: 0.9em; }
    nav { margin-bottom: 40px; }
    nav a { margin-right: 20px; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Home</a>
    <a href="/posts">Blog</a>
    <a href="/about">About</a>
  </nav>
  <main>
    ${content}
  </main>
  <footer>
    <p>&copy; ${new Date().getFullYear()} My Site</p>
  </footer>
</body>
</html>`;
  }

  Bun.serve({
    port: 3000,
    
    async fetch(req) {
      const url = new URL(req.url);
      
      // Home page
      if (url.pathname === '/') {
        const recentPosts = handler.helper.queryAndRender({
          table: 'posts',
          where: { status: 'published' },
          orderBy: 'created_at',
          orderDirection: 'DESC',
          limit: 5
        }, {
          siteName: 'My Site'
        });
        
        const html = wrapInPage(`
          <h1>Welcome to My Site</h1>
          <p>Recent posts:</p>
          ${recentPosts || '<p>No posts yet.</p>'}
        `, 'Home - My Site');
        
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      // Blog listing
      if (url.pathname === '/posts') {
        const posts = handler.helper.queryAndRender({
          table: 'posts',
          where: { status: 'published' },
          orderBy: 'created_at',
          orderDirection: 'DESC',
          limit: 20
        }, {
          siteName: 'My Site'
        });
        
        const html = wrapInPage(`
          <h1>Blog</h1>
          ${posts || '<p>No posts yet.</p>'}
        `, 'Blog - My Site');
        
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      // Single post
      if (url.pathname.startsWith('/posts/')) {
        const slug = url.pathname.split('/').pop();
        
        const post = handler.helper.queryOne({
          table: 'posts',
          where: { slug, status: 'published' }
        }, {
          siteName: 'My Site'
        });
        
        if (!post) {
          return new Response(wrapInPage('<h1>Post Not Found</h1>', '404 - My Site'), {
            status: 404,
            headers: { 'Content-Type': 'text/html' }
          });
        }
        
        const html = wrapInPage(post, 'My Site');
        
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' }
        });
      }
      
      // API routes (return raw HTML/JSON)
      if (url.pathname.startsWith('/api')) {
        return handler.handle(req);
      }
      
      return new Response(wrapInPage('<h1>Page Not Found</h1>', '404'), {
        status: 404,
        headers: { 'Content-Type': 'text/html' }
      });
    }
  });

  console.log('Full page server running at http://localhost:3000');
}

// ============================================================================
// Example 8: SSE (Server-Sent Events) for Live Updates
// ============================================================================

async function example8_sseUpdates() {
  const handler = await createHandler({
    dbPath: './content.db',
    basePath: '/api'
  });

  // Track connected clients
  const clients = new Set();

  // Function to notify all clients
  function notifyClients(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.enqueue(message);
    }
  }

  Bun.serve({
    port: 3000,
    
    async fetch(req) {
      const url = new URL(req.url);
      
      // SSE endpoint for live updates
      if (url.pathname === '/api/events') {
        const encoder = new TextEncoder();
        let controller;
        
        const stream = new ReadableStream({
          start(ctrl) {
            controller = ctrl;
            clients.add(controller);
            
            // Send initial connection message
            controller.enqueue(encoder.encode('event: connected\ndata: {"status":"ok"}\n\n'));
          },
          cancel() {
            clients.delete(controller);
          }
        });
        
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      }
      
      // Webhook to trigger updates (in practice, call this when content changes)
      if (url.pathname === '/api/notify' && req.method === 'POST') {
        const body = await req.json();
        notifyClients('update', body);
        return new Response(JSON.stringify({ notified: clients.size }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Regular API routes
      return handler.handle(req);
    }
  });

  console.log('SSE server running at http://localhost:3000');
  console.log('Connect to /api/events for live updates');
}

// ============================================================================
// Example 9: Environment-Based Configuration
// ============================================================================

async function example9_envConfig() {
  // Load configuration from environment variables
  const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    hostname: process.env.HOST || '0.0.0.0',
    dbPath: process.env.DATABASE_URL || './content.db',
    configPath: process.env.CONFIG_PATH || './config.yaml',
    basePath: process.env.API_BASE || '/api',
    enableCache: process.env.ENABLE_CACHE !== 'false',
    cacheTTL: parseInt(process.env.CACHE_TTL || '300', 10),
    prettyPrint: process.env.PRETTY_PRINT === 'true',
    enableCORS: process.env.ENABLE_CORS !== 'false',
    allowedOrigins: process.env.CORS_ORIGINS 
      ? process.env.CORS_ORIGINS.split(',') 
      : ['*'],
    siteName: process.env.SITE_NAME || 'My Site',
    siteUrl: process.env.SITE_URL || 'http://localhost:3000',
    showErrorDetails: process.env.NODE_ENV !== 'production',
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED === 'true',
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10)
    }
  };

  await startServer(config);
}

// ============================================================================
// Example 10: Health Check & Metrics
// ============================================================================

async function example10_healthMetrics() {
  const handler = await createHandler({
    dbPath: './content.db',
    basePath: '/api'
  });

  // Simple metrics
  const metrics = {
    requests: 0,
    errors: 0,
    startTime: Date.now(),
    lastRequest: null
  };

  Bun.serve({
    port: 3000,
    
    async fetch(req) {
      const url = new URL(req.url);
      const start = Date.now();
      
      // Health check endpoint
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          uptime: Date.now() - metrics.startTime,
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Metrics endpoint
      if (url.pathname === '/metrics') {
        return new Response(JSON.stringify({
          ...metrics,
          uptime: Date.now() - metrics.startTime,
          uptimeHuman: formatUptime(Date.now() - metrics.startTime)
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Ready check (for k8s/container orchestration)
      if (url.pathname === '/ready') {
        // Check if database is accessible
        try {
          handler.helper.db.query('SELECT 1').get();
          return new Response('OK', { status: 200 });
        } catch {
          return new Response('Not Ready', { status: 503 });
        }
      }
      
      // Track metrics for API requests
      metrics.requests++;
      metrics.lastRequest = new Date().toISOString();
      
      try {
        const response = await handler.handle(req);
        
        // Add timing header
        const duration = Date.now() - start;
        const headers = new Headers(response.headers);
        headers.set('X-Response-Time', `${duration}ms`);
        
        return new Response(response.body, {
          status: response.status,
          headers
        });
      } catch (error) {
        metrics.errors++;
        throw error;
      }
    }
  });

  console.log('Server with health checks running at http://localhost:3000');
  console.log('Health: /health | Metrics: /metrics | Ready: /ready');
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// ============================================================================
// Run Examples
// ============================================================================

async function runExample(name) {
  const examples = {
    'quickstart': example1_quickStart,
    'config': example2_customConfig,
    'existing': example3_existingServer,
    'filters': example4_customFilters,
    'multi': example5_multipleHandlers,
    'auth': example6_withAuth,
    'fullpage': example7_fullPage,
    'sse': example8_sseUpdates,
    'env': example9_envConfig,
    'health': example10_healthMetrics
  };

  const example = examples[name];
  if (!example) {
    console.log('Available examples:', Object.keys(examples).join(', '));
    console.log('Usage: bun run usage-examples-handler.js <example-name>');
    return;
  }

  await example();
}

// CLI entry point
if (import.meta.main) {
  const exampleName = process.argv[2] || 'quickstart';
  runExample(exampleName).catch(console.error);
}

export {
  example1_quickStart,
  example2_customConfig,
  example3_existingServer,
  example4_customFilters,
  example5_multipleHandlers,
  example6_withAuth,
  example7_fullPage,
  example8_sseUpdates,
  example9_envConfig,
  example10_healthMetrics
};