/**
 * @fileoverview SQLite Tools for database operations in sandbox
 * @module sqlite-tool
 */

import { Database } from 'bun:sqlite';
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * SQLite Tool - provides sqlite_create, database_execute, and sql_runner
 */
export class SQLiteTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for SQLiteTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {Map<string, Database>} */
    this.connections = new Map();

    /** @type {number} */
    this.maxResultRows = config.maxResultRows || 1000;

    /** @type {number} */
    this.queryTimeout = config.queryTimeout || 30000;
  }

  /**
   * Get or create database connection
   * @param {string} dbPath - Absolute path to database file
   * @param {Object} [options]
   * @returns {Database}
   */
  getConnection(dbPath, options = {}) {
    const key = dbPath;

    if (this.connections.has(key) && !options.forceNew) {
      return this.connections.get(key);
    }

    const db = new Database(dbPath, {
      create: options.create !== false,
      readonly: options.readonly || false
    });

    // Enable foreign keys by default
    db.run('PRAGMA foreign_keys = ON');

    this.connections.set(key, db);
    return db;
  }

  /**
   * Close a database connection
   * @param {string} dbPath
   */
  closeConnection(dbPath) {
    if (this.connections.has(dbPath)) {
      const db = this.connections.get(dbPath);
      db.close();
      this.connections.delete(dbPath);
    }
  }

  /**
   * Close all connections
   */
  closeAllConnections() {
    for (const [path, db] of this.connections) {
      db.close();
    }
    this.connections.clear();
  }

  // ==================== sqlite_create ====================

  /**
   * Create a new SQLite database file
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async sqliteCreate(args) {
    const { sessionId, path, options = {} } = args;

    if (!path) {
      throw new Error('path is required');
    }

    // Resolve path within sandbox
    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    // Check if already exists
    if (existsSync(absPath) && !options.overwrite) {
      const error = new Error(`Database already exists: ${path}`);
      error.code = 'FILE_EXISTS';
      throw error;
    }

    // Ensure parent directory exists
    await this.sandboxManager.ensureParentDir(absPath);

    // Create database
    const db = this.getConnection(absPath, { create: true, forceNew: true });

    // Apply initial pragmas if specified
    if (options.pragmas) {
      for (const [pragma, value] of Object.entries(options.pragmas)) {
        db.run(`PRAGMA ${pragma} = ${value}`);
      }
    }

    // Get database info
    const pageSize = db.query('PRAGMA page_size').get();
    const journalMode = db.query('PRAGMA journal_mode').get();

    const stats = await stat(absPath);

    return this.formatResponse({
      success: true,
      operation: 'sqlite_create',
      path,
      size: stats.size,
      created: stats.birthtime.toISOString(),
      settings: {
        pageSize: pageSize?.page_size,
        journalMode: journalMode?.journal_mode
      }
    });
  }

  // ==================== database_execute ====================

  /**
   * Execute schema/DDL statements (CREATE, ALTER, DROP, etc.)
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async databaseExecute(args) {
    const { sessionId, path, sql, statements = [] } = args;

    if (!path) {
      throw new Error('path is required');
    }
    if (!sql && (!statements || statements.length === 0)) {
      throw new Error('sql or statements is required');
    }

    // Resolve path within sandbox
    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    if (!existsSync(absPath)) {
      const error = new Error(`Database not found: ${path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }

    const db = this.getConnection(absPath);
    const results = [];

    // Get SQL statements to execute
    const sqlStatements = sql ? [sql] : statements;

    for (const statement of sqlStatements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;

      // Validate this looks like a schema statement
      const upperSql = trimmed.toUpperCase();
      const isSchemaStatement =
        upperSql.startsWith('CREATE') ||
        upperSql.startsWith('ALTER') ||
        upperSql.startsWith('DROP') ||
        upperSql.startsWith('PRAGMA') ||
        upperSql.startsWith('CREATE INDEX') ||
        upperSql.startsWith('CREATE UNIQUE') ||
        upperSql.startsWith('CREATE TRIGGER') ||
        upperSql.startsWith('CREATE VIEW');

      if (!isSchemaStatement) {
        // Allow but warn for non-schema statements
        results.push({
          sql: trimmed.substring(0, 100) + (trimmed.length > 100 ? '...' : ''),
          warning: 'Statement may not be a schema statement. Consider using sql_runner for queries.'
        });
      }

      try {
        const startTime = Date.now();
        db.run(trimmed);
        const duration = Date.now() - startTime;

        results.push({
          sql: trimmed.substring(0, 100) + (trimmed.length > 100 ? '...' : ''),
          success: true,
          duration
        });
      } catch (err) {
        results.push({
          sql: trimmed.substring(0, 100) + (trimmed.length > 100 ? '...' : ''),
          success: false,
          error: err.message
        });
      }
    }

    // Get updated schema info
    const tables = db.query(`
      SELECT name, type FROM sqlite_master
      WHERE type IN ('table', 'view', 'index', 'trigger')
      AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all();

    return this.formatResponse({
      success: results.every(r => r.success !== false),
      operation: 'database_execute',
      path,
      results,
      schema: {
        tables: tables.filter(t => t.type === 'table').map(t => t.name),
        views: tables.filter(t => t.type === 'view').map(t => t.name),
        indexes: tables.filter(t => t.type === 'index').map(t => t.name),
        triggers: tables.filter(t => t.type === 'trigger').map(t => t.name)
      }
    });
  }

  // ==================== sql_runner ====================

  /**
   * Run SQL queries (SELECT, INSERT, UPDATE, DELETE)
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async sqlRunner(args) {
    const {
      sessionId,
      path,
      query,
      params = [],
      options = {}
    } = args;

    if (!path) {
      throw new Error('path is required');
    }
    if (!query) {
      throw new Error('query is required');
    }

    // Resolve path within sandbox
    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    if (!existsSync(absPath)) {
      const error = new Error(`Database not found: ${path}`);
      error.code = 'FILE_NOT_FOUND';
      throw error;
    }

    const db = this.getConnection(absPath, {
      readonly: options.readonly
    });

    const trimmedQuery = query.trim();
    const upperQuery = trimmedQuery.toUpperCase();

    // Determine query type
    const isSelect = upperQuery.startsWith('SELECT') ||
                     upperQuery.startsWith('WITH') ||
                     upperQuery.startsWith('PRAGMA');
    const isInsert = upperQuery.startsWith('INSERT');
    const isUpdate = upperQuery.startsWith('UPDATE');
    const isDelete = upperQuery.startsWith('DELETE');

    const startTime = Date.now();

    try {
      if (isSelect) {
        // SELECT query - return rows
        const stmt = db.query(trimmedQuery);
        let rows;

        if (params.length > 0) {
          rows = stmt.all(...params);
        } else {
          rows = stmt.all();
        }

        const duration = Date.now() - startTime;

        // Limit rows returned
        const limitedRows = rows.slice(0, options.limit || this.maxResultRows);
        const truncated = rows.length > limitedRows.length;

        // Get column info
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

        return this.formatResponse({
          success: true,
          operation: 'sql_runner',
          queryType: 'SELECT',
          path,
          columns,
          rows: limitedRows,
          rowCount: rows.length,
          truncated,
          duration
        });

      } else {
        // Mutation query (INSERT/UPDATE/DELETE)
        let result;

        if (params.length > 0) {
          const stmt = db.query(trimmedQuery);
          result = stmt.run(...params);
        } else {
          result = db.run(trimmedQuery);
        }

        const duration = Date.now() - startTime;

        return this.formatResponse({
          success: true,
          operation: 'sql_runner',
          queryType: isInsert ? 'INSERT' : isUpdate ? 'UPDATE' : isDelete ? 'DELETE' : 'OTHER',
          path,
          changes: result.changes,
          lastInsertRowid: isInsert ? Number(result.lastInsertRowid) : undefined,
          duration
        });
      }

    } catch (err) {
      const duration = Date.now() - startTime;

      return this.formatResponse({
        success: false,
        operation: 'sql_runner',
        path,
        error: {
          message: err.message,
          code: err.code
        },
        duration
      });
    }
  }

  /**
   * Format response in MCP-compatible format
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * Register all SQLite tools with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    // sqlite_create
    router.registerTool(
      'sqlite_create',
      this.sqliteCreate.bind(this),
      {
        name: 'sqlite_create',
        description: 'Create a new SQLite database file in the sandbox.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional)'
            },
            path: {
              type: 'string',
              description: 'Relative path for the database file (e.g., "data/app.db")'
            },
            options: {
              type: 'object',
              properties: {
                overwrite: {
                  type: 'boolean',
                  default: false,
                  description: 'Overwrite if database exists'
                },
                pragmas: {
                  type: 'object',
                  description: 'Initial PRAGMA settings (e.g., {"journal_mode": "WAL"})',
                  additionalProperties: { type: 'string' }
                }
              }
            }
          },
          required: ['path']
        }
      }
    );

    // database_execute
    router.registerTool(
      'database_execute',
      this.databaseExecute.bind(this),
      {
        name: 'database_execute',
        description: 'Execute schema/DDL statements on a SQLite database (CREATE TABLE, ALTER, DROP, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional)'
            },
            path: {
              type: 'string',
              description: 'Relative path to the database file'
            },
            sql: {
              type: 'string',
              description: 'SQL schema statement to execute'
            },
            statements: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple SQL statements to execute in order'
            }
          },
          required: ['path']
        }
      }
    );

    // sql_runner
    router.registerTool(
      'sql_runner',
      this.sqlRunner.bind(this),
      {
        name: 'sql_runner',
        description: 'Run SQL queries on a SQLite database (SELECT, INSERT, UPDATE, DELETE).',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional)'
            },
            path: {
              type: 'string',
              description: 'Relative path to the database file'
            },
            query: {
              type: 'string',
              description: 'SQL query to execute'
            },
            params: {
              type: 'array',
              description: 'Query parameters for prepared statements',
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' }
                ]
              }
            },
            options: {
              type: 'object',
              properties: {
                readonly: {
                  type: 'boolean',
                  default: false,
                  description: 'Open database in read-only mode'
                },
                limit: {
                  type: 'integer',
                  default: 1000,
                  description: 'Maximum rows to return for SELECT queries'
                }
              }
            }
          },
          required: ['path', 'query']
        }
      }
    );
  }
}

/**
 * Create a SQLiteTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {SQLiteTool}
 */
export function createSQLiteTool(sandboxManager, config) {
  return new SQLiteTool(sandboxManager, config);
}

export default SQLiteTool;
