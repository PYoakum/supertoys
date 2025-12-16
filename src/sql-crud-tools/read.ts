import { getPool } from "./db-pool";
import type { QueryResult } from "./node_modules/@types/pg";

export interface QueryOptions {
  where?: Record<string, any>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

/**
 * Find a single record by ID
 * @param table - Table name
 * @param id - Record ID
 * @param configPath - Path to the YAML configuration file
 * @returns The found record or null
 */
export async function findById<T = any>(
  table: string,
  id: number | string,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const query = `SELECT * FROM ${table} WHERE id = $1 LIMIT 1`;
  
  try {
    const result: QueryResult = await pool.query(query, [id]);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error finding record by ID in ${table}:`, error);
    throw error;
  }
}

/**
 * Find a single record by custom conditions
 * @param table - Table name
 * @param conditions - Object containing column names and values to match
 * @param configPath - Path to the YAML configuration file
 * @returns The found record or null
 */
export async function findOne<T = any>(
  table: string,
  conditions: Record<string, any>,
  configPath?: string
): Promise<T | null> {
  const pool = getPool(configPath);
  
  const columns = Object.keys(conditions);
  const values = Object.values(conditions);
  
  const whereClause = columns
    .map((col, index) => `${col} = $${index + 1}`)
    .join(" AND ");
  
  const query = `SELECT * FROM ${table} WHERE ${whereClause} LIMIT 1`;
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows.length > 0 ? (result.rows[0] as T) : null;
  } catch (error) {
    console.error(`Error finding record in ${table}:`, error);
    throw error;
  }
}

/**
 * Find all records matching conditions
 * @param table - Table name
 * @param options - Query options including where, orderBy, limit, offset
 * @param configPath - Path to the YAML configuration file
 * @returns Array of matching records
 */
export async function findMany<T = any>(
  table: string,
  options: QueryOptions = {},
  configPath?: string
): Promise<T[]> {
  const pool = getPool(configPath);
  
  let query = `SELECT * FROM ${table}`;
  const values: any[] = [];
  let paramCounter = 1;
  
  // Add WHERE clause if conditions provided
  if (options.where && Object.keys(options.where).length > 0) {
    const columns = Object.keys(options.where);
    const whereClause = columns
      .map((col) => `${col} = $${paramCounter++}`)
      .join(" AND ");
    
    query += ` WHERE ${whereClause}`;
    values.push(...Object.values(options.where));
  }
  
  // Add ORDER BY clause
  if (options.orderBy) {
    query += ` ORDER BY ${options.orderBy}`;
  }
  
  // Add LIMIT clause
  if (options.limit) {
    query += ` LIMIT $${paramCounter++}`;
    values.push(options.limit);
  }
  
  // Add OFFSET clause
  if (options.offset) {
    query += ` OFFSET $${paramCounter++}`;
    values.push(options.offset);
  }
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows as T[];
  } catch (error) {
    console.error(`Error finding records in ${table}:`, error);
    throw error;
  }
}

/**
 * Find all records in a table
 * @param table - Table name
 * @param configPath - Path to the YAML configuration file
 * @returns Array of all records
 */
export async function findAll<T = any>(
  table: string,
  configPath?: string
): Promise<T[]> {
  const pool = getPool(configPath);
  
  const query = `SELECT * FROM ${table}`;
  
  try {
    const result: QueryResult = await pool.query(query);
    return result.rows as T[];
  } catch (error) {
    console.error(`Error finding all records in ${table}:`, error);
    throw error;
  }
}

/**
 * Count records matching conditions
 * @param table - Table name
 * @param conditions - Object containing column names and values to match
 * @param configPath - Path to the YAML configuration file
 * @returns Number of matching records
 */
export async function count(
  table: string,
  conditions?: Record<string, any>,
  configPath?: string
): Promise<number> {
  const pool = getPool(configPath);
  
  let query = `SELECT COUNT(*) FROM ${table}`;
  const values: any[] = [];
  
  if (conditions && Object.keys(conditions).length > 0) {
    const columns = Object.keys(conditions);
    const whereClause = columns
      .map((col, index) => `${col} = $${index + 1}`)
      .join(" AND ");
    
    query += ` WHERE ${whereClause}`;
    values.push(...Object.values(conditions));
  }
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error(`Error counting records in ${table}:`, error);
    throw error;
  }
}