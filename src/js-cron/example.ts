/**
 * Example task functions that can be scheduled
 * Add your own task functions to this file or create new modules
 */

export async function generateDailyReport(): Promise<void> {
  console.log("  📊 Generating daily report...");
  
  // Simulate async work
  await Bun.sleep(1000);
  
  console.log("  ✓ Daily report generated successfully");
}

export async function healthCheck(): Promise<{ status: string; timestamp: string }> {
  console.log("  🏥 Performing health check...");
  
  // Simulate checking various services
  await Bun.sleep(500);
  
  const result = {
    status: "healthy",
    timestamp: new Date().toISOString()
  };
  
  console.log("  ✓ Health check completed");
  return result;
}

export async function syncData(environment: string, batchSize: number): Promise<void> {
  console.log(`  🔄 Syncing data for ${environment} environment (batch size: ${batchSize})`);
  
  // Simulate data synchronization
  await Bun.sleep(2000);
  
  console.log(`  ✓ Data sync completed for ${environment}`);
}

export async function weeklyCleanup(): Promise<void> {
  console.log("  🧹 Running weekly cleanup...");
  
  // Simulate cleanup operations
  await Bun.sleep(3000);
  
  console.log("  ✓ Weekly cleanup completed");
}

/**
 * Example of a task that makes an HTTP request
 */
export async function fetchAndProcess(): Promise<void> {
  console.log("  🌐 Fetching data from API...");
  
  try {
    const response = await fetch("https://api.example.com/data");
    const data = await response.json();
    
    console.log("  ✓ Data fetched successfully");
    // Process data here
  } catch (error) {
    console.error("  ✗ Failed to fetch data:", error);
    throw error;
  }
}

/**
 * Example of a task that writes to a file
 */
export async function logMetrics(): Promise<void> {
  console.log("  📝 Logging metrics...");
  
  const metrics = {
    timestamp: new Date().toISOString(),
    cpu: Math.random() * 100,
    memory: Math.random() * 100,
  };
  
  const logFile = Bun.file("./logs/metrics.jsonl");
  await Bun.write(logFile, JSON.stringify(metrics) + "\n");
  
  console.log("  ✓ Metrics logged");
}
