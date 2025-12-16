/**
 * Bun WebSocket Client
 * Run with: bun run ws-client.js
 */

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:3000/ws";
const RECONNECT_DELAY = 3000;

let ws = null;
let shouldReconnect = true;

/**
 * Message handlers for different message types
 */
const messageHandlers = {
  connected(data) {
    console.log("✓ Server:", data.message);
  },
  
  start(data) {
    console.log(`▶ START signal received at ${new Date(data.timestamp).toISOString()}`);
    onStart(data);
  },
  
  restart(data) {
    console.log(`↻ RESTART signal received at ${new Date(data.timestamp).toISOString()}`);
    onRestart(data);
  },
  
  pong(data) {
    console.log("← Pong received");
  },
  
  echo(data) {
    console.log("← Echo:", data.message);
  }
};

/**
 * Called when a "start" message is received
 * Customize this function for your use case
 */
function onStart(data) {
  // Add your start logic here
  console.log("  → Executing start handler...");
}

/**
 * Called when a "restart" message is received
 * Customize this function for your use case
 */
function onRestart(data) {
  // Add your restart logic here
  console.log("  → Executing restart handler...");
}

/**
 * Connect to the WebSocket server
 */
function connect() {
  console.log(`Connecting to ${SERVER_URL}...`);
  
  ws = new WebSocket(SERVER_URL);
  
  ws.addEventListener("open", () => {
    console.log("Connected to server\n");
  });
  
  ws.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      const handler = messageHandlers[data.type];
      
      if (handler) {
        handler(data);
      } else {
        console.log("Unknown message type:", data);
      }
    } catch {
      console.log("Raw message:", event.data);
    }
  });
  
  ws.addEventListener("close", () => {
    console.log("\nDisconnected from server");
    ws = null;
    
    if (shouldReconnect) {
      console.log(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
      setTimeout(connect, RECONNECT_DELAY);
    }
  });
  
  ws.addEventListener("error", (error) => {
    console.error("Connection error:", error.message || "Unknown error");
  });
}

/**
 * Send a message to the server
 */
function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  console.error("Not connected to server");
  return false;
}

/**
 * Send a ping to the server
 */
function ping() {
  console.log("→ Sending ping...");
  send({ type: "ping" });
}

/**
 * Gracefully disconnect from the server
 */
function disconnect() {
  shouldReconnect = false;
  if (ws) {
    ws.close();
  }
}

// Export helpers for programmatic use
export { connect, send, ping, disconnect, ws };

// Auto-connect when run directly
connect();

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  disconnect();
  process.exit(0);
});

// Optional: Send periodic pings to keep connection alive
// setInterval(ping, 30000);