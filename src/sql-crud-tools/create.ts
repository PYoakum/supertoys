import { getPool } from "./db-pool";
import type { QueryResult } from "./node_modules/@types/pg";

/**
 * Insert a new record into the database
 * @param table - Table name
 * @param data - Object containing column names and values
 * @param configPath - Path to the YAML configuration file
 * @returns The newly created record
 */
export async function create<T = any>(
  table: string,
  data: Record<string, any>,
  configPath?: string
): Promise<T> {
  const pool = getPool(configPath);
  
  const columns = Object.keys(data);
  const values = Object.values(data);
  
  // Create placeholders ($1, $2, etc.)
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const columnNames = columns.join(", ");
  
  const query = `
    INSERT INTO ${table} (${columnNames})
    VALUES (${placeholders})
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, values);
    return result.rows[0] as T;
  } catch (error) {
    console.error(`Error creating record in ${table}:`, error);
    throw error;
  }
}

/**
 * Insert multiple records into the database in a single query
 * @param table - Table name
 * @param records - Array of objects containing column names and values
 * @param configPath - Path to the YAML configuration file
 * @returns The newly created records
 */
export async function createMany<T = any>(
  table: string,
  records: Record<string, any>[],
  configPath?: string
): Promise<T[]> {
  if (records.length === 0) {
    return [];
  }
  
  const pool = getPool(configPath);
  
  const columns = Object.keys(records[0]);
  const columnNames = columns.join(", ");
  
  // Build values placeholders for multiple rows
  const valuePlaceholders: string[] = [];
  const allValues: any[] = [];
  
  records.forEach((record, recordIndex) => {
    const recordPlaceholders = columns.map((_, colIndex) => {
      const paramIndex = recordIndex * columns.length + colIndex + 1;
      return `$${paramIndex}`;
    }).join(", ");
    
    valuePlaceholders.push(`(${recordPlaceholders})`);
    allValues.push(...columns.map(col => record[col]));
  });
  
  const query = `
    INSERT INTO ${table} (${columnNames})
    VALUES ${valuePlaceholders.join(", ")}
    RETURNING *
  `;
  
  try {
    const result: QueryResult = await pool.query(query, allValues);
    return result.rows as T[];
  } catch (error) {
    console.error(`Error creating multiple records in ${table}:`, error);
    throw error;
  }
}