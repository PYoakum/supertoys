import { readFileSync } from 'fs';
import { resolve } from 'path';

const PORT = 3000;

// Load the VM manifest
let manifest = {};
try {
  manifest = JSON.parse(readFileSync('./manifest.json', 'utf-8'));
} catch (error) {
  console.error('Failed to load manifest.json:', error.message);
}


export async function serveFile(filePath, request) {
  try {
    const file = Bun.file(filePath);
    const fileSize = file.size;

    // Get the Range header if present
    const rangeHeader = request.headers.get("range");

    // No range header - serve the entire file
    if (!rangeHeader) {
      return new Response(file, {
        status: 200,
        headers: {
          "content-type": file.type,
          "content-length": fileSize.toString(),
          "accept-ranges": "bytes",
        },
      });
    }

    // Parse the range header (e.g., "bytes=0-1023" or "bytes=1024-")
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!rangeMatch) {
      return new Response("Invalid range header", { status: 416 });
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

    // Validate range
    if (start > end || start < 0 || end >= fileSize) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${fileSize}`,
        },
      });
    }

    const length = end - start + 1;

    // Slice the file for the requested range
    const slicedFile = file.slice(start, end + 1);

    return new Response(slicedFile, {
      status: 206,
      headers: {
        "content-type": file.type,
        "content-length": length.toString(),
        "content-range": `bytes ${start}-${end}/${fileSize}`,
        "accept-ranges": "bytes",
      },
    });
  } catch (error) {
    return new Response("File not found", { status: 404 });
  }
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

    // API: Get manifest
    if (pathname === '/api/manifest') {
      return new Response(JSON.stringify(manifest), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // API: Get specific VM config
    if (pathname === '/api/vm') {
      const vmId = url.searchParams.get('id') || 'default';
      const vmConfig = manifest.vms?.[vmId];

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
      if (pathname === '/main.css') {

        filePath = './src/style/main.css';
        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file, { 'headers': { 'Content-Type': 'text/css' } });
      }

      // 📝 serve JS
      if (pathname === '/app.js') {

        filePath = './src/js/app.js';
        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file, { 'headers': { 'Content-Type': 'application/javascript' } });
      }

      if (pathname === '/v86.wasm') {
        filePath = './node_modules/v86/build/v86.wasm';

        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file);
      }

      if (pathname === '/libv86.js') {
        filePath = './node_modules/v86/build/libv86.js';

        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file);
      }

      if (pathname === './tiny-core.iso' || pathname === '/tiny-core.iso') {
        filePath = './src/iso/tiny-core.iso';


        return serveFile(filePath, req)
      }

      if (pathname === '/vgabios.bin' || pathname === '/vgabios.bin') {
        filePath = './src/bios/vgabios.bin';

        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file);
      }

      if (pathname === '/seabios.bin' || pathname === '/seabios.bin') {
        filePath = './src/bios/seabios.bin';

        const file = Bun.file(filePath);
        const exists = await file.exists();

        if (!exists) {
          return new Response('Not Found', { status: 404 });
        }

        return new Response(file);
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
console.log(`Available VMs: ${Object.keys(manifest.vms || {}).join(', ')}`);
