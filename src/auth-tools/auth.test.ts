/**
 * Tests for Bun Auth Helpers
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createAuthHelpers, InMemoryUserStore, type User } from "./auth";
import { SQLiteUserStore } from "./adapters";

// Create a test secret file
const TEST_SECRET = "test-secret-key-for-jwt-signing-minimum-32-chars";

beforeAll(async () => {
  await Bun.write("./test-secret.txt", TEST_SECRET);
});

afterAll(async () => {
  const file = Bun.file("./test-secret.txt");
  if (await file.exists()) {
    await Bun.write("./test-secret.txt", ""); // Clear content
  }
});

describe("SecretManager", () => {
  test("loads secret from file", async () => {
    const auth = createAuthHelpers({
      secretConfig: {
        type: "file",
        source: "./test-secret.txt",
        cacheSecret: true,
      },
      baseUrl: "http://localhost:3000",
    });

    const secret = await auth.secretManager.getSecret();
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(secret)).toBe(TEST_SECRET);
  });

  test("caches secret when configured", async () => {
    const auth = createAuthHelpers({
      secretConfig: {
        type: "file",
        source: "./test-secret.txt",
        cacheSecret: true,
      },
      baseUrl: "http://localhost:3000",
    });

    const secret1 = await auth.secretManager.getSecret();
    const secret2 = await auth.secretManager.getSecret();
    expect(secret1).toBe(secret2); // Same reference due to caching
  });
});

describe("InMemoryUserStore", () => {
  test("creates and retrieves user", async () => {
    const store = new InMemoryUserStore();
    const user: User = {
      id: "test-id",
      username: "testuser",
      passwordHash: "hashedpassword",
      confirmed: false,
      confirmationToken: "test-token",
      confirmationExpiry: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { email: "test@example.com" },
    };

    const created = await store.create(user);
    expect(created.id).toBe("test-id");

    const found = await store.findById("test-id");
    expect(found?.username).toBe("testuser");
  });

  test("finds user by username (case insensitive)", async () => {
    const store = new InMemoryUserStore();
    const user: User = {
      id: "test-id-2",
      username: "TestUser",
      passwordHash: "hashedpassword",
      confirmed: false,
      confirmationToken: "test-token-2",
      confirmationExpiry: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    await store.create(user);

    const found = await store.findByUsername("testuser");
    expect(found?.id).toBe("test-id-2");

    const foundUpper = await store.findByUsername("TESTUSER");
    expect(foundUpper?.id).toBe("test-id-2");
  });

  test("finds user by confirmation token", async () => {
    const store = new InMemoryUserStore();
    const user: User = {
      id: "test-id-3",
      username: "tokenuser",
      passwordHash: "hashedpassword",
      confirmed: false,
      confirmationToken: "unique-confirmation-token",
      confirmationExpiry: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    await store.create(user);

    const found = await store.findByConfirmationToken("unique-confirmation-token");
    expect(found?.username).toBe("tokenuser");
  });

  test("updates user", async () => {
    const store = new InMemoryUserStore();
    const user: User = {
      id: "test-id-4",
      username: "updateuser",
      passwordHash: "hashedpassword",
      confirmed: false,
      confirmationToken: "update-token",
      confirmationExpiry: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    await store.create(user);

    const updated = await store.update("test-id-4", {
      confirmed: true,
      confirmationToken: null,
    });

    expect(updated?.confirmed).toBe(true);
    expect(updated?.confirmationToken).toBeNull();
  });

  test("prevents duplicate usernames", async () => {
    const store = new InMemoryUserStore();
    const user1: User = {
      id: "test-id-5",
      username: "uniqueuser",
      passwordHash: "hashedpassword",
      confirmed: false,
      confirmationToken: null,
      confirmationExpiry: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    await store.create(user1);

    const user2: User = {
      ...user1,
      id: "test-id-6",
    };

    expect(store.create(user2)).rejects.toThrow("Username already exists");
  });
});

describe("Auth Handlers", () => {
  const auth = createAuthHelpers({
    secretConfig: {
      type: "file",
      source: "./test-secret.txt",
      cacheSecret: true,
    },
    baseUrl: "http://localhost:3000",
    jwtConfig: {
      algorithm: "HS256",
      expiresIn: "1h",
    },
  });

  describe("createUserHandler", () => {
    const handler = auth.createUserHandler();

    test("creates user with valid data", async () => {
      const request = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "newuser",
          password: "ValidPass123!",
          email: "new@example.com",
        }),
      });

      const response = await handler(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.confirmationUrl).toContain("/auth/confirm/");
    });

    test("rejects invalid email", async () => {
      const request = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "invalidemailuser",
          password: "ValidPass123!",
          email: "not-an-email",
        }),
      });

      const response = await handler(request);
      expect(response.status).toBe(400);
    });

    test("rejects short password", async () => {
      const request = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "shortpwuser",
          password: "short",
          email: "valid@example.com",
        }),
      });

      const response = await handler(request);
      expect(response.status).toBe(400);
    });
  });

  describe("confirmAccountHandler", () => {
    test("confirms valid token", async () => {
      // First create a user
      const createHandler = auth.createUserHandler();
      const createRequest = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "confirmuser",
          password: "ValidPass123!",
          email: "confirm@example.com",
        }),
      });

      const createResponse = await createHandler(createRequest);
      const createData = await createResponse.json();
      const token = createData.confirmationUrl.split("/").pop();

      // Now confirm
      const confirmHandler = auth.confirmAccountHandler();
      const confirmRequest = new Request(
        `http://localhost:3000/api/auth/confirm/${token}`,
        { method: "GET" }
      );

      const confirmResponse = await confirmHandler(confirmRequest);
      const confirmData = await confirmResponse.json();

      expect(confirmResponse.status).toBe(200);
      expect(confirmData.success).toBe(true);
    });

    test("rejects invalid token", async () => {
      const handler = auth.confirmAccountHandler();
      const request = new Request(
        "http://localhost:3000/api/auth/confirm/invalid-token",
        { method: "GET" }
      );

      const response = await handler(request);
      expect(response.status).toBe(404);
    });
  });

  describe("loginHandler", () => {
    test("issues JWT for valid credentials", async () => {
      // Create and confirm a user first
      const createHandler = auth.createUserHandler();
      const createRequest = new Request("http://localhost:3000/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "loginuser",
          password: "ValidPass123!",
          email: "login@example.com",
        }),
      });

      const createResponse = await createHandler(createRequest);
      const createData = await createResponse.json();
      const token = createData.confirmationUrl.split("/").pop();

      // Confirm the account
      const confirmHandler = auth.confirmAccountHandler();
      await confirmHandler(
        new Request(`http://localhost:3000/api/auth/confirm/${token}`, {
          method: "GET",
        })
      );

      // Now login
      const loginHandler = auth.loginHandler();
      const loginRequest = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "loginuser",
          password: "ValidPass123!",
        }),
      });

      const loginResponse = await loginHandler(loginRequest);
      const loginData = await loginResponse.json();

      expect(loginResponse.status).toBe(200);
      expect(loginData.success).toBe(true);
      expect(loginData.token).toBeDefined();
      expect(loginData.tokenType).toBe("Bearer");
    });

    test("rejects invalid password", async () => {
      const loginHandler = auth.loginHandler();
      const request = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "loginuser",
          password: "WrongPassword!",
        }),
      });

      const response = await loginHandler(request);
      expect(response.status).toBe(401);
    });
  });

  describe("publicJWTHandler", () => {
    test("issues public JWT", async () => {
      const handler = auth.publicJWTHandler({
        role: "guest",
        permissions: ["read"],
      });

      const request = new Request("http://localhost:3000/api/auth/public", {
        method: "POST",
      });

      const response = await handler(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.type).toBe("public");
      expect(data.token).toBeDefined();
    });
  });

  describe("validateJWTMiddleware", () => {
    test("validates correct JWT", async () => {
      // Get a valid token first
      const publicHandler = auth.publicJWTHandler();
      const publicRequest = new Request("http://localhost:3000/api/auth/public", {
        method: "POST",
      });
      const publicResponse = await publicHandler(publicRequest);
      const publicData = await publicResponse.json();

      // Now validate it
      const middleware = auth.validateJWTMiddleware();
      const protectedRequest = new Request("http://localhost:3000/api/protected", {
        headers: {
          Authorization: `Bearer ${publicData.token}`,
        },
      });

      const response = await middleware(protectedRequest, async (req, payload) => {
        return new Response(JSON.stringify({ user: payload.sub }), {
          status: 200,
        });
      });

      expect(response.status).toBe(200);
    });

    test("rejects missing token", async () => {
      const middleware = auth.validateJWTMiddleware();
      const request = new Request("http://localhost:3000/api/protected");

      const response = await middleware(request, async () => {
        return new Response("OK");
      });

      expect(response.status).toBe(401);
    });

    test("redirects on invalid token when configured", async () => {
      const middleware = auth.validateJWTMiddleware({
        onInvalid: "redirect",
        redirectUrl: "/login",
      });

      const request = new Request("http://localhost:3000/api/protected", {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });

      const response = await middleware(request, async () => {
        return new Response("OK");
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/login");
    });
  });

  describe("verifyJWT utility", () => {
    test("verifies valid JWT", async () => {
      const publicHandler = auth.publicJWTHandler();
      const request = new Request("http://localhost:3000/api/auth/public", {
        method: "POST",
      });
      const response = await publicHandler(request);
      const data = await response.json();

      const result = await auth.verifyJWT(data.token);

      expect(result.valid).toBe(true);
      expect(result.payload?.type).toBe("public");
    });

    test("rejects invalid JWT", async () => {
      const result = await auth.verifyJWT("invalid.token.here");

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe("SQLiteUserStore", () => {
  test("creates and retrieves user", async () => {
    const store = new SQLiteUserStore(":memory:");
    const user: User = {
      id: "sqlite-test-id",
      username: "sqliteuser",
      passwordHash: "hashedpassword",
      confirmed: false,
      confirmationToken: "sqlite-token",
      confirmationExpiry: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { email: "sqlite@example.com" },
    };

    const created = await store.create(user);
    expect(created.id).toBe("sqlite-test-id");

    const found = await store.findByUsername("sqliteuser");
    expect(found?.id).toBe("sqlite-test-id");
    expect(found?.metadata.email).toBe("sqlite@example.com");

    store.close();
  });
});