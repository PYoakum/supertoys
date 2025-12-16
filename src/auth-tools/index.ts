/**
 * Bun Authentication Helpers
 * 
 * A comprehensive authentication library for Bun applications featuring:
 * - Configurable secret management (file or endpoint)
 * - User account creation with customizable schemas
 * - Account confirmation via unique URLs
 * - JWT-based authentication with configurable algorithms
 * - Middleware for JWT validation
 * - Public/fallback JWT provisioning
 */

export {
  createAuthHelpers,
  SecretManager,
  InMemoryUserStore,
  type AuthHelpers,
  type SecretConfig,
  type UserSchema,
  type User,
  type JWTConfig,
  type LoginConfig,
  type ValidationResult,
  type ValidationConfig,
  type PublicJWTConfig,
  type UserStore,
} from "./auth";

export {
  SQLiteUserStore,
  RedisUserStore,
  HTTPUserStore,
} from "./adapters";/**
 * Bun Authentication Helpers
 * 
 * A comprehensive authentication library for Bun applications featuring:
 * - Configurable secret management (file or endpoint)
 * - User account creation with customizable schemas
 * - Account confirmation via unique URLs
 * - JWT-based authentication with configurable algorithms
 * - Middleware for JWT validation
 * - Public/fallback JWT provisioning
 */

export {
  createAuthHelpers,
  SecretManager,
  InMemoryUserStore,
  type AuthHelpers,
  type SecretConfig,
  type UserSchema,
  type User,
  type JWTConfig,
  type LoginConfig,
  type ValidationResult,
  type ValidationConfig,
  type PublicJWTConfig,
  type UserStore,
} from "./auth";

export {
  SQLiteUserStore,
  RedisUserStore,
  HTTPUserStore,
} from "./adapters";