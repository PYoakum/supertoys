import { Pool, PoolClient } from "./node_modules/@types/pg";
import { loadDatabaseConfig } from "./config-loader";

let pool: Pool | null = null;

/**
 * Get or create a database connection pool
 * @param configPath - Path to the YAML configuration file
 * @returns Database connection pool
 */
export function getPool(configPath: string = "database.config.yaml"): Pool {
  if (!pool) {
    const config = loadDatabaseConfig(configPath);
    
    pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl,
      connectionTimeoutMillis: config.connection_timeout,
      max: config.max_connections || 10,
    });
    
    // Handle pool errors
    pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
    });
  }
  
  return pool;
}

/**
 * Close the database connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns Database client
 */
export async function getClient(configPath?: string): Promise<PoolClient> {
  const poolInstance = getPool(configPath);
  return await poolInstance.connect();
}