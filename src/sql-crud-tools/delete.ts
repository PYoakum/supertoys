import { getPool } from "./db-pool";
import type { QueryResult } from "./node_modules/@types/pg";

/**
 * Delete a record by ID
 * @param table - Table name
 * @param id - Record ID
 * @param configPath - Path to the YAML configuration file
 * @returns The deleted record or null if not found
 */
export async function deleteById<T = any>(
  table: string,
  id: number | string,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const query = `DELETE FROM ${table} WHERE id = $1 RETURNING *`;
  
  try {
    const result: QueryResult = await pool.query(query, [id]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error deleting record by ID in ${table}:`, error);
    throw error;
  }
}

/**
 * Delete records matching conditions
 * @param table - Table name
 * @param conditions - Object containing column names and values to match
 * @param configPath - Path to the YAML configuration file
 * @returns Array of deleted records
 */
export async function deleteMany<T = any>(
  table: string,
  conditions: Record<string, any>,
  configPath?: string
): Promise<T[]> {
  const pool = getPool(configPath);
  
  const columns = Object.keys(conditions);
  const values = Object.values(conditions);
  
  const whereClause = columns
    .map((col, index) => `${col} = $${index + 1}`)
    .join(" AND ");
  
  const query = `DELETE FROM ${table} WHERE ${whereClause} RETURNING *`;
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows as T[];
  } catch (error) {
    console.error(`Error deleting records in ${table}:`, error);
    throw error;
  }
}

/**
 * Delete all records from a table (use with caution!)
 * @param table - Table name
 * @param configPath - Path to the YAML configuration file
 * @returns Number of deleted records
 */
export async function deleteAll(
  table: string,
  configPath?: string
): Promise<number> {
  const pool = getPool(configPath);
  
  const query = `DELETE FROM ${table}`;
  
  try {
    const result: QueryResult = await pool.query(query);
    return result.rowCount || 0;
  } catch (error) {
    console.error(`Error deleting all records in ${table}:`, error);
    throw error;
  }
}

/**
 * Soft delete a record by ID (sets a deleted_at timestamp)
 * Note: Requires a 'deleted_at' column in the table
 * @param table - Table name
 * @param id - Record ID
 * @param configPath - Path to the YAML configuration file
 * @returns The soft-deleted record or null if not found
 */
export async function softDeleteById<T = any>(
  table: string,
  id: number | string,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const query = `
    UPDATE ${table}
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, [id]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error soft deleting record by ID in ${table}:`, error);
    throw error;
  }
}

/**
 * Soft delete records matching conditions
 * Note: Requires a 'deleted_at' column in the table
 * @param table - Table name
 * @param conditions - Object containing column names and values to match
 * @param configPath - Path to the YAML configuration file
 * @returns Array of soft-deleted records
 */
export async function softDeleteMany<T = any>(
  table: string,
  conditions: Record<string, any>,
  configPath?: string
): Promise<T[]> {
  const pool = getPool(configPath);
  
  const columns = Object.keys(conditions);
  const values = Object.values(conditions);
  
  const whereClause = columns
    .map((col, index) => `${col} = $${index + 1}`)
    .join(" AND ");
  
  const query = `
    UPDATE ${table}
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE ${whereClause} AND deleted_at IS NULL
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows as T[];
  } catch (error) {
    console.error(`Error soft deleting records in ${table}:`, error);
    throw error;
  }
}

/**
 * Restore a soft-deleted record by ID
 * Note: Requires a 'deleted_at' column in the table
 * @param table - Table name
 * @param id - Record ID
 * @param configPath - Path to the YAML configuration file
 * @returns The restored record or null if not found
 */
export async function restoreById<T = any>(
  table: string,
  id: number | string,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const query = `
    UPDATE ${table}
    SET deleted_at = NULL
    WHERE id = $1 AND deleted_at IS NOT NULL
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, [id]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error restoring record by ID in ${table}:`, error);
    throw error;
  }
}