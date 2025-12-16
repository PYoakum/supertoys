/**
 * Example Bun Server using Auth Helpers
 * Demonstrates all authentication helper functions
 */

import { createAuthHelpers, type UserSchema } from "./auth";

// ============================================================================
// Configuration
// ============================================================================

// Option 1: Secret from file
const secretFromFile = {
  type: "file" as const,
  source: "./secrets/jwt-secret.txt",
  cacheSecret: true,
};

// Option 2: Secret from external endpoint
const secretFromEndpoint = {
  type: "endpoint" as const,
  source: "https://vault.example.com/api/secrets/jwt",
  headers: {
    Authorization: "Bearer vault-access-token",
    "X-Vault-Namespace": "production",
  },
  refreshIntervalMs: 3600000, // Refresh every hour
  cacheSecret: true,
};

// Custom user schema with additional fields
const customUserSchema: UserSchema = {
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
      // Require at least one uppercase, lowercase, number, and special char
      return /[A-Z]/.test(pwd) &&
        /[a-z]/.test(pwd) &&
        /[0-9]/.test(pwd) &&
        /[!@#$%^&*]/.test(pwd);
    },
  },
  email: {
    type: "email",
    required: true,
  },
  displayName: {
    type: "string",
    required: false,
    maxLength: 100,
  },
  acceptedTerms: {
    type: "boolean",
    required: true,
    validate: (value) => value === true,
  },
};

// ============================================================================
// Initialize Auth Helpers
// ============================================================================

const auth = createAuthHelpers({
  // Use file-based secret for this example (switch to secretFromEndpoint for production)
  secretConfig: secretFromFile,
  baseUrl: "http://localhost:3000",
  confirmationExpiryHours: 48,
  userSchema: customUserSchema,
  jwtConfig: {
    algorithm: "HS256",
    expiresIn: "2h",
    issuer: "my-app",
    audience: "my-app-users",
  },
});

// ============================================================================
// Create Route Handlers
// ============================================================================

// User registration handler with custom schema
const registerHandler = auth.createUserHandler();

// Account confirmation handler
const confirmHandler = auth.confirmAccountHandler();

// Regenerate confirmation link handler
const regenerateHandler = auth.regenerateConfirmationHandler();

// Login handler with custom field names and additional claims
const loginHandler = auth.loginHandler({
  usernameField: "username",
  passwordField: "password",
  algorithm: "HS256",
  expiresIn: "8h",
  additionalClaims: (user) => ({
    displayName: user.metadata.displayName,
    role: user.metadata.role ?? "user",
    permissions: user.metadata.permissions ?? ["read", "write"],
  }),
});

// Public JWT handler for unauthenticated users
const publicTokenHandler = auth.publicJWTHandler({
  role: "guest",
  permissions: ["read"],
  expiresIn: "24h",
  claims: {
    tier: "free",
  },
});

// JWT validation middleware with redirect on failure
const authMiddleware = auth.validateJWTMiddleware({
  onInvalid: "redirect",
  redirectUrl: "/login",
  requiredClaims: ["sub", "type"],
  claimValidators: {
    type: (value) => value === "authenticated" || value === "public",
  },
});

// JWT validation middleware with custom error handling
const apiAuthMiddleware = auth.validateJWTMiddleware({
  onInvalid: "custom",
  customHandler: (req, error) => {
    return new Response(
      JSON.stringify({
        error: "Authentication required",
        details: error,
        loginUrl: "/api/auth/login",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="api"',
        },
      }
    );
  },
  requiredClaims: ["sub"],
});

// ============================================================================
// Router
// ============================================================================

const router = {
  // Auth routes
  "POST /api/auth/register": registerHandler,
  "GET /api/auth/confirm/:token": confirmHandler,
  "POST /api/auth/resend-confirmation": regenerateHandler,
  "POST /api/auth/login": loginHandler,
  "POST /api/auth/public-token": publicTokenHandler,
};

// ============================================================================
// Server
// ============================================================================

const server = Bun.serve({
  port: 3000,

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // -------------------------------------------------------------------------
    // Auth Routes
    // -------------------------------------------------------------------------

    // Register new user
    if (method === "POST" && path === "/api/auth/register") {
      return registerHandler(req);
    }

    // Confirm account
    if (method === "GET" && path.startsWith("/api/auth/confirm/")) {
      return confirmHandler(req);
    }

    // Resend confirmation
    if (method === "POST" && path === "/api/auth/resend-confirmation") {
      return regenerateHandler(req);
    }

    // Login
    if (method === "POST" && path === "/api/auth/login") {
      return loginHandler(req);
    }

    // Get public token
    if (method === "POST" && path === "/api/auth/public-token") {
      return publicTokenHandler(req);
    }

    // -------------------------------------------------------------------------
    // Protected Routes (using middleware)
    // -------------------------------------------------------------------------

    // Protected API route example
    if (method === "GET" && path === "/api/protected/profile") {
      return apiAuthMiddleware(req, async (req, payload) => {
        // Access JWT claims in the handler
        return new Response(
          JSON.stringify({
            message: "Profile data",
            userId: payload.sub,
            username: payload.username,
            type: payload.type,
            role: payload.role,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });
    }

    // Protected route with role checking
    if (method === "GET" && path === "/api/admin/dashboard") {
      return apiAuthMiddleware(req, async (req, payload) => {
        // Check for admin role
        if (payload.role !== "admin") {
          return new Response(
            JSON.stringify({ error: "Admin access required" }),
            {
              status: 403,
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            message: "Admin dashboard data",
            adminId: payload.sub,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });
    }

    // Public route that accepts both authenticated and public tokens
    if (method === "GET" && path === "/api/public/content") {
      return apiAuthMiddleware(req, async (req, payload) => {
        const isAuthenticated = payload.type === "authenticated";

        return new Response(
          JSON.stringify({
            content: "This is public content",
            premium: isAuthenticated
              ? "Here's premium content for authenticated users"
              : null,
            userType: payload.type,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      });
    }

    // -------------------------------------------------------------------------
    // Manual JWT verification example
    // -------------------------------------------------------------------------

    if (method === "GET" && path === "/api/verify-token") {
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response(JSON.stringify({ error: "Token required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = await auth.verifyJWT(token);
      return new Response(JSON.stringify(result), {
        status: result.valid ? 200 : 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // -------------------------------------------------------------------------
    // Health check
    // -------------------------------------------------------------------------

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // -------------------------------------------------------------------------
    // 404 handler
    // -------------------------------------------------------------------------

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
});

console.log(`🚀 Auth server running at http://localhost:${server.port}`);

// ============================================================================
// API Documentation
// ============================================================================

console.log(`
📜 API Endpoints:

Authentication:
  POST /api/auth/register          - Create new user account
  GET  /api/auth/confirm/:token    - Confirm account via token
  POST /api/auth/resend-confirmation - Request new confirmation link
  POST /api/auth/login             - Login and get JWT
  POST /api/auth/public-token      - Get public/guest JWT

Protected Routes:
  GET  /api/protected/profile      - Get user profile (requires auth)
  GET  /api/admin/dashboard        - Admin only route
  GET  /api/public/content         - Public content (auth optional)

Utilities:
  GET  /api/verify-token?token=X   - Manually verify a JWT
  GET  /health                     - Health check

Example Usage:

1. Register:
   curl -X POST http://localhost:3000/api/auth/register \\
     -H "Content-Type: application/json" \\
     -d '{"username":"testuser","password":"SecurePass123!","email":"test@example.com","acceptedTerms":true}'

2. Confirm (use the URL from registration response):
   curl http://localhost:3000/api/auth/confirm/YOUR_TOKEN

3. Login:
   curl -X POST http://localhost:3000/api/auth/login \\
     -H "Content-Type: application/json" \\
     -d '{"username":"testuser","password":"SecurePass123!"}'

4. Access protected route:
   curl http://localhost:3000/api/protected/profile \\
     -H "Authorization: Bearer YOUR_JWT_TOKEN"

5. Get public token:
   curl -X POST http://localhost:3000/api/auth/public-token
`);