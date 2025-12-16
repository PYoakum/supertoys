/**
 * Bun Request Handler for Database Markdown Helper
 * 
 * A production-ready HTTP request handler that serves markdown content
 * from SQL databases as rendered HTML using the DbMarkdownHelper.
 * 
 */

import { Database } from 'bun:sqlite';
import { parse as parseYAML } from 'yaml';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  // Server settings
  port: 3000,
  hostname: '0.0.0.0',
  
  // Database settings
  dbPath: './content.db',
  configPath: './config.yaml',
  
  // Route settings
  basePath: '/api',
  
  // Cache settings
  enableCache: true,
  cacheTTL: 300, // 5 minutes in seconds
  
  // Response settings
  defaultFormat: 'html',
  prettyPrint: false,
  
  // Security settings
  enableCORS: true,
  allowedOrigins: ['*'],
  rateLimit: {
    enabled: false,
    maxRequests: 100,
    windowMs: 60000 // 1 minute
  }
};

// ============================================================================
// Simple In-Memory Cache
// ============================================================================

class ResponseCache {
  constructor(ttl = 300) {
    this.cache = new Map();
    this.ttl = ttl * 1000; // Convert to milliseconds
  }

  generateKey(path, query) {
    const queryString = new URLSearchParams(query).toString();
    return `${path}?${queryString}`;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.value;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttl
    });
  }

  clear() {
    this.cache.clear();
  }

  delete(key) {
    this.cache.delete(key);
  }

  // Clean expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  constructor(maxRequests = 100, windowMs = 60000) {
    this.requests = new Map();
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(ip) {
    const now = Date.now();
    const record = this.requests.get(ip);
    
    if (!record) {
      this.requests.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    
    if (now > record.resetAt) {
      this.requests.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    
    if (record.count >= this.maxRequests) {
      return false;
    }
    
    record.count++;
    return true;
  }

  getRemainingRequests(ip) {
    const record = this.requests.get(ip);
    if (!record) return this.maxRequests;
    return Math.max(0, this.maxRequests - record.count);
  }

  getResetTime(ip) {
    const record = this.requests.get(ip);
    if (!record) return 0;
    return Math.max(0, record.resetAt - Date.now());
  }
}

// ============================================================================
// SQL Sanitizer (JavaScript version)
// ============================================================================

class SQLSanitizer {
  constructor(config = {}) {
    this.allowedTables = new Set(config.allowedTables || []);
    this.allowedColumns = new Set(config.allowedColumns || []);
    this.maxLimit = config.maxLimit || 1000;
  }

  sanitizeTableName(table) {
    const cleaned = String(table).replace(/[^a-zA-Z0-9_]/g, '');
    
    if (this.allowedTables.size > 0 && !this.allowedTables.has(cleaned)) {
      throw new Error(`Table "${table}" is not in the allowed list`);
    }
    
    return cleaned;
  }

  sanitizeColumnName(column) {
    const cleaned = String(column).replace(/[^a-zA-Z0-9_.]/g, '');
    
    if (this.allowedColumns.size > 0 && !this.allowedColumns.has(cleaned)) {
      throw new Error(`Column "${column}" is not in the allowed list`);
    }
    
    return cleaned;
  }

  sanitizeValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.replace(/'/g, "''");
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    return JSON.stringify(value).replace(/'/g, "''");
  }

  sanitizeLimit(limit) {
    if (!limit) return this.maxLimit;
    return Math.min(Math.max(1, Math.floor(Number(limit))), this.maxLimit);
  }

  sanitizeOffset(offset) {
    if (!offset) return 0;
    return Math.max(0, Math.floor(Number(offset)));
  }

  sanitizeOrderDirection(direction) {
    const upper = String(direction || '').toUpperCase();
    return upper === 'DESC' ? 'DESC' : 'ASC';
  }
}

// ============================================================================
// HTML Sanitizer (JavaScript version)
// ============================================================================

class HTMLSanitizer {
  constructor(config = {}) {
    this.allowedTags = new Set(config.allowedTags || [
      'p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'img', 'code', 'pre', 'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'hr'
    ]);

    this.allowedAttributes = new Map();
    const defaultAttrs = config.allowedAttributes || {
      'a': ['href', 'title', 'target'],
      'img': ['src', 'alt', 'title', 'width', 'height'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan']
    };

    for (const [tag, attrs] of Object.entries(defaultAttrs)) {
      this.allowedAttributes.set(tag, new Set(attrs));
    }
  }

  sanitize(html) {
    let result = String(html);

    // Remove script tags and content
    result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove style tags and content
    result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    
    // Remove event handlers
    result = result.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    
    // Remove javascript: protocol
    result = result.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

    // Filter tags
    result = result.replace(/<(\/?)([\w-]+)([^>]*)>/gi, (match, slash, tag, attrs) => {
      const lowerTag = tag.toLowerCase();
      
      if (slash === '/') {
        return this.allowedTags.has(lowerTag) ? match : '';
      }
      
      if (!this.allowedTags.has(lowerTag)) {
        return '';
      }
      
      const allowedAttrs = this.allowedAttributes.get(lowerTag);
      if (!allowedAttrs || allowedAttrs.size === 0) {
        return `<${tag}>`;
      }
      
      const filteredAttrs = attrs.replace(/\s*([\w-]+)\s*=\s*["']([^"']*)["']/gi, 
        (attrMatch, attrName, attrValue) => {
          if (allowedAttrs.has(attrName.toLowerCase())) {
            return ` ${attrName}="${attrValue}"`;
          }
          return '';
        }
      );
      
      return `<${tag}${filteredAttrs}>`;
    });

    return result;
  }
}

// ============================================================================
// Override Processor (JavaScript version)
// ============================================================================

class OverrideProcessor {
  constructor(overrides = []) {
    this.overrides = overrides.map(override => {
      // Convert string regex patterns to RegExp
      if (typeof override.from === 'string' && 
          override.from.startsWith('/') && 
          override.from.endsWith('/')) {
        return {
          ...override,
          from: new RegExp(override.from.slice(1, -1))
        };
      }
      return override;
    });
  }

  apply(data) {
    const result = { ...data };

    for (const override of this.overrides) {
      const value = result[override.field];
      
      if (typeof value !== 'string') continue;

      if (override.from instanceof RegExp) {
        result[override.field] = override.global 
          ? value.replace(new RegExp(override.from, 'g'), override.to)
          : value.replace(override.from, override.to);
      } else {
        if (override.global) {
          result[override.field] = value.split(override.from).join(override.to);
        } else {
          result[override.field] = value.replace(override.from, override.to);
        }
      }
    }

    return result;
  }
}

// ============================================================================
// Simple Template Processor (JavaScript version)
// ============================================================================

class TemplateProcessor {
  constructor() {
    this.filters = new Map();
    this.registerDefaultFilters();
  }

  registerDefaultFilters() {
    this.filters.set('uppercase', (v) => String(v).toUpperCase());
    this.filters.set('lowercase', (v) => String(v).toLowerCase());
    this.filters.set('capitalize', (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1));
    this.filters.set('trim', (v) => String(v).trim());
    this.filters.set('json', (v) => JSON.stringify(v));
    this.filters.set('escape', (v) => this.escapeHtml(String(v)));
    this.filters.set('default', (v, args) => v ?? (args ? args[0] : ''));
    this.filters.set('truncate', (v, args) => {
      const str = String(v);
      const len = args ? parseInt(args[0], 10) : 100;
      return str.length > len ? str.substring(0, len) + '...' : str;
    });
    this.filters.set('date', (v, args) => {
      const date = new Date(v);
      if (isNaN(date.getTime())) return String(v);
      
      const format = args ? args[0] : 'long';
      if (format === 'iso') return date.toISOString();
      if (format === 'short') return date.toLocaleDateString();
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    });
  }

  registerFilter(name, fn) {
    this.filters.set(name, fn);
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  resolveValue(path, data) {
    const keys = path.split('.');
    let value = data;
    
    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      
      // Handle array access like items[0]
      const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        value = value[arrayMatch[1]];
        if (Array.isArray(value)) {
          value = value[parseInt(arrayMatch[2], 10)];
        }
      } else {
        value = value[key];
      }
    }
    
    return value;
  }

  applyFilters(value, filterStr) {
    const parts = filterStr.split('|').map(p => p.trim());
    const varPath = parts[0];
    const filters = parts.slice(1);
    
    let result = this.resolveValue(varPath, value);
    
    for (const filter of filters) {
      const match = filter.match(/^(\w+)(?::(.+))?$/);
      if (!match) continue;
      
      const filterName = match[1];
      const argsStr = match[2];
      const args = argsStr ? argsStr.split(',').map(a => a.trim().replace(/^["']|["']$/g, '')) : [];
      
      const filterFn = this.filters.get(filterName);
      if (filterFn) {
        result = filterFn(result, args);
      }
    }
    
    return result;
  }

  process(template, data) {
    // Handle simple variables: {{variable}} and {{variable | filter}}
    let result = template.replace(/\{\{([^}]+)\}\}/g, (match, content) => {
      const trimmed = content.trim();
      
      // Check for filters
      if (trimmed.includes('|')) {
        const value = this.applyFilters(data, trimmed);
        return value !== undefined ? String(value) : '';
      }
      
      // Simple variable
      const value = this.resolveValue(trimmed, data);
      return value !== undefined ? String(value) : '';
    });

    // Handle simple loops: {{#each items}}...{{/each}}
    result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayName, content) => {
      const array = this.resolveValue(arrayName, data);
      if (!Array.isArray(array)) return '';
      
      return array.map((item, index) => {
        const itemData = { ...data, '.': item, '@index': index };
        if (typeof item === 'object' && item !== null) {
          Object.assign(itemData, item);
        }
        return this.process(content, itemData);
      }).join('');
    });

    // Handle simple conditionals: {{#if condition}}...{{/if}}
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
      const value = this.resolveValue(condition, data);
      return value ? this.process(content, data) : '';
    });

    return result;
  }
}

// ============================================================================
// Database Markdown Helper (JavaScript version)
// ============================================================================

class DbMarkdownHelper {
  constructor(dbPath, configPath = null) {
    this.db = new Database(dbPath);
    this.templateProcessor = new TemplateProcessor();
    this.config = {};
    
    if (configPath) {
      this.loadConfig(configPath);
    }
    
    this.sqlSanitizer = new SQLSanitizer(this.config.sqlSanitization);
    this.htmlSanitizer = new HTMLSanitizer(this.config.htmlSanitization);
    this.overrideProcessor = new OverrideProcessor(this.config.overrides);
  }

  loadConfig(configPath) {
    try {
      const file = Bun.file(configPath);
      const content = file.text();
      
      // Handle async if needed
      if (content instanceof Promise) {
        // Sync fallback - read file synchronously
        const fs = require('fs');
        const syncContent = fs.readFileSync(configPath, 'utf-8');
        this.config = parseYAML(syncContent);
      } else {
        this.config = parseYAML(content);
      }
    } catch (error) {
      console.warn(`Warning: Could not load config from ${configPath}:`, error.message);
      this.config = {};
    }
  }

  async loadConfigAsync(configPath) {
    try {
      const file = Bun.file(configPath);
      const content = await file.text();
      this.config = parseYAML(content);
      
      // Reinitialize components
      this.sqlSanitizer = new SQLSanitizer(this.config.sqlSanitization);
      this.htmlSanitizer = new HTMLSanitizer(this.config.htmlSanitization);
      this.overrideProcessor = new OverrideProcessor(this.config.overrides);
    } catch (error) {
      console.warn(`Warning: Could not load config from ${configPath}:`, error.message);
    }
  }

  buildQuery(queryConfig) {
    const table = this.sqlSanitizer.sanitizeTableName(queryConfig.table);
    const columns = queryConfig.columns 
      ? queryConfig.columns.map(c => this.sqlSanitizer.sanitizeColumnName(c))
      : ['*'];
    
    let sql = `SELECT ${columns.join(', ')} FROM ${table}`;
    const params = [];

    if (queryConfig.where && Object.keys(queryConfig.where).length > 0) {
      const conditions = [];
      
      for (const [key, value] of Object.entries(queryConfig.where)) {
        const column = this.sqlSanitizer.sanitizeColumnName(key);
        conditions.push(`${column} = ?`);
        params.push(this.sqlSanitizer.sanitizeValue(value));
      }
      
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    if (queryConfig.orderBy) {
      const orderBy = this.sqlSanitizer.sanitizeColumnName(queryConfig.orderBy);
      const direction = this.sqlSanitizer.sanitizeOrderDirection(queryConfig.orderDirection);
      sql += ` ORDER BY ${orderBy} ${direction}`;
    }

    const limit = this.sqlSanitizer.sanitizeLimit(queryConfig.limit);
    sql += ` LIMIT ${limit}`;
    
    if (queryConfig.offset) {
      const offset = this.sqlSanitizer.sanitizeOffset(queryConfig.offset);
      sql += ` OFFSET ${offset}`;
    }

    return { sql, params };
  }

  queryAndRender(queryConfig, replacementData = {}, options = {}) {
    const { sql, params } = this.buildQuery(queryConfig);
    const rows = this.db.query(sql).all(...params);

    if (rows.length === 0) {
      return '';
    }

    const results = [];

    for (const row of rows) {
      // Apply overrides
      const processedRow = this.overrideProcessor.apply(row);

      // Merge with replacement data
      const data = { ...processedRow, ...replacementData };

      // Get markdown content
      const markdownContent = String(processedRow.content || processedRow.markdown || '');

      if (!markdownContent) continue;

      // Process template
      let html = this.templateProcessor.process(markdownContent, data);

      // Sanitize HTML if requested
      if (options.sanitizeHtml !== false) {
        html = this.htmlSanitizer.sanitize(html);
      }

      results.push(html);
    }

    let output = results.join('\n\n');

    if (options.prettify) {
      output = this.prettifyHtml(output);
    }

    return output;
  }

  queryOne(queryConfig, replacementData = {}, options = {}) {
    const result = this.queryAndRender(
      { ...queryConfig, limit: 1 },
      replacementData,
      options
    );
    
    return result || null;
  }

  *queryStream(queryConfig, replacementData = {}, options = {}) {
    const { sql, params } = this.buildQuery(queryConfig);
    const rows = this.db.query(sql).all(...params);

    for (const row of rows) {
      const processedRow = this.overrideProcessor.apply(row);
      const data = { ...processedRow, ...replacementData };
      const markdownContent = String(processedRow.content || processedRow.markdown || '');

      if (!markdownContent) continue;

      let html = this.templateProcessor.process(markdownContent, data);

      if (options.sanitizeHtml !== false) {
        html = this.htmlSanitizer.sanitize(html);
      }

      yield options.prettify ? this.prettifyHtml(html) : html;
    }
  }

  registerFilter(name, fn) {
    this.templateProcessor.registerFilter(name, fn);
  }

  prettifyHtml(html) {
    return html
      .replace(/(<\/(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|tr)>)/gi, '$1\n')
      .replace(/(<(?:p|div|h[1-6]|ul|ol|blockquote|pre|table|thead|tbody)>)/gi, '\n$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  close() {
    this.db.close();
  }
}

// ============================================================================
// Request Handler
// ============================================================================

class RequestHandler {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.helper = null;
    this.cache = new ResponseCache(this.config.cacheTTL);
    this.rateLimiter = new RateLimiter(
      this.config.rateLimit.maxRequests,
      this.config.rateLimit.windowMs
    );
    
    // Bind methods
    this.handle = this.handle.bind(this);
    this.handleRequest = this.handleRequest.bind(this);
  }

  async initialize() {
    this.helper = new DbMarkdownHelper(
      this.config.dbPath,
      this.config.configPath
    );
    
    // Load config asynchronously for proper parsing
    if (this.config.configPath) {
      await this.helper.loadConfigAsync(this.config.configPath);
    }

    // Register custom filters
    this.registerDefaultFilters();
    
    return this;
  }

  registerDefaultFilters() {
    // Reading time filter
    this.helper.registerFilter('readingTime', (value) => {
      const words = String(value).split(/\s+/).length;
      const minutes = Math.ceil(words / 200);
      return `${minutes} min read`;
    });

    // Excerpt filter
    this.helper.registerFilter('excerpt', (value, args) => {
      const text = String(value).replace(/<[^>]*>/g, '');
      const length = args ? parseInt(args[0], 10) : 150;
      return text.length > length 
        ? text.substring(0, length).trim() + '...'
        : text;
    });

    // Slug filter
    this.helper.registerFilter('slug', (value) => {
      return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    });

    // Pretty date filter
    this.helper.registerFilter('prettyDate', (value) => {
      const date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    });
  }

  // Register custom filter
  registerFilter(name, fn) {
    if (this.helper) {
      this.helper.registerFilter(name, fn);
    }
  }

  // Create JSON response
  jsonResponse(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...headers
      }
    });
  }

  // Create HTML response
  htmlResponse(html, status = 200, headers = {}) {
    return new Response(html, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...headers
      }
    });
  }

  // Create error response
  errorResponse(message, status = 500, details = null) {
    const body = {
      error: true,
      message,
      status
    };
    
    if (details && this.config.showErrorDetails) {
      body.details = details;
    }
    
    return this.jsonResponse(body, status);
  }

  // Add CORS headers
  corsHeaders(origin = '*') {
    const allowedOrigin = this.config.allowedOrigins.includes('*') 
      ? '*' 
      : (this.config.allowedOrigins.includes(origin) ? origin : null);
    
    if (!allowedOrigin) return {};
    
    return {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };
  }

  // Get client IP
  getClientIP(req) {
    return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
           req.headers.get('x-real-ip') ||
           'unknown';
  }

  // Parse query parameters
  parseQueryParams(url) {
    const params = {};
    
    for (const [key, value] of url.searchParams.entries()) {
      // Handle array params like ?tags=a&tags=b
      if (params[key]) {
        if (Array.isArray(params[key])) {
          params[key].push(value);
        } else {
          params[key] = [params[key], value];
        }
      } else {
        params[key] = value;
      }
    }
    
    return params;
  }

  // Build query config from request
  buildQueryConfig(table, params) {
    const config = { table };

    // Columns
    if (params.columns) {
      config.columns = Array.isArray(params.columns) 
        ? params.columns 
        : params.columns.split(',').map(c => c.trim());
    }

    // Where conditions
    const whereParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (key.startsWith('where.') || key.startsWith('filter.')) {
        const field = key.replace(/^(where|filter)\./, '');
        whereParams[field] = value;
      }
    }
    
    // Also support direct field params
    const reservedParams = ['columns', 'limit', 'offset', 'orderBy', 'order', 'format', 'pretty', 'nocache'];
    for (const [key, value] of Object.entries(params)) {
      if (!reservedParams.includes(key) && !key.startsWith('where.') && !key.startsWith('filter.')) {
        // Check if it looks like a filter
        if (['id', 'slug', 'status', 'author', 'category'].includes(key)) {
          whereParams[key] = value;
        }
      }
    }
    
    if (Object.keys(whereParams).length > 0) {
      config.where = whereParams;
    }

    // Pagination
    if (params.limit) {
      config.limit = parseInt(params.limit, 10);
    }
    if (params.offset) {
      config.offset = parseInt(params.offset, 10);
    }
    if (params.page && params.limit) {
      config.offset = (parseInt(params.page, 10) - 1) * parseInt(params.limit, 10);
    }

    // Ordering
    if (params.orderBy || params.order_by || params.sort) {
      config.orderBy = params.orderBy || params.order_by || params.sort;
    }
    if (params.order || params.direction) {
      config.orderDirection = (params.order || params.direction).toUpperCase();
    }

    return config;
  }

  // Route: GET /api/posts
  async handleListPosts(params, replacementData) {
    const queryConfig = this.buildQueryConfig('posts', {
      ...params,
      limit: params.limit || 10
    });

    // Default to published posts
    if (!queryConfig.where) {
      queryConfig.where = {};
    }
    if (!queryConfig.where.status) {
      queryConfig.where.status = 'published';
    }

    // Default ordering
    if (!queryConfig.orderBy) {
      queryConfig.orderBy = 'created_at';
      queryConfig.orderDirection = 'DESC';
    }

    const html = this.helper.queryAndRender(queryConfig, replacementData, {
      sanitizeHtml: true,
      prettify: this.config.prettyPrint
    });

    return html;
  }

  // Route: GET /api/posts/:slug
  async handleGetPost(slug, replacementData) {
    const queryConfig = {
      table: 'posts',
      where: { slug, status: 'published' }
    };

    const html = this.helper.queryOne(queryConfig, replacementData, {
      sanitizeHtml: true,
      prettify: this.config.prettyPrint
    });

    return html;
  }

  // Route: GET /api/posts/:id (by ID)
  async handleGetPostById(id, replacementData) {
    const queryConfig = {
      table: 'posts',
      where: { id: parseInt(id, 10) }
    };

    const html = this.helper.queryOne(queryConfig, replacementData, {
      sanitizeHtml: true,
      prettify: this.config.prettyPrint
    });

    return html;
  }

  // Route: GET /api/content/:table
  async handleGenericContent(table, params, replacementData) {
    const queryConfig = this.buildQueryConfig(table, params);

    const html = this.helper.queryAndRender(queryConfig, replacementData, {
      sanitizeHtml: true,
      prettify: this.config.prettyPrint
    });

    return html;
  }

  // Streaming response
  async handleStreamPosts(params, replacementData) {
    const queryConfig = this.buildQueryConfig('posts', {
      ...params,
      limit: params.limit || 100
    });

    if (!queryConfig.where) {
      queryConfig.where = { status: 'published' };
    }

    const encoder = new TextEncoder();
    const helper = this.helper;
    const config = this.config;

    const stream = new ReadableStream({
      start(controller) {
        try {
          for (const html of helper.queryStream(queryConfig, replacementData, {
            sanitizeHtml: true,
            prettify: config.prettyPrint
          })) {
            controller.enqueue(encoder.encode(html + '\n\n'));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache'
      }
    });
  }

  // Main request handler
  async handleRequest(req) {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;
    const params = this.parseQueryParams(url);
    const origin = req.headers.get('origin') || '*';

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: this.corsHeaders(origin)
      });
    }

    // Rate limiting
    if (this.config.rateLimit.enabled) {
      const ip = this.getClientIP(req);
      if (!this.rateLimiter.isAllowed(ip)) {
        return this.errorResponse('Too many requests', 429, {
          retryAfter: Math.ceil(this.rateLimiter.getResetTime(ip) / 1000)
        });
      }
    }

    // Check cache
    if (this.config.enableCache && params.nocache !== 'true') {
      const cacheKey = this.cache.generateKey(path, params);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const headers = {
          ...this.corsHeaders(origin),
          'X-Cache': 'HIT'
        };
        
        if (params.format === 'json') {
          return this.jsonResponse(cached, 200, headers);
        }
        return this.htmlResponse(cached, 200, headers);
      }
    }

    // Common replacement data
    const replacementData = {
      siteName: this.config.siteName || 'My Site',
      siteUrl: this.config.siteUrl || url.origin,
      currentYear: new Date().getFullYear(),
      currentPath: path,
      requestTime: new Date().toISOString()
    };

    try {
      let result = null;
      const basePath = this.config.basePath;

      // Route matching
      if (path === `${basePath}/posts` || path === `${basePath}/posts/`) {
        // List posts
        result = await this.handleListPosts(params, replacementData);
      } 
      else if (path.match(new RegExp(`^${basePath}/posts/stream/?$`))) {
        // Stream posts
        return await this.handleStreamPosts(params, replacementData);
      }
      else if (path.match(new RegExp(`^${basePath}/posts/\\d+$`))) {
        // Get post by ID
        const id = path.split('/').pop();
        result = await this.handleGetPostById(id, replacementData);
      }
      else if (path.match(new RegExp(`^${basePath}/posts/[a-z0-9-]+$`))) {
        // Get post by slug
        const slug = path.split('/').pop();
        result = await this.handleGetPost(slug, replacementData);
      }
      else if (path.match(new RegExp(`^${basePath}/content/[a-z_]+$`))) {
        // Generic content endpoint
        const table = path.split('/').pop();
        result = await this.handleGenericContent(table, params, replacementData);
      }
      else if (path === '/' || path === '') {
        // Health check
        return this.jsonResponse({
          status: 'ok',
          version: '1.0.0',
          endpoints: [
            `${basePath}/posts`,
            `${basePath}/posts/:slug`,
            `${basePath}/posts/:id`,
            `${basePath}/posts/stream`,
            `${basePath}/content/:table`
          ]
        }, 200, this.corsHeaders(origin));
      }
      else {
        return this.errorResponse('Not found', 404);
      }

      // Handle null result (not found)
      if (result === null) {
        return this.errorResponse('Content not found', 404);
      }

      // Cache the result
      if (this.config.enableCache && params.nocache !== 'true') {
        const cacheKey = this.cache.generateKey(path, params);
        this.cache.set(cacheKey, result);
      }

      // Return response
      const headers = {
        ...this.corsHeaders(origin),
        'X-Cache': 'MISS',
        'Cache-Control': `public, max-age=${this.config.cacheTTL}`
      };

      if (params.format === 'json') {
        return this.jsonResponse({ html: result, path, params }, 200, headers);
      }

      return this.htmlResponse(result, 200, headers);

    } catch (error) {
      console.error('Request error:', error);
      
      if (error.message.includes('not in the allowed list')) {
        return this.errorResponse('Access denied', 403, error.message);
      }
      
      return this.errorResponse('Internal server error', 500, 
        this.config.showErrorDetails ? error.message : null
      );
    }
  }

  // Bun.serve compatible handler
  async handle(req) {
    return this.handleRequest(req);
  }

  // Start server
  start() {
    const server = Bun.serve({
      port: this.config.port,
      hostname: this.config.hostname,
      fetch: this.handle,
      error: (error) => {
        console.error('Server error:', error);
        return this.errorResponse('Internal server error', 500);
      }
    });

    console.log(`🚀 Server running at http://${this.config.hostname}:${this.config.port}`);
    console.log(`📖 API Base: ${this.config.basePath}`);
    console.log(`📦 Database: ${this.config.dbPath}`);
    console.log(`⚙️  Config: ${this.config.configPath || 'default'}`);
    
    return server;
  }

  // Cleanup
  close() {
    if (this.helper) {
      this.helper.close();
    }
    this.cache.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a request handler instance
 * @param {Object} config - Configuration options
 * @returns {Promise<RequestHandler>}
 */
async function createHandler(config = {}) {
  const handler = new RequestHandler(config);
  await handler.initialize();
  return handler;
}

/**
 * Quick start server with default configuration
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} Bun server instance
 */
async function startServer(config = {}) {
  const handler = await createHandler(config);
  return handler.start();
}

/**
 * Create a fetch handler for Bun.serve
 * @param {Object} config - Configuration options
 * @returns {Promise<Function>}
 */
async function createFetchHandler(config = {}) {
  const handler = await createHandler(config);
  return handler.handle;
}

// ============================================================================
// Exports
// ============================================================================

export {
  RequestHandler,
  DbMarkdownHelper,
  SQLSanitizer,
  HTMLSanitizer,
  OverrideProcessor,
  TemplateProcessor,
  ResponseCache,
  RateLimiter,
  createHandler,
  startServer,
  createFetchHandler,
  DEFAULT_CONFIG
};

export default RequestHandler;

// ============================================================================
// CLI Entry Point
// ============================================================================

// Run directly: bun run request-handler.js
if (import.meta.main) {
  const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    hostname: process.env.HOST || '0.0.0.0',
    dbPath: process.env.DB_PATH || './content.db',
    configPath: process.env.CONFIG_PATH || './config.yaml',
    basePath: process.env.BASE_PATH || '/api',
    enableCache: process.env.CACHE !== 'false',
    cacheTTL: parseInt(process.env.CACHE_TTL || '300', 10),
    prettyPrint: process.env.PRETTY === 'true',
    showErrorDetails: process.env.NODE_ENV !== 'production',
    enableCORS: true,
    siteName: process.env.SITE_NAME || 'My Site',
    siteUrl: process.env.SITE_URL || 'http://localhost:3000',
    rateLimit: {
      enabled: process.env.RATE_LIMIT === 'true',
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10)
    }
  };

  startServer(config).catch(console.error);
}