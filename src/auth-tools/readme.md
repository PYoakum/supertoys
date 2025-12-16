# Bun Auth Helpers

A comprehensive authentication helper library for Bun applications featuring configurable secret management, JWT-based authentication, and flexible user storage.

## Features

- **Configurable Secret Management**: Load secrets from files or external endpoints
- **User Account Creation**: Customizable user schema validation
- **Account Confirmation**: Unique URL-based account verification
- **JWT Authentication**: Configurable algorithms (HS256, HS384, HS512)
- **Middleware**: JWT validation with redirect/block/custom responses
- **Public JWT**: Fallback tokens for unauthenticated traffic
- **Multiple Storage Adapters**: In-memory, SQLite, Redis, HTTP API

## Installation

```bash
bun add bun-auth-helpers jose
```

## Quick Start

```typescript
import { createAuthHelpers } from "bun-auth-helpers";

const auth = createAuthHelpers({
  secretConfig: {
    type: "file",
    source: "./secrets/jwt-secret.txt",
    cacheSecret: true,
  },
  baseUrl: "http://localhost:3000",
  jwtConfig: {
    algorithm: "HS256",
    expiresIn: "2h",
    issuer: "my-app",
  },
});

// Use the handlers in your server
Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    
    if (url.pathname === "/register") {
      return auth.createUserHandler()(req);
    }
    if (url.pathname === "/login") {
      return auth.loginHandler()(req);
    }
    // ... more routes
  },
});
```

## Secret Configuration

### From File

```typescript
const secretConfig = {
  type: "file",
  source: "./secrets/jwt-secret.txt",
  cacheSecret: true,
};
```

### From External Endpoint

```typescript
const secretConfig = {
  type: "endpoint",
  source: "https://vault.example.com/api/secrets/jwt",
  headers: {
    Authorization: "Bearer vault-token",
  },
  refreshIntervalMs: 3600000, // Refresh every hour
  cacheSecret: true,
};
```

## Handler Functions

### 1. User Registration

```typescript
const registerHandler = auth.createUserHandler();

// Custom schema
const customHandler = auth.createUserHandler({
  username: { type: "string", required: true, minLength: 3 },
  password: { type: "string", required: true, minLength: 12 },
  email: { type: "email", required: true },
  age: { type: "number", required: false },
});
```

**Request:**
```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"username":"john","password":"SecurePass123!","email":"john@example.com"}'
```

**Response:**
```json
{
  "success": true,
  "userId": "uuid-here",
  "confirmationUrl": "http://localhost:3000/auth/confirm/token-here",
  "message": "Account created. Please confirm your account."
}
```

### 2. Account Confirmation

```typescript
const confirmHandler = auth.confirmAccountHandler();
```

**Request:**
```bash
curl http://localhost:3000/auth/confirm/confirmation-token-here
```

**Response:**
```json
{
  "success": true,
  "message": "Account confirmed successfully"
}
```

### 3. Regenerate Confirmation URL

```typescript
const regenerateHandler = auth.regenerateConfirmationHandler();
```

**Request:**
```bash
curl -X POST http://localhost:3000/resend-confirmation \
  -H "Content-Type: application/json" \
  -d '{"username":"john"}'
```

**Response:**
```json
{
  "success": true,
  "confirmationUrl": "http://localhost:3000/auth/confirm/new-token",
  "expiresAt": "2024-01-02T00:00:00.000Z",
  "message": "New confirmation link generated"
}
```

### 4. Login (JWT Provisioning)

```typescript
const loginHandler = auth.loginHandler({
  usernameField: "username",
  passwordField: "password",
  expiresIn: "8h",
  additionalClaims: (user) => ({
    role: user.metadata.role ?? "user",
    permissions: ["read", "write"],
  }),
});
```

**Request:**
```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"john","password":"SecurePass123!"}'
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": "8h"
}
```

### 5. JWT Validation Middleware

```typescript
// Block invalid requests
const authMiddleware = auth.validateJWTMiddleware({
  onInvalid: "block",
  requiredClaims: ["sub", "role"],
});

// Redirect invalid requests
const redirectMiddleware = auth.validateJWTMiddleware({
  onInvalid: "redirect",
  redirectUrl: "/login",
});

// Custom handler
const customMiddleware = auth.validateJWTMiddleware({
  onInvalid: "custom",
  customHandler: (req, error) => {
    return new Response(JSON.stringify({ error }), {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="api"' },
    });
  },
  claimValidators: {
    role: (value) => ["admin", "user"].includes(value as string),
  },
});

// Usage
app.get("/protected", (req) => {
  return authMiddleware(req, async (req, payload) => {
    // payload contains decoded JWT claims
    return new Response(`Hello ${payload.username}`);
  });
});
```

### 6. Public JWT (Fallback)

```typescript
const publicHandler = auth.publicJWTHandler({
  role: "guest",
  permissions: ["read"],
  expiresIn: "24h",
  claims: {
    tier: "free",
  },
});
```

**Request:**
```bash
curl -X POST http://localhost:3000/public-token
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "type": "public",
  "expiresIn": "24h",
  "sessionId": "uuid-here"
}
```

## Storage Adapters

### SQLite

```typescript
import { SQLiteUserStore } from "bun-auth-helpers/adapters";

const store = new SQLiteUserStore("./data/users.db");
const auth = createAuthHelpers({
  secretConfig: { type: "file", source: "./secret.txt" },
  userStore: store,
  baseUrl: "http://localhost:3000",
});
```

### Redis (via HTTP API)

```typescript
import { RedisUserStore } from "bun-auth-helpers/adapters";

const store = new RedisUserStore({
  url: "https://your-redis.upstash.io",
  token: process.env.REDIS_TOKEN,
});
```

### External HTTP API

```typescript
import { HTTPUserStore } from "bun-auth-helpers/adapters";

const store = new HTTPUserStore({
  baseUrl: "https://api.users.example.com",
  apiKey: process.env.USER_SERVICE_KEY,
});
```

### Custom Adapter

Implement the `UserStore` interface:

```typescript
interface UserStore {
  create: (user: User) => Promise<User>;
  findById: (id: string) => Promise<User | null>;
  findByUsername: (username: string) => Promise<User | null>;
  findByConfirmationToken: (token: string) => Promise<User | null>;
  update: (id: string, updates: Partial<User>) => Promise<User | null>;
  delete: (id: string) => Promise<boolean>;
}
```

## User Schema Validation

```typescript
const schema: UserSchema = {
  username: {
    type: "string",
    required: true,
    minLength: 3,
    maxLength: 30,
    pattern: /^[a-zA-Z0-9_]+$/,
  },
  password: {
    type: "string",
    required: true,
    minLength: 12,
    validate: (value) => {
      const pwd = value as string;
      return /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /[0-9]/.test(pwd);
    },
  },
  email: {
    type: "email",
    required: true,
  },
  age: {
    type: "number",
    required: false,
    validate: (value) => (value as number) >= 18,
  },
};
```

## JWT Configuration

```typescript
interface JWTConfig {
  algorithm?: "HS256" | "HS384" | "HS512";
  expiresIn?: string;  // "1h", "7d", "30m", etc.
  issuer?: string;
  audience?: string;
}
```

## Manual JWT Verification

```typescript
const result = await auth.verifyJWT(token);

if (result.valid) {
  console.log("User ID:", result.payload.sub);
  console.log("Role:", result.payload.role);
} else {
  console.log("Error:", result.error);
}
```

## Complete Server Example

See `src/server.ts` for a complete implementation example with all routes configured.

## Running Tests

```bash
bun test
```

## License

MIT