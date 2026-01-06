/**
 * Advanced task examples showing real-world use cases
 */

/**
 * Example: Send email notifications
 */
export async function sendDailySummary(recipientEmail: string) {
  console.log(`  📧 Sending daily summary to ${recipientEmail}`);
  
  // In a real app, you would use an email service like Resend, SendGrid, etc.
  // Example with fetch:
  // await fetch("https://api.resend.com/emails", {
  //   method: "POST",
  //   headers: {
  //     "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     from: "noreply@example.com",
  //     to: recipientEmail,
  //     subject: "Daily Summary",
  //     html: "<h1>Your daily summary</h1>",
  //   }),
  // });
  
  console.log("  ✓ Email sent successfully");
}

/**
 * Example: Database backup
 */
export async function backupDatabase() {
  console.log("  💾 Creating database backup...");
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./backups/db-backup-${timestamp}.sqlite`;
  
  // Example with Bun's SQLite
  // const db = new Database("./data/app.db");
  // const backup = new Database(backupPath);
  // await db.backup(backup);
  // db.close();
  // backup.close();
  
  console.log(`  ✓ Backup created: ${backupPath}`);
}

/**
 * Example: Clean up temporary files
 */
export async function cleanTempFiles(olderThanDays: number = 7) {
  console.log(`  🗑️  Cleaning files older than ${olderThanDays} days...`);
  
  const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
  let deletedCount = 0;
  
  // Example file cleanup logic
  // const glob = new Bun.Glob("./temp/**/*");
  // for await (const file of glob.scan()) {
  //   const stat = await Bun.file(file).stat();
  //   if (stat.mtime < cutoffTime) {
  //     await Bun.unlink(file);
  //     deletedCount++;
  //   }
  // }
  
  console.log(`  ✓ Deleted ${deletedCount} temporary files`);
}

/**
 * Example: Webhook notification
 */
export async function sendWebhook(webhookUrl: string, event: string) {
  console.log(`  🔔 Sending webhook for event: ${event}`);
  
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        source: "bun-task-scheduler",
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
    
    console.log("  ✓ Webhook delivered successfully");
  } catch (error) {
    console.error("  ✗ Webhook failed:", error);
    throw error;
  }
}

/**
 * Example: Data aggregation
 */
export async function aggregateDailyStats() {
  console.log("  📊 Aggregating daily statistics...");
  
  // Simulate data aggregation
  const stats = {
    date: new Date().toISOString().split('T')[0],
    totalUsers: Math.floor(Math.random() * 1000),
    activeUsers: Math.floor(Math.random() * 500),
    revenue: Math.floor(Math.random() * 10000),
  };
  
  // Write to file
  const statsFile = Bun.file("./data/daily-stats.jsonl");
  await Bun.write(statsFile, JSON.stringify(stats) + "\n");
  
  console.log("  ✓ Stats aggregated:", stats);
  return stats;
}

/**
 * Example: Cache warming
 */
export async function warmCache(endpoints: string[]) {
  console.log(`  🔥 Warming cache for ${endpoints.length} endpoints...`);
  
  const results = await Promise.allSettled(
    endpoints.map(url => 
      fetch(url, { method: "HEAD" })
        .then(() => ({ url, status: "success" }))
        .catch(error => ({ url, status: "failed", error: error.message }))
    )
  );
  
  const successful = results.filter(r => r.status === "fulfilled").length;
  console.log(`  ✓ Cache warmed: ${successful}/${endpoints.length} successful`);
}

/**
 * Example: System health monitoring
 */
export async function monitorSystemHealth() {
  console.log("  🏥 Monitoring system health...");
  
  const health = {
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    // Add more metrics as needed
  };
  
  // Check thresholds and alert if needed
  const memoryUsagePercent = (health.memory.heapUsed / health.memory.heapTotal) * 100;
  
  if (memoryUsagePercent > 90) {
    console.warn(`  ⚠️  High memory usage: ${memoryUsagePercent.toFixed(2)}%`);
    // Send alert
  }
  
  console.log("  ✓ Health check completed");
  return health;
}

/**
 * Example: API sync task
 */
export async function syncWithExternalAPI(apiUrl: string, apiKey: string) {
  console.log(`  🔄 Syncing with external API: ${apiUrl}`);
  
  try {
    const response = await fetch(apiUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Process and store the data
    await Bun.write(
      Bun.file("./data/external-sync.json"),
      JSON.stringify(data, null, 2)
    );
    
    console.log(`  ✓ Synced ${data.length || 0} records`);
  } catch (error) {
    console.error("  ✗ Sync failed:", error);
    throw error;
  }
}
