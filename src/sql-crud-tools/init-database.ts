import { Client } from "./node_modules/@types/pg";
import { loadDatabaseConfig } from "./config-loader";

/**
 * Initialize the database if it doesn't exist
 * @param configPath - Path to the YAML configuration file
 */
export async function initializeDatabase(configPath: string = "database.config.yaml") {
  const config = loadDatabaseConfig(configPath);
  
  // First connect to the default 'postgres' database to check if our database exists
  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: "postgres", // Connect to default database
    ssl: config.ssl,
    connectionTimeoutMillis: config.connection_timeout,
  });
  
  try {
    console.log("Connecting to PostgreSQL server...");
    await adminClient.connect();
    
    // Check if database exists
    const checkDbQuery = `
      SELECT 1 FROM pg_database WHERE datname = $1
    `;
    const result = await adminClient.query(checkDbQuery, [config.database]);
    
    if (result.rows.length === 0) {
      console.log(`Database '${config.database}' does not exist. Creating...`);
      
      // Create database (cannot use parameterized query for CREATE DATABASE)
      // Sanitize database name to prevent SQL injection
      const dbName = config.database.replace(/[^a-zA-Z0-9_]/g, "");
      await adminClient.query(`CREATE DATABASE ${dbName}`);
      
      console.log(`Database '${config.database}' created successfully!`);
    } else {
      console.log(`Database '${config.database}' already exists.`);
    }
    
    await adminClient.end();
    
    // Now connect to the actual database to set up tables
    const dbClient = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl,
      connectionTimeoutMillis: config.connection_timeout,
    });
    
    await dbClient.connect();
    console.log(`Connected to database '${config.database}'.`);
    
    // Create example tables (customize as needed)
    await createTables(dbClient);
    
    await dbClient.end();
    console.log("Database initialization completed successfully!");
    
  } catch (error) {
    console.error("Error during database initialization:", error);
    throw error;
  }
}

/**
 * Create initial database tables
 * @param client - Connected database client
 */
async function createTables(client: Client) {
  console.log("Creating tables...");
  
  // Example table creation - customize based on your needs
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createProductsTable = `
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(10, 2) NOT NULL,
      stock_quantity INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  await client.query(createUsersTable);
  console.log("  ✓ Users table created");
  
  await client.query(createProductsTable);
  console.log("  ✓ Products table created");
  
  // Add indexes for better performance
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)
  `);
  
  console.log("  ✓ Indexes created");
}

// Run initialization if this file is executed directly
if (import.meta.main) {
  initializeDatabase()
    .then(() => {
      console.log("\n✅ Database initialization complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Database initialization failed:", error);
      process.exit(1);
    });
}