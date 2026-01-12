import { readFileSync } from 'fs';
import { resolve } from 'path';

const PORT = 3000;

// Load the terminal config
let config = {};
try {
  config = JSON.parse(readFileSync('./config.json', 'utf-8'));
} catch (error) {
  console.error('Failed to load config.json:', error.message);
}


// WebSocket connections for VM networking
const vmConnections = new Map();

const server = Bun.serve({
  port: PORT,
  
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Upgrade WebSocket connections for VM networking
    if (pathname === '/ws') {
      const vmId = url.searchParams.get('vm') || 'default';
      
      if (server.upgrade(req, { data: { vmId } })) {
        return; // WebSocket upgrade successful
      }
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // API: Get config
    if (pathname === '/config') {
      return new Response(JSON.stringify(config), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Get specific VM config
    if (pathname === '/api/vm') {
      const vmId = url.searchParams.get('id') || 'default';
      const vmConfig = config.vms?.[vmId];
      
      if (!vmConfig) {
        return new Response(JSON.stringify({ error: 'VM not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify(vmConfig), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Serve static files
    try {
      let filePath;
      
      // 📝 serve index
      if (pathname === '/' || pathname === '/index.html') {

        filePath = './index.html';
        const file = Bun.file(filePath);
        const exists = await file.exists();
        
        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file);
      }

      // 📝 serve CSS
      if (pathname === '/main.css' ) {
        
        filePath = './src/style/main.css';
        const file = Bun.file(filePath);
        const exists = await file.exists();
        
        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file, { 'headers' : { 'Content-Type' : 'text/css'}});
      }

      // 📝 serve JS
      if (pathname === '/app.js' ) {
        
        filePath = './src/js/app.js';
        const file = Bun.file(filePath);
        const exists = await file.exists();
        
        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file, { 'headers' : { 'Content-Type' : 'application/javascript'}});
      }

    } catch (error) {

      return new Response('Internal Server Error', { status: 500 });

    }
  },

  websocket: {
    open(ws) {
      const vmId = ws.data.vmId;
      console.log(`WebSocket connected for VM: ${vmId}`);
      
      if (!vmConnections.has(vmId)) {
        vmConnections.set(vmId, new Set());
      }
      vmConnections.get(vmId).add(ws);
    },

    message(ws, message) {
      const vmId = ws.data.vmId;
      
      // Broadcast to all connections for this VM (simulating network)
      const connections = vmConnections.get(vmId);
      if (connections) {
        connections.forEach(client => {
          if (client !== ws && client.readyState === 1) {
            client.send(message);
          }
        });
      }
    },

    close(ws) {
      const vmId = ws.data.vmId;
      console.log(`WebSocket disconnected for VM: ${vmId}`);
      
      const connections = vmConnections.get(vmId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          vmConnections.delete(vmId);
        }
      }
    }
  }
});

console.log(`Server running at http://localhost:${PORT}`);
