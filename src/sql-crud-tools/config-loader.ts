import { parse } from "yaml";
import { readFileSync } from "fs";
import { join } from "path";

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
  connection_timeout?: number;
  max_connections?: number;
}

/**
 * Load database configuration from YAML file
 * @param configPath - Path to the YAML configuration file
 * @returns Database configuration object
 */
export function loadDatabaseConfig(configPath: string = "database.config.yaml"): DatabaseConfig {
  try {
    const fileContent = readFileSync(configPath, "utf8");
    const config = parse(fileContent);
    
    if (!config.database) {
      throw new Error("Invalid configuration: 'database' section not found");
    }
    
    const dbConfig = config.database;
    
    // Validate required fields
    const required = ["host", "port", "user", "password", "database"];
    for (const field of required) {
      if (!dbConfig[field]) {
        throw new Error(`Missing required configuration field: ${field}`);
      }
    }
    
    return dbConfig as DatabaseConfig;
  } catch (error) {
    console.error("Error loading database configuration:", error);
    throw error;
  }
}