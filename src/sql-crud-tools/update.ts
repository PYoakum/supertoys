import { getPool } from "./db-pool";
import type { QueryResult } from "./node_modules/@types/pg";

/**
 * Update a record by ID
 * @param table - Table name
 * @param id - Record ID
 * @param data - Object containing column names and new values
 * @param configPath - Path to the YAML configuration file
 * @returns The updated record or null if not found
 */
export async function updateById<T = any>(
  table: string,
  id: number | string,
  data: Record<string, any>,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const columns = Object.keys(data);
  const values = Object.values(data);
  
  // Add updated_at timestamp if the column exists
  const setClause = columns
    .map((col, index) => `${col} = $${index + 1}`)
    .join(", ");
  
  // Add ID as the last parameter
  values.push(id);
  
  const query = `
    UPDATE ${table}
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${values.length}
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error updating record by ID in ${table}:`, error);
    throw error;
  }
}

/**
 * Update records matching conditions
 * @param table - Table name
 * @param conditions - Object containing column names and values to match
 * @param data - Object containing column names and new values
 * @param configPath - Path to the YAML configuration file
 * @returns Array of updated records
 */
export async function updateMany<T = any>(
  table: string,
  conditions: Record<string, any>,
  data: Record<string, any>,
  configPath?: string
): Promise<T[]> {
  const pool = getPool(configPath);
  
  const updateColumns = Object.keys(data);
  const updateValues = Object.values(data);
  
  const conditionColumns = Object.keys(conditions);
  const conditionValues = Object.values(conditions);
  
  const setClause = updateColumns
    .map((col, index) => `${col} = $${index + 1}`)
    .join(", ");
  
  const whereClause = conditionColumns
    .map((col, index) => `${col} = $${updateValues.length + index + 1}`)
    .join(" AND ");
  
  const allValues = [...updateValues, ...conditionValues];
  
  const query = `
    UPDATE ${table}
    SET ${setClause}, updated_at = CURRENT_TIMESTAMP
    WHERE ${whereClause}
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, allValues);
    return result.rows as T[];
  } catch (error) {
    console.error(`Error updating records in ${table}:`, error);
    throw error;
  }
}

/**
 * Increment a numeric field by a given amount
 * @param table - Table name
 * @param id - Record ID
 * @param field - Field name to increment
 * @param amount - Amount to increment by (default: 1)
 * @param configPath - Path to the YAML configuration file
 * @returns The updated record or null if not found
 */
export async function increment<T = any>(
  table: string,
  id: number | string,
  field: string,
  amount: number = 1,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const query = `
    UPDATE ${table}
    SET ${field} = ${field} + $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, [amount, id]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error incrementing field in ${table}:`, error);
    throw error;
  }
}

/**
 * Decrement a numeric field by a given amount
 * @param table - Table name
 * @param id - Record ID
 * @param field - Field name to decrement
 * @param amount - Amount to decrement by (default: 1)
 * @param configPath - Path to the YAML configuration file
 * @returns The updated record or null if not found
 */
export async function decrement<T = any>(
  table: string,
  id: number | string,
  field: string,
  amount: number = 1,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const query = `
    UPDATE ${table}
    SET ${field} = ${field} - $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, [amount, id]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error decrementing field in ${table}:`, error);
    throw error;
  }
}

/**
 * Upsert a record (update if exists, insert if not)
 * @param table - Table name
 * @param uniqueField - Field name to check for uniqueness
 * @param data - Object containing column names and values
 * @param configPath - Path to the YAML configuration file
 * @returns The upserted record
 */
export async function upsert<T = any>(
  table: string,
  uniqueField: string,
  data: Record<string, any>,
  configPath?: string
): Promise<T> {
  const pool = getPool(configPath);
  
  const columns = Object.keys(data);
  const values = Object.values(data);
  
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const columnNames = columns.join(", ");
  
  // Build the update clause for conflict resolution
  const updateClause = columns
    .filter(col => col !== uniqueField)
    .map(col => `${col} = EXCLUDED.${col}`)
    .join(", ");
  
  const query = `
    INSERT INTO ${table} (${columnNames})
    VALUES (${placeholders})
    ON CONFLICT (${uniqueField})
    DO UPDATE SET ${updateClause}, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows[0] as T;
  } catch (error) {
    console.error(`Error upserting record in ${table}:`, error);
    throw error;
  }
}