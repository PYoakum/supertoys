/**
 * SQL Database CRUD Helper Functions
 * 
 * This module provides a complete set of CRUD operations for SQL databases
 * with configuration loaded from a YAML file.
 */

// Export configuration utilities
export { loadDatabaseConfig } from "./config-loader";
export type { DatabaseConfig } from "./config-loader";

// Export database pool management
export { getPool, closePool, getClient } from "./db-pool";

// Export initialization function
export { initializeDatabase } from "./init-database";

// Export CREATE operations
export { create, createMany } from "./create";

// Export READ operations
export { 
  findById, 
  findOne, 
  findMany, 
  findAll, 
  count 
} from "./read";
export type { QueryOptions } from "./read";

// Export UPDATE operations
export { 
  updateById, 
  updateMany, 
  increment, 
  decrement, 
  upsert 
} from "./update";

// Export DELETE operations
export { 
  deleteById, 
  deleteMany, 
  deleteAll, 
  softDeleteById, 
  softDeleteMany, 
  restoreById 
} from "./delete";