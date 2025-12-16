/**
 * Bun WebSocket Server
 * Run with: bun run ws-server.js
 */

const PORT = process.env.PORT || 3000;

// Store connected clients
const clients = new Set();

const server = Bun.serve({
  port: PORT,
  
  fetch(req, server) {
    const url = new URL(req.url);
    
    // Upgrade WebSocket connections
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return undefined;
    }
    
    // Simple HTTP endpoints to trigger messages
    if (url.pathname === "/send/start") {
      broadcastMessage({ type: "start", timestamp: Date.now() });
      return new Response("Sent 'start' message to all clients");
    }
    
    if (url.pathname === "/send/restart") {
      broadcastMessage({ type: "restart", timestamp: Date.now() });
      return new Response("Sent 'restart' message to all clients");
    }
    
    return new Response("Bun WebSocket Server\n\nEndpoints:\n- /ws (WebSocket)\n- /send/start\n- /send/restart");
  },
  
  websocket: {
    open(ws) {
      clients.add(ws);
      console.log(`Client connected. Total clients: ${clients.size}`);
      
      // Send a welcome message
      ws.send(JSON.stringify({ 
        type: "connected", 
        message: "Welcome to the WebSocket server",
        timestamp: Date.now()
      }));
    },
    
    message(ws, message) {
      console.log(`Received: ${message}`);
      
      // Echo back or handle client messages
      try {
        const data = JSON.parse(message);
        
        if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        }
      } catch {
        // Handle non-JSON messages
        ws.send(JSON.stringify({ type: "echo", message: String(message) }));
      }
    },
    
    close(ws) {
      clients.delete(ws);
      console.log(`Client disconnected. Total clients: ${clients.size}`);
    },
    
    error(ws, error) {
      console.error("WebSocket error:", error);
      clients.delete(ws);
    }
  }
});

/**
 * Broadcast a message to all connected clients
 */
function broadcastMessage(data) {
  const message = JSON.stringify(data);
  let sent = 0;
  
  for (const client of clients) {
    try {
      client.send(message);
      sent++;
    } catch (err) {
      console.error("Failed to send to client:", err);
      clients.delete(client);
    }
  }
  
  console.log(`Broadcast '${data.type}' to ${sent} client(s)`);
}

/**
 * Helper functions to send specific message types
 */
function sendStart() {
  broadcastMessage({ type: "start", timestamp: Date.now() });
}

function sendRestart() {
  broadcastMessage({ type: "restart", timestamp: Date.now() });
}

// Export helpers for programmatic use
export { sendStart, sendRestart, broadcastMessage, clients };

console.log(`WebSocket server running on http://localhost:${PORT}`);
console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
console.log(`\nTrigger messages via HTTP:`);
console.log(`  curl http://localhost:${PORT}/send/start`);
console.log(`  curl http://localhost:${PORT}/send/restart`);