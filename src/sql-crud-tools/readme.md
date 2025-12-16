# Bun Database CRUD Helpers

A collection of TypeScript helper functions for performing CRUD operations on PostgreSQL databases using Bun runtime. All database configuration is managed through a single YAML file.

## Features

- 🚀 Built specifically for Bun runtime
- 📝 YAML-based configuration
- 🔒 Type-safe operations with TypeScript
- 🛡️ Protection against accidental full-table updates/deletes
- 📦 Separate, focused functions for each CRUD operation
- 🎯 Simple and intuitive API
- ✅ Automatic database and table initialization

## Installation

```bash
bun install
```

This will install the required dependencies:
- `postgres` - PostgreSQL client for JavaScript
- `yaml` - YAML parser

## Configuration

Edit `db-config.yaml` to configure your database connection:

```yaml
database:
  host: localhost
  port: 5432
  user: postgres
  password: your_password_here
  database: myapp_db

schema:
  tables:
    - name: users
      columns:
        - name: id
          type: SERIAL PRIMARY KEY
        - name: email
          type: VARCHAR(255) UNIQUE NOT NULL
        - name: username
          type: VARCHAR(100) NOT NULL
        - name: created_at
          type: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

## Database Initialization

Initialize your database and create tables:

```bash
bun run init
```

Or programmatically:

```typescript
import { initializeDatabase } from "./index";

await initializeDatabase();
```

## Usage

### CREATE Operations

```typescript
import { create } from "./index";

// Create a new user
const user = await create("users", {
  email: "user@example.com",
  username: "johndoe"
});
// Returns: { id: 1, email: "user@example.com", username: "johndoe", created_at: ... }
```

### READ Operations

```typescript
import { read, readById } from "./index";

// Get all records
const allUsers = await read("users");

// Get with WHERE conditions
const activeUsers = await read("users", { 
  status: "active" 
});

// Get with pagination and sorting
const posts = await read("posts", {}, {
  limit: 10,
  offset: 0,
  orderBy: "created_at DESC"
});

// Get a single record by ID
const user = await readById("users", 1);
// Returns the user or null if not found
```

### UPDATE Operations

```typescript
import { update, updateById } from "./index";

// Update records matching conditions
const updated = await update(
  "users",
  { username: "newname" },
  { id: 1 }
);

// Update by ID (convenience method)
const user = await updateById(
  "users",
  1,
  { email: "new@example.com" }
);
// Returns the updated user or null if not found
```

### DELETE Operations

```typescript
import { remove, removeById, softDelete } from "./index";

// Delete records matching conditions
const deleted = await remove("users", { id: 1 });

// Delete by ID (convenience method)
const user = await removeById("users", 1);
// Returns the deleted user or null if not found

// Soft delete (requires 'deleted_at' column)
const softDeleted = await softDelete("users", { id: 1 });
```

## Safety Features

### Required WHERE Clauses

To prevent accidental full-table operations, both `update()` and `remove()` require non-empty WHERE conditions:

```typescript
// ❌ This will throw an error
await update("users", { status: "inactive" }, {});

// ✅ This is safe
await update("users", { status: "inactive" }, { last_login: null });
```

### Type Safety

All functions support generic typing:

```typescript
interface User {
  id: number;
  email: string;
  username: string;
  created_at: Date;
}

const user = await create<User>("users", {
  email: "user@example.com",
  username: "johndoe"
});
// user is typed as User
```

## Example Usage

Run the complete example:

```bash
bun run example
```

Or check out `example-usage.ts` for a comprehensive demonstration of all CRUD operations.

## API Reference

### create(tableName, data)
Insert a new record and return it.

### read(tableName, where?, options?)
Query records with optional filtering, pagination, and sorting.

### readById(tableName, id, idColumn?)
Get a single record by ID.

### update(tableName, data, where)
Update records matching conditions and return updated records.

### updateById(tableName, id, data, idColumn?)
Update a single record by ID and return it.

### remove(tableName, where)
Delete records matching conditions and return deleted records.

### removeById(tableName, id, idColumn?)
Delete a single record by ID and return it.

### softDelete(tableName, where)
Mark records as deleted (requires `deleted_at` column).

## Project Structure

```
.
├── config.ts           # Configuration loader
├── create.ts          # CREATE operations
├── read.ts            # READ operations
├── update.ts          # UPDATE operations
├── delete.ts          # DELETE operations
├── init-db.ts         # Database initialization
├── index.ts           # Main exports
├── db-config.yaml     # Database configuration
├── example-usage.ts   # Usage examples
└── README.md          # Documentation
```

## Notes

- All database connections are automatically closed after each operation
- The library uses the `postgres` package which supports connection pooling
- Each function creates a new connection; for high-performance scenarios, consider implementing connection pooling
- The initialization script will create the database if it doesn't exist (requires appropriate permissions)

## License

MIT

psql -d postgres

DROP DATABASE app_db;