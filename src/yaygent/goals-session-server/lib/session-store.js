/**
 * @fileoverview In-memory session store with TTL and cleanup
 * @module session-store
 */

import { SessionNotFoundError, SessionExpiredError } from './errors.js';

/**
 * @typedef {Object} StoreOptions
 * @property {number} [ttlMs=3600000] - Time-to-live for inactive sessions (1 hour)
 * @property {number} [maxAge=86400000] - Maximum session age (24 hours)
 * @property {number} [cleanupIntervalMs=60000] - Cleanup interval (1 minute)
 * @property {number} [maxSessions=1000] - Maximum concurrent sessions
 */

/**
 * Default store options
 * @type {StoreOptions}
 */
const DEFAULT_OPTIONS = {
  ttlMs: 3600000,          // 1 hour
  maxAge: 86400000,        // 24 hours
  cleanupIntervalMs: 60000, // 1 minute
  maxSessions: 1000
};

/**
 * In-memory session store
 */
export class SessionStore {
  /**
   * @param {StoreOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {StoreOptions} */
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    /** @type {Map<string, Object>} */
    this.sessions = new Map();
    
    /** @type {NodeJS.Timeout|null} */
    this.cleanupTimer = null;
    
    // Start cleanup timer
    this.startCleanup();
  }

  /**
   * Start the cleanup timer
   * @private
   */
  startCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupIntervalMs);
    
    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop the cleanup timer
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up expired sessions
   * @returns {number} Number of sessions removed
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    
    for (const [id, session] of this.sessions) {
      const createdAt = new Date(session.metadata.createdAt).getTime();
      const lastAccessed = session.metadata.lastAccessedAt 
        ? new Date(session.metadata.lastAccessedAt).getTime()
        : createdAt;
      
      // Check max age
      if (now - createdAt > this.options.maxAge) {
        this.sessions.delete(id);
        removed++;
        continue;
      }
      
      // Check TTL (time since last access)
      if (now - lastAccessed > this.options.ttlMs) {
        this.sessions.delete(id);
        removed++;
      }
    }
    
    return removed;
  }

  /**
   * Create a new session
   * @param {Object} sessionData - Initial session data
   * @returns {Object} Created session
   * @throws {Error} If max sessions exceeded
   */
  create(sessionData) {
    if (this.sessions.size >= this.options.maxSessions) {
      // Try cleanup first
      this.cleanup();
      
      if (this.sessions.size >= this.options.maxSessions) {
        throw new Error(`Maximum sessions exceeded (${this.options.maxSessions})`);
      }
    }
    
    const session = {
      ...sessionData,
      metadata: {
        ...sessionData.metadata,
        createdAt: sessionData.metadata?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        version: 1
      }
    };
    
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID
   * @param {string} sessionId - Session ID
   * @param {boolean} [updateAccess=true] - Update last accessed time
   * @returns {Object} Session data
   * @throws {SessionNotFoundError}
   */
  get(sessionId, updateAccess = true) {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    
    // Check if expired
    const now = Date.now();
    const createdAt = new Date(session.metadata.createdAt).getTime();
    
    if (now - createdAt > this.options.maxAge) {
      this.sessions.delete(sessionId);
      throw new SessionExpiredError(sessionId);
    }
    
    // Update last accessed time
    if (updateAccess) {
      session.metadata.lastAccessedAt = new Date().toISOString();
    }
    
    return session;
  }

  /**
   * Update a session
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Fields to update
   * @returns {Object} Updated session
   * @throws {SessionNotFoundError}
   */
  update(sessionId, updates) {
    const session = this.get(sessionId);
    
    // Merge updates (shallow merge at top level, deep merge for metadata)
    const updated = {
      ...session,
      ...updates,
      metadata: {
        ...session.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        version: session.metadata.version + 1
      }
    };
    
    // Preserve the ID
    updated.id = sessionId;
    
    this.sessions.set(sessionId, updated);
    return updated;
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session ID
   * @returns {boolean} True if deleted
   */
  delete(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * Check if a session exists
   * @param {string} sessionId - Session ID
   * @returns {boolean}
   */
  has(sessionId) {
    return this.sessions.has(sessionId);
  }

  /**
   * List all sessions
   * @param {Object} [options] - List options
   * @param {string} [options.state] - Filter by state
   * @param {number} [options.limit=20] - Maximum results
   * @param {number} [options.offset=0] - Pagination offset
   * @param {string} [options.sortBy='createdAt'] - Sort field
   * @param {string} [options.sortOrder='desc'] - Sort order
   * @returns {{sessions: Object[], pagination: Object}}
   */
  list(options = {}) {
    const {
      state,
      limit = 20,
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;
    
    // Get all sessions as array
    let sessions = Array.from(this.sessions.values());
    
    // Filter by state if specified
    if (state) {
      sessions = sessions.filter(s => s.state === state);
    }
    
    // Sort
    sessions.sort((a, b) => {
      let aVal, bVal;
      
      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        aVal = new Date(a.metadata[sortBy]).getTime();
        bVal = new Date(b.metadata[sortBy]).getTime();
      } else {
        aVal = a[sortBy];
        bVal = b[sortBy];
      }
      
      if (sortOrder === 'desc') {
        return bVal - aVal;
      }
      return aVal - bVal;
    });
    
    const total = sessions.length;
    
    // Paginate
    sessions = sessions.slice(offset, offset + limit);
    
    return {
      sessions: sessions.map(s => ({
        id: s.id,
        state: s.state,
        goalsCount: s.goals?.items?.length || 0,
        createdAt: s.metadata.createdAt,
        updatedAt: s.metadata.updatedAt
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + sessions.length < total
      }
    };
  }

  /**
   * Get store statistics
   * @returns {Object}
   */
  getStats() {
    const sessions = Array.from(this.sessions.values());
    const byState = {};
    
    for (const session of sessions) {
      byState[session.state] = (byState[session.state] || 0) + 1;
    }
    
    return {
      totalSessions: sessions.length,
      maxSessions: this.options.maxSessions,
      byState
    };
  }

  /**
   * Clear all sessions
   */
  clear() {
    this.sessions.clear();
  }
}

export default SessionStore;
