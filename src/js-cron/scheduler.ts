import { CronJob } from "cron";
import parser from "cron-parser";

interface TaskConfig {
  name: string;
  schedule: string;
  module: string;
  function: string;
  args?: any[];
  enabled?: boolean;
}

interface Config {
  tasks: TaskConfig[];
}

class TaskScheduler {
  private jobs: Map<string, CronJob> = new Map();
  private config: Config;

  constructor(configPath: string) {
    this.config = this.loadConfig(configPath);
  }

  private loadConfig(path: string): Config {
    try {
      const file = Bun.file(path);
      const config = file.json() as Config;
      console.log(`✓ Loaded configuration from ${path}`);
      return config;
    } catch (error) {
      console.error(`✗ Failed to load configuration from ${path}:`, error);
      throw error;
    }
  }

  private validateCronExpression(expression: string): boolean {
    try {
      parser.parseExpression(expression);
      return true;
    } catch (error) {
      return false;
    }
  }

  async start(): Promise<void> {
    console.log("\n🚀 Starting Task Scheduler...\n");

    for (const task of this.config.tasks) {
      if (task.enabled === false) {
        console.log(`⊘ Skipping disabled task: ${task.name}`);
        continue;
      }

      if (!this.validateCronExpression(task.schedule)) {
        console.error(`✗ Invalid cron expression for task "${task.name}": ${task.schedule}`);
        continue;
      }

      try {
        // Dynamically import the module
        const module = await import(task.module);
        const fn = module[task.function];

        if (typeof fn !== "function") {
          console.error(`✗ Function "${task.function}" not found in module "${task.module}"`);
          continue;
        }

        // Create cron job
        const job = new CronJob(
          task.schedule,
          async () => {
            const timestamp = new Date().toISOString();
            console.log(`\n[${timestamp}] ▶ Running task: ${task.name}`);
            
            try {
              const args = task.args || [];
              const result = await fn(...args);
              console.log(`[${timestamp}] ✓ Task completed: ${task.name}`);
              if (result !== undefined) {
                console.log(`  Result:`, result);
              }
            } catch (error) {
              console.error(`[${timestamp}] ✗ Task failed: ${task.name}`);
              console.error(`  Error:`, error);
            }
          },
          null,
          true,
          "UTC"
        );

        this.jobs.set(task.name, job);
        
        const interval = parser.parseExpression(task.schedule);
        const nextRun = interval.next().toDate();
        console.log(`✓ Scheduled task: ${task.name}`);
        console.log(`  Schedule: ${task.schedule}`);
        console.log(`  Next run: ${nextRun.toISOString()}`);
        console.log(`  Function: ${task.function} from ${task.module}`);
        
      } catch (error) {
        console.error(`✗ Failed to schedule task "${task.name}":`, error);
      }
    }

    console.log(`\n✓ Scheduler initialized with ${this.jobs.size} active task(s)\n`);
    console.log("Press Ctrl+C to stop the scheduler\n");
  }

  stop(): void {
    console.log("\n⏹ Stopping all scheduled tasks...");
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`  ✓ Stopped: ${name}`);
    }
    this.jobs.clear();
    console.log("✓ Scheduler stopped\n");
  }
}

// Main execution
const configPath = process.argv[2] || "./config.json";

const scheduler = new TaskScheduler(configPath);

// Start the scheduler
await scheduler.start();

// Handle graceful shutdown
process.on("SIGINT", () => {
  scheduler.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  scheduler.stop();
  process.exit(0);
});
