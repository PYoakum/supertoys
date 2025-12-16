/**
 * Bun Authentication Helpers
 * A comprehensive authentication library for Bun applications
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomUUID, createHash } from "crypto";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface SecretConfig {
  type: "file" | "endpoint";
  source: string;
  headers?: Record<string, string>;
  refreshIntervalMs?: number;
  cacheSecret?: boolean;
}

export interface UserSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "email" | "date";
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    validate?: (value: unknown) => boolean;
  };
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  confirmed: boolean;
  confirmationToken: string | null;
  confirmationExpiry: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface JWTConfig {
  algorithm?: "HS256" | "HS384" | "HS512";
  expiresIn?: string;
  issuer?: string;
  audience?: string;
}

export interface LoginConfig {
  usernameField?: string;
  passwordField?: string;
  additionalClaims?: (user: User) => Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  payload?: JWTPayload & Record<string, unknown>;
  error?: string;
}

export interface ValidationConfig {
  onInvalid?: "block" | "redirect" | "custom";
  redirectUrl?: string;
  customHandler?: (req: Request, error: string) => Response;
  requiredClaims?: string[];
  claimValidators?: Record<string, (value: unknown) => boolean>;
}

export interface PublicJWTConfig {
  claims?: Record<string, unknown>;
  role?: string;
  permissions?: string[];
}

export interface UserStore {
  create: (user: User) => Promise<User>;
  findById: (id: string) => Promise<User | null>;
  findByUsername: (username: string) => Promise<User | null>;
  findByConfirmationToken: (token: string) => Promise<User | null>;
  update: (id: string, updates: Partial<User>) => Promise<User | null>;
  delete: (id: string) => Promise<boolean>;
}

// ============================================================================
// Secret Manager
// ============================================================================

export class SecretManager {
  private config: SecretConfig;
  private cachedSecret: Uint8Array | null = null;
  private lastFetch: number = 0;

  constructor(config: SecretConfig) {
    this.config = config;
  }

  async getSecret(): Promise<Uint8Array> {
    const now = Date.now();
    const refreshInterval = this.config.refreshIntervalMs ?? 3600000; // 1 hour default

    if (
      this.config.cacheSecret &&
      this.cachedSecret &&
      now - this.lastFetch < refreshInterval
    ) {
      return this.cachedSecret;
    }

    let secretString: string;

    if (this.config.type === "file") {
      const file = Bun.file(this.config.source);
      if (!(await file.exists())) {
        throw new Error(`Secret file not found: ${this.config.source}`);
      }
      secretString = (await file.text()).trim();
    } else {
      const response = await fetch(this.config.source, {
        headers: this.config.headers,
      });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch secret from endpoint: ${response.status}`
        );
      }
      const data = await response.json();
      secretString = data.secret || data.key || data.value;
      if (!secretString) {
        throw new Error("Secret not found in endpoint response");
      }
    }

    this.cachedSecret = new TextEncoder().encode(secretString);
    this.lastFetch = now;

    return this.cachedSecret;
  }

  clearCache(): void {
    this.cachedSecret = null;
    this.lastFetch = 0;
  }
}

// ============================================================================
// In-Memory User Store (Default Implementation)
// ============================================================================

export class InMemoryUserStore implements UserStore {
  private users: Map<string, User> = new Map();
  private usernameIndex: Map<string, string> = new Map();
  private confirmationIndex: Map<string, string> = new Map();

  async create(user: User): Promise<User> {
    if (this.usernameIndex.has(user.username.toLowerCase())) {
      throw new Error("Username already exists");
    }
    this.users.set(user.id, user);
    this.usernameIndex.set(user.username.toLowerCase(), user.id);
    if (user.confirmationToken) {
      this.confirmationIndex.set(user.confirmationToken, user.id);
    }
    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const id = this.usernameIndex.get(username.toLowerCase());
    return id ? this.users.get(id) ?? null : null;
  }

  async findByConfirmationToken(token: string): Promise<User | null> {
    const id = this.confirmationIndex.get(token);
    return id ? this.users.get(id) ?? null : null;
  }

  async update(id: string, updates: Partial<User>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;

    // Update confirmation index if token changed
    if (user.confirmationToken) {
      this.confirmationIndex.delete(user.confirmationToken);
    }

    const updatedUser = { ...user, ...updates, updatedAt: new Date() };
    this.users.set(id, updatedUser);

    if (updatedUser.confirmationToken) {
      this.confirmationIndex.set(updatedUser.confirmationToken, id);
    }

    return updatedUser;
  }

  async delete(id: string): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) return false;

    this.usernameIndex.delete(user.username.toLowerCase());
    if (user.confirmationToken) {
      this.confirmationIndex.delete(user.confirmationToken);
    }
    this.users.delete(id);
    return true;
  }
}

// ============================================================================
// Password Utilities
// ============================================================================

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 65536,
    timeCost: 3,
  });
}

async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// ============================================================================
// Schema Validation
// ============================================================================

function validateSchema(
  data: Record<string, unknown>,
  schema: UserSchema
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    if (rules.required && (value === undefined || value === null)) {
      errors.push(`${field} is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    switch (rules.type) {
      case "string":
        if (typeof value !== "string") {
          errors.push(`${field} must be a string`);
        } else {
          if (rules.minLength && value.length < rules.minLength) {
            errors.push(
              `${field} must be at least ${rules.minLength} characters`
            );
          }
          if (rules.maxLength && value.length > rules.maxLength) {
            errors.push(
              `${field} must be at most ${rules.maxLength} characters`
            );
          }
          if (rules.pattern && !rules.pattern.test(value)) {
            errors.push(`${field} format is invalid`);
          }
        }
        break;
      case "email":
        if (
          typeof value !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ) {
          errors.push(`${field} must be a valid email`);
        }
        break;
      case "number":
        if (typeof value !== "number") {
          errors.push(`${field} must be a number`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          errors.push(`${field} must be a boolean`);
        }
        break;
      case "date":
        if (!(value instanceof Date) && isNaN(Date.parse(value as string))) {
          errors.push(`${field} must be a valid date`);
        }
        break;
    }

    if (rules.validate && !rules.validate(value)) {
      errors.push(`${field} failed custom validation`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Auth Helper Factory
// ============================================================================

export function createAuthHelpers(options: {
  secretConfig: SecretConfig;
  userStore?: UserStore;
  baseUrl: string;
  confirmationExpiryHours?: number;
  userSchema?: UserSchema;
  jwtConfig?: JWTConfig;
}) {
  const secretManager = new SecretManager(options.secretConfig);
  const userStore = options.userStore ?? new InMemoryUserStore();
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const confirmationExpiryHours = options.confirmationExpiryHours ?? 24;
  const defaultJwtConfig: JWTConfig = {
    algorithm: "HS256",
    expiresIn: "1h",
    issuer: "auth-helper",
    ...options.jwtConfig,
  };

  const defaultUserSchema: UserSchema = {
    username: {
      type: "string",
      required: true,
      minLength: 3,
      maxLength: 50,
    },
    password: {
      type: "string",
      required: true,
      minLength: 8,
    },
    email: {
      type: "email",
      required: true,
    },
    ...options.userSchema,
  };

  // --------------------------------------------------------------------------
  // Helper 1: Create User Account Handler
  // --------------------------------------------------------------------------
  function createUserHandler(
    customSchema?: UserSchema
  ): (req: Request) => Promise<Response> {
    const schema = customSchema ?? defaultUserSchema;

    return async (req: Request): Promise<Response> => {
      try {
        if (req.method !== "POST") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = await req.json();
        const { username, password, email, ...metadata } = body;

        // Validate against schema
        const validation = validateSchema(
          { username, password, email, ...metadata },
          schema
        );
        if (!validation.valid) {
          return new Response(
            JSON.stringify({ error: "Validation failed", details: validation.errors }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        // Check for existing user
        const existingUser = await userStore.findByUsername(username);
        if (existingUser) {
          return new Response(
            JSON.stringify({ error: "Username already exists" }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          );
        }

        // Create confirmation token
        const confirmationToken = randomUUID();
        const confirmationExpiry = new Date(
          Date.now() + confirmationExpiryHours * 60 * 60 * 1000
        );

        // Hash password and create user
        const passwordHash = await hashPassword(password);
        const user: User = {
          id: randomUUID(),
          username,
          passwordHash,
          confirmed: false,
          confirmationToken,
          confirmationExpiry,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { email, ...metadata },
        };

        await userStore.create(user);

        const confirmationUrl = `${baseUrl}/auth/confirm/${confirmationToken}`;

        return new Response(
          JSON.stringify({
            success: true,
            userId: user.id,
            confirmationUrl,
            message: "Account created. Please confirm your account.",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Create user error:", error);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    };
  }

  // --------------------------------------------------------------------------
  // Helper 2: Account Confirmation Handler
  // --------------------------------------------------------------------------
  function confirmAccountHandler(): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      try {
        if (req.method !== "GET") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
        }

        const url = new URL(req.url);
        const pathParts = url.pathname.split("/");
        const token = pathParts[pathParts.length - 1];

        if (!token) {
          return new Response(
            JSON.stringify({ error: "Confirmation token required" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const user = await userStore.findByConfirmationToken(token);

        if (!user) {
          return new Response(
            JSON.stringify({ error: "Invalid confirmation token" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );
        }

        if (user.confirmed) {
          return new Response(
            JSON.stringify({ message: "Account already confirmed" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (user.confirmationExpiry && user.confirmationExpiry < new Date()) {
          return new Response(
            JSON.stringify({
              error: "Confirmation token expired",
              hint: "Request a new confirmation link",
            }),
            { status: 410, headers: { "Content-Type": "application/json" } }
          );
        }

        await userStore.update(user.id, {
          confirmed: true,
          confirmationToken: null,
          confirmationExpiry: null,
        });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Account confirmed successfully",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Confirm account error:", error);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    };
  }

  // --------------------------------------------------------------------------
  // Helper 3: Regenerate Confirmation URL Handler
  // --------------------------------------------------------------------------
  function regenerateConfirmationHandler(): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      try {
        if (req.method !== "POST") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = await req.json();
        const { username, email } = body;

        if (!username && !email) {
          return new Response(
            JSON.stringify({ error: "Username or email required" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        let user: User | null = null;
        if (username) {
          user = await userStore.findByUsername(username);
        }

        if (!user) {
          // Don't reveal if user exists for security
          return new Response(
            JSON.stringify({
              message:
                "If an account exists, a new confirmation link will be generated",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (user.confirmed) {
          return new Response(
            JSON.stringify({ message: "Account is already confirmed" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        const newToken = randomUUID();
        const newExpiry = new Date(
          Date.now() + confirmationExpiryHours * 60 * 60 * 1000
        );

        await userStore.update(user.id, {
          confirmationToken: newToken,
          confirmationExpiry: newExpiry,
        });

        const confirmationUrl = `${baseUrl}/auth/confirm/${newToken}`;

        return new Response(
          JSON.stringify({
            success: true,
            confirmationUrl,
            expiresAt: newExpiry.toISOString(),
            message: "New confirmation link generated",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Regenerate confirmation error:", error);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    };
  }

  // --------------------------------------------------------------------------
  // Helper 4: Login Handler (JWT Provisioning)
  // --------------------------------------------------------------------------
  function loginHandler(
    config?: LoginConfig & JWTConfig
  ): (req: Request) => Promise<Response> {
    const usernameField = config?.usernameField ?? "username";
    const passwordField = config?.passwordField ?? "password";
    const algorithm = config?.algorithm ?? defaultJwtConfig.algorithm;
    const expiresIn = config?.expiresIn ?? defaultJwtConfig.expiresIn;
    const issuer = config?.issuer ?? defaultJwtConfig.issuer;
    const audience = config?.audience ?? defaultJwtConfig.audience;

    return async (req: Request): Promise<Response> => {
      try {
        if (req.method !== "POST") {
          return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = await req.json();
        const username = body[usernameField];
        const password = body[passwordField];

        if (!username || !password) {
          return new Response(
            JSON.stringify({ error: "Username and password required" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }

        const user = await userStore.findByUsername(username);

        if (!user) {
          return new Response(
            JSON.stringify({ error: "Invalid credentials" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        if (!user.confirmed) {
          return new Response(
            JSON.stringify({ error: "Account not confirmed" }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          );
        }

        const passwordValid = await verifyPassword(password, user.passwordHash);
        if (!passwordValid) {
          return new Response(
            JSON.stringify({ error: "Invalid credentials" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        const secret = await secretManager.getSecret();
        const additionalClaims = config?.additionalClaims?.(user) ?? {};

        let jwtBuilder = new SignJWT({
          sub: user.id,
          username: user.username,
          email: user.metadata.email,
          type: "authenticated",
          ...additionalClaims,
        })
          .setProtectedHeader({ alg: algorithm! })
          .setIssuedAt()
          .setExpirationTime(expiresIn!);

        if (issuer) jwtBuilder = jwtBuilder.setIssuer(issuer);
        if (audience) jwtBuilder = jwtBuilder.setAudience(audience);

        const token = await jwtBuilder.sign(secret);

        return new Response(
          JSON.stringify({
            success: true,
            token,
            tokenType: "Bearer",
            expiresIn,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Login error:", error);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    };
  }

  // --------------------------------------------------------------------------
  // Helper 5: JWT Validation Middleware
  // --------------------------------------------------------------------------
  function validateJWTMiddleware(
    validationConfig?: ValidationConfig & JWTConfig
  ): (
    req: Request,
    next: (req: Request, payload: JWTPayload) => Promise<Response>
  ) => Promise<Response> {
    const algorithm = validationConfig?.algorithm ?? defaultJwtConfig.algorithm;
    const issuer = validationConfig?.issuer ?? defaultJwtConfig.issuer;
    const audience = validationConfig?.audience ?? defaultJwtConfig.audience;
    const onInvalid = validationConfig?.onInvalid ?? "block";
    const redirectUrl = validationConfig?.redirectUrl ?? "/login";
    const requiredClaims = validationConfig?.requiredClaims ?? [];
    const claimValidators = validationConfig?.claimValidators ?? {};

    const handleInvalid = (req: Request, error: string): Response => {
      if (onInvalid === "custom" && validationConfig?.customHandler) {
        return validationConfig.customHandler(req, error);
      }

      if (onInvalid === "redirect") {
        return new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
      }

      return new Response(JSON.stringify({ error }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    return async (
      req: Request,
      next: (req: Request, payload: JWTPayload) => Promise<Response>
    ): Promise<Response> => {
      try {
        const authHeader = req.headers.get("Authorization");

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return handleInvalid(req, "Missing or invalid authorization header");
        }

        const token = authHeader.slice(7);
        const secret = await secretManager.getSecret();

        const { payload } = await jwtVerify(token, secret, {
          algorithms: [algorithm!],
          issuer,
          audience,
        });

        // Check required claims
        for (const claim of requiredClaims) {
          if (!(claim in payload)) {
            return handleInvalid(req, `Missing required claim: ${claim}`);
          }
        }

        // Run claim validators
        for (const [claim, validator] of Object.entries(claimValidators)) {
          if (claim in payload && !validator(payload[claim])) {
            return handleInvalid(req, `Invalid claim value: ${claim}`);
          }
        }

        return next(req, payload);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes("expired")) {
            return handleInvalid(req, "Token expired");
          }
          if (error.message.includes("signature")) {
            return handleInvalid(req, "Invalid token signature");
          }
        }
        return handleInvalid(req, "Invalid token");
      }
    };
  }

  // --------------------------------------------------------------------------
  // Helper 6: Public/Fallback JWT Handler
  // --------------------------------------------------------------------------
  function publicJWTHandler(
    config?: PublicJWTConfig & JWTConfig
  ): (req: Request) => Promise<Response> {
    const algorithm = config?.algorithm ?? defaultJwtConfig.algorithm;
    const expiresIn = config?.expiresIn ?? "24h";
    const issuer = config?.issuer ?? defaultJwtConfig.issuer;
    const audience = config?.audience ?? defaultJwtConfig.audience;
    const role = config?.role ?? "public";
    const permissions = config?.permissions ?? ["read"];
    const additionalClaims = config?.claims ?? {};

    return async (req: Request): Promise<Response> => {
      try {
        const secret = await secretManager.getSecret();

        // Generate a unique session ID for tracking
        const sessionId = randomUUID();

        let jwtBuilder = new SignJWT({
          sub: `public:${sessionId}`,
          type: "public",
          role,
          permissions,
          sessionId,
          ...additionalClaims,
        })
          .setProtectedHeader({ alg: algorithm! })
          .setIssuedAt()
          .setExpirationTime(expiresIn);

        if (issuer) jwtBuilder = jwtBuilder.setIssuer(issuer);
        if (audience) jwtBuilder = jwtBuilder.setAudience(audience);

        const token = await jwtBuilder.sign(secret);

        return new Response(
          JSON.stringify({
            success: true,
            token,
            tokenType: "Bearer",
            type: "public",
            expiresIn,
            sessionId,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (error) {
        console.error("Public JWT error:", error);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    };
  }

  // --------------------------------------------------------------------------
  // Utility: Verify any JWT and return payload
  // --------------------------------------------------------------------------
  async function verifyJWT(
    token: string,
    jwtConfig?: JWTConfig
  ): Promise<ValidationResult> {
    try {
      const secret = await secretManager.getSecret();
      const algorithm = jwtConfig?.algorithm ?? defaultJwtConfig.algorithm;
      const issuer = jwtConfig?.issuer ?? defaultJwtConfig.issuer;
      const audience = jwtConfig?.audience ?? defaultJwtConfig.audience;

      const { payload } = await jwtVerify(token, secret, {
        algorithms: [algorithm!],
        issuer,
        audience,
      });

      return {
        valid: true,
        payload: payload as JWTPayload & Record<string, unknown>,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Invalid token",
      };
    }
  }

  // --------------------------------------------------------------------------
  // Return all handlers and utilities
  // --------------------------------------------------------------------------
  return {
    // Request handlers
    createUserHandler,
    confirmAccountHandler,
    regenerateConfirmationHandler,
    loginHandler,
    validateJWTMiddleware,
    publicJWTHandler,

    // Utilities
    verifyJWT,
    secretManager,
    userStore,

    // Schema validation utility
    validateSchema,
  };
}

// Export types for external use
export type AuthHelpers = ReturnType<typeof createAuthHelpers>;