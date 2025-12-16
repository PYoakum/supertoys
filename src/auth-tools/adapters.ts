/**
 * Database Adapters for Auth Helpers
 * Examples of persistent storage implementations
 */

import { Database } from "bun:sqlite";
import type { User, UserStore } from "./auth";

// ============================================================================
// SQLite User Store
// ============================================================================

export class SQLiteUserStore implements UserStore {
  private db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        confirmed INTEGER DEFAULT 0,
        confirmation_token TEXT,
        confirmation_expiry TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_username ON users(username)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_confirmation_token ON users(confirmation_token)
    `);
  }

  private rowToUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      confirmed: Boolean(row.confirmed),
      confirmationToken: row.confirmation_token,
      confirmationExpiry: row.confirmation_expiry
        ? new Date(row.confirmation_expiry)
        : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  async create(user: User): Promise<User> {
    const stmt = this.db.prepare(`
      INSERT INTO users (
        id, username, password_hash, confirmed,
        confirmation_token, confirmation_expiry,
        created_at, updated_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        user.id,
        user.username,
        user.passwordHash,
        user.confirmed ? 1 : 0,
        user.confirmationToken,
        user.confirmationExpiry?.toISOString() ?? null,
        user.createdAt.toISOString(),
        user.updatedAt.toISOString(),
        JSON.stringify(user.metadata)
      );
      return user;
    } catch (error: any) {
      if (error.message.includes("UNIQUE constraint failed")) {
        throw new Error("Username already exists");
      }
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    const stmt = this.db.prepare("SELECT * FROM users WHERE id = ?");
    const row = stmt.get(id);
    return row ? this.rowToUser(row) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const stmt = this.db.prepare(
      "SELECT * FROM users WHERE LOWER(username) = LOWER(?)"
    );
    const row = stmt.get(username);
    return row ? this.rowToUser(row) : null;
  }

  async findByConfirmationToken(token: string): Promise<User | null> {
    const stmt = this.db.prepare(
      "SELECT * FROM users WHERE confirmation_token = ?"
    );
    const row = stmt.get(token);
    return row ? this.rowToUser(row) : null;
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.username !== undefined) {
      fields.push("username = ?");
      values.push(updates.username);
    }
    if (updates.passwordHash !== undefined) {
      fields.push("password_hash = ?");
      values.push(updates.passwordHash);
    }
    if (updates.confirmed !== undefined) {
      fields.push("confirmed = ?");
      values.push(updates.confirmed ? 1 : 0);
    }
    if (updates.confirmationToken !== undefined) {
      fields.push("confirmation_token = ?");
      values.push(updates.confirmationToken);
    }
    if (updates.confirmationExpiry !== undefined) {
      fields.push("confirmation_expiry = ?");
      values.push(updates.confirmationExpiry?.toISOString() ?? null);
    }
    if (updates.metadata !== undefined) {
      fields.push("metadata = ?");
      values.push(JSON.stringify(updates.metadata));
    }

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    const stmt = this.db.prepare(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`
    );
    stmt.run(...values);

    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.db.prepare("DELETE FROM users WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

// ============================================================================
// Redis User Store (using Bun's fetch for Redis HTTP API)
// ============================================================================

export class RedisUserStore implements UserStore {
  private redisUrl: string;
  private headers: Record<string, string>;

  constructor(options: {
    url: string;
    token?: string;
  }) {
    this.redisUrl = options.url;
    this.headers = {
      "Content-Type": "application/json",
    };
    if (options.token) {
      this.headers["Authorization"] = `Bearer ${options.token}`;
    }
  }

  private async redis(
    command: string,
    ...args: (string | number)[]
  ): Promise<any> {
    const response = await fetch(this.redisUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify([command, ...args]),
    });
    const data = await response.json();
    return data.result;
  }

  private userKey(id: string): string {
    return `user:${id}`;
  }

  private usernameKey(username: string): string {
    return `username:${username.toLowerCase()}`;
  }

  private tokenKey(token: string): string {
    return `token:${token}`;
  }

  async create(user: User): Promise<User> {
    // Check if username exists
    const existingId = await this.redis("GET", this.usernameKey(user.username));
    if (existingId) {
      throw new Error("Username already exists");
    }

    // Store user data
    await this.redis("SET", this.userKey(user.id), JSON.stringify(user));

    // Create username index
    await this.redis("SET", this.usernameKey(user.username), user.id);

    // Create token index if exists
    if (user.confirmationToken) {
      await this.redis("SET", this.tokenKey(user.confirmationToken), user.id);
    }

    return user;
  }

  async findById(id: string): Promise<User | null> {
    const data = await this.redis("GET", this.userKey(id));
    if (!data) return null;

    const user = JSON.parse(data);
    user.createdAt = new Date(user.createdAt);
    user.updatedAt = new Date(user.updatedAt);
    if (user.confirmationExpiry) {
      user.confirmationExpiry = new Date(user.confirmationExpiry);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    const id = await this.redis("GET", this.usernameKey(username));
    if (!id) return null;
    return this.findById(id);
  }

  async findByConfirmationToken(token: string): Promise<User | null> {
    const id = await this.redis("GET", this.tokenKey(token));
    if (!id) return null;
    return this.findById(id);
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    // Remove old token index if it exists
    if (existing.confirmationToken) {
      await this.redis("DEL", this.tokenKey(existing.confirmationToken));
    }

    const updated: User = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    // Store updated user
    await this.redis("SET", this.userKey(id), JSON.stringify(updated));

    // Create new token index if exists
    if (updated.confirmationToken) {
      await this.redis("SET", this.tokenKey(updated.confirmationToken), id);
    }

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const user = await this.findById(id);
    if (!user) return false;

    await this.redis("DEL", this.userKey(id));
    await this.redis("DEL", this.usernameKey(user.username));
    if (user.confirmationToken) {
      await this.redis("DEL", this.tokenKey(user.confirmationToken));
    }

    return true;
  }
}

// ============================================================================
// Generic HTTP API User Store (for external user services)
// ============================================================================

export class HTTPUserStore implements UserStore {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(options: {
    baseUrl: string;
    apiKey?: string;
    headers?: Record<string, string>;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (options.apiKey) {
      this.headers["Authorization"] = `Bearer ${options.apiKey}`;
    }
  }

  private parseUser(data: any): User {
    return {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
      confirmationExpiry: data.confirmationExpiry
        ? new Date(data.confirmationExpiry)
        : null,
    };
  }

  async create(user: User): Promise<User> {
    const response = await fetch(`${this.baseUrl}/users`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(user),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to create user");
    }

    return this.parseUser(await response.json());
  }

  async findById(id: string): Promise<User | null> {
    const response = await fetch(`${this.baseUrl}/users/${id}`, {
      headers: this.headers,
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to fetch user");

    return this.parseUser(await response.json());
  }

  async findByUsername(username: string): Promise<User | null> {
    const response = await fetch(
      `${this.baseUrl}/users?username=${encodeURIComponent(username)}`,
      { headers: this.headers }
    );

    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to fetch user");

    const users = await response.json();
    return users.length > 0 ? this.parseUser(users[0]) : null;
  }

  async findByConfirmationToken(token: string): Promise<User | null> {
    const response = await fetch(
      `${this.baseUrl}/users?confirmationToken=${encodeURIComponent(token)}`,
      { headers: this.headers }
    );

    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to fetch user");

    const users = await response.json();
    return users.length > 0 ? this.parseUser(users[0]) : null;
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    const response = await fetch(`${this.baseUrl}/users/${id}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(updates),
    });

    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Failed to update user");

    return this.parseUser(await response.json());
  }

  async delete(id: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/users/${id}`, {
      method: "DELETE",
      headers: this.headers,
    });

    return response.ok;
  }
}

// ============================================================================
// Usage Examples
// ============================================================================

/*
// SQLite Example:
import { createAuthHelpers } from "./auth";
import { SQLiteUserStore } from "./adapters";

const sqliteStore = new SQLiteUserStore("./data/users.db");
const auth = createAuthHelpers({
  secretConfig: { type: "file", source: "./secrets/jwt.key" },
  userStore: sqliteStore,
  baseUrl: "http://localhost:3000",
});

// Redis Example (Upstash):
import { RedisUserStore } from "./adapters";

const redisStore = new RedisUserStore({
  url: "https://your-redis.upstash.io",
  token: process.env.UPSTASH_REDIS_TOKEN,
});
const auth = createAuthHelpers({
  secretConfig: { type: "file", source: "./secrets/jwt.key" },
  userStore: redisStore,
  baseUrl: "http://localhost:3000",
});

// External API Example:
import { HTTPUserStore } from "./adapters";

const httpStore = new HTTPUserStore({
  baseUrl: "https://api.yourservice.com/v1",
  apiKey: process.env.USER_SERVICE_API_KEY,
});
const auth = createAuthHelpers({
  secretConfig: { type: "file", source: "./secrets/jwt.key" },
  userStore: httpStore,
  baseUrl: "http://localhost:3000",
});
*/