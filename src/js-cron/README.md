# Bun Task Scheduler

A flexible and lightweight task scheduler for Bun that executes imported functions based on cron schedules defined in a JSON configuration file.

## Features

- ⏰ **Cron-based scheduling** - Use standard cron expressions
- 📦 **Dynamic imports** - Load task functions from any module
- ⚙️ **JSON configuration** - Easy to manage and version control
- 🔄 **Hot reload** - Use `bun --watch` for development
- 🎯 **Function arguments** - Pass arguments to scheduled functions
- ✅ **Enable/disable tasks** - Toggle tasks without removing them
- 📊 **Detailed logging** - See exactly when tasks run and their results

## Installation

Make sure you have [Bun](https://bun.sh) installed, then:

```bash
bun install
```

## Quick Start

1. Define your tasks in `config.json`:

```json
{
  "tasks": [
    {
      "name": "Daily Report",
      "schedule": "0 9 * * *",
      "module": "./tasks/example.ts",
      "function": "generateDailyReport",
      "enabled": true
    }
  ]
}
```

2. Create your task functions in a module:

```typescript
// tasks/example.ts
export async function generateDailyReport() {
  console.log("Generating report...");
  // Your task logic here
}
```

3. Run the scheduler:

```bash
bun start
```

## Configuration

### Task Configuration Schema

Each task in `config.json` has the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Unique name for the task |
| `schedule` | string | Yes | Cron expression (see below) |
| `module` | string | Yes | Path to the module containing the function |
| `function` | string | Yes | Name of the exported function to execute |
| `args` | array | No | Arguments to pass to the function |
| `enabled` | boolean | No | Whether the task is enabled (default: true) |

### Cron Expression Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday=0)
│ │ │ │ │
* * * * *
```

### Common Cron Examples

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 */6 * * *` | Every 6 hours |
| `0 9 * * *` | Every day at 9:00 AM |
| `0 0 * * 0` | Every Sunday at midnight |
| `0 0 1 * *` | First day of every month |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |

## Creating Task Functions

Task functions should be exported from a TypeScript/JavaScript module:

```typescript
// tasks/myTasks.ts

// Simple synchronous task
export function simpleTask() {
  console.log("Task executed!");
}

// Async task
export async function asyncTask() {
  await fetch("https://api.example.com/webhook");
  console.log("Webhook sent!");
}

// Task with arguments
export async function taskWithArgs(environment: string, retries: number) {
  console.log(`Running in ${environment} with ${retries} retries`);
  // Your logic here
}

// Task that returns a value
export async function taskWithReturn(): Promise<{ status: string }> {
  return { status: "completed" };
}
```

## Usage Examples

### Running with default config

```bash
bun start
```

### Running with custom config file

```bash
bun run src/scheduler.ts ./custom-config.json
```

### Development mode with hot reload

```bash
bun dev
```

## Project Structure

```
bun-task-scheduler/
├── src/
│   └── scheduler.ts      # Main scheduler logic
├── tasks/
│   └── example.ts        # Example task functions
├── config.json           # Task configuration
├── package.json          # Project dependencies
└── README.md            # This file
```

## Error Handling

The scheduler includes comprehensive error handling:

- Invalid cron expressions are detected and logged
- Failed task executions don't stop other tasks
- Module import errors are caught and logged
- Missing functions are detected before scheduling

## Advanced Usage

### Environment-specific Configurations

Create multiple config files:

```bash
bun run src/scheduler.ts ./config.production.json
bun run src/scheduler.ts ./config.development.json
```

### Database Tasks

```typescript
// tasks/database.ts
import { Database } from "bun:sqlite";

export async function cleanupOldRecords() {
  const db = new Database("mydb.sqlite");
  await db.run("DELETE FROM logs WHERE created_at < datetime('now', '-30 days')");
  db.close();
}
```

### API Integration

```typescript
// tasks/api.ts
export async function syncWithAPI() {
  const response = await fetch("https://api.example.com/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp: Date.now() }),
  });
  
  return await response.json();
}
```

### File System Operations

```typescript
// tasks/files.ts
export async function backupFiles() {
  const source = Bun.file("./data/important.json");
  const backup = Bun.file(`./backups/important-${Date.now()}.json`);
  await Bun.write(backup, source);
}
```

## Graceful Shutdown

The scheduler handles SIGINT and SIGTERM signals gracefully:

```bash
# Press Ctrl+C to stop
^C
⏹ Stopping all scheduled tasks...
  ✓ Stopped: Daily Report
  ✓ Stopped: Hourly Health Check
✓ Scheduler stopped
```

## Tips

1. **Test your cron expressions** at [crontab.guru](https://crontab.guru/)
2. **Use absolute paths** for modules if you encounter import issues
3. **Keep task functions idempotent** - they should be safe to run multiple times
4. **Log important actions** - the scheduler captures stdout from your tasks
5. **Handle errors gracefully** - use try/catch in your task functions

## License

MIT

## Contributing

Feel free to submit issues and enhancement requests!
