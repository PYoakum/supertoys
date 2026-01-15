/**
 * @fileoverview TCP Connect Tool for low-level TCP connections
 * @module tcp-connect-tool
 */

import { Socket } from 'net';

/**
 * TCP Connect Tool for establishing TCP connections to allowed hosts/ports
 */
export class TcpConnectTool {
  /**
   * @param {Object} [config]
   * @param {string[]} [config.allowedHosts=[]] - Allowlist of hosts (supports *.domain.com wildcards)
   * @param {number[]} [config.allowedPorts=[]] - Allowlist of ports
   * @param {number} [config.defaultTimeout=10000] - Default connection timeout in ms
   * @param {number} [config.defaultReadTimeout=5000] - Default read timeout in ms
   * @param {number} [config.maxResponseSize=65536] - Maximum response size in bytes
   */
  constructor(config = {}) {
    /** @type {string[]} */
    this.allowedHosts = config.allowedHosts || [];

    /** @type {number[]} */
    this.allowedPorts = config.allowedPorts || [];

    /** @type {number} */
    this.defaultTimeout = config.defaultTimeout || 10000;

    /** @type {number} */
    this.defaultReadTimeout = config.defaultReadTimeout || 5000;

    /** @type {number} */
    this.maxResponseSize = config.maxResponseSize || 65536;
  }

  /**
   * Execute TCP operation
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const {
      host,
      port,
      action = 'connect',
      data,
      encoding = 'utf8',
      timeout,
      readTimeout,
      maxResponseSize
    } = args;

    if (!host) {
      return this.formatError('host is required');
    }
    if (!port) {
      return this.formatError('port is required');
    }
    if (port < 1 || port > 65535) {
      return this.formatError('port must be between 1 and 65535');
    }

    // Check allowlists
    if (!this.isHostAllowed(host)) {
      return this.formatError(`Host not allowed: ${host}. Configure allowedHosts to enable access.`);
    }
    if (!this.isPortAllowed(port)) {
      return this.formatError(`Port not allowed: ${port}. Configure allowedPorts to enable access.`);
    }

    const connectTimeout = timeout || this.defaultTimeout;
    const dataReadTimeout = readTimeout || this.defaultReadTimeout;
    const maxSize = maxResponseSize || this.maxResponseSize;

    switch (action) {
      case 'probe':
        return this.probe(host, port, connectTimeout);
      case 'connect':
        return this.connect(host, port, connectTimeout);
      case 'send':
        if (!data) {
          return this.formatError('data is required for send action');
        }
        return this.send(host, port, data, encoding, connectTimeout, dataReadTimeout, maxSize);
      default:
        return this.formatError(`Invalid action: ${action}. Use 'probe', 'connect', or 'send'.`);
    }
  }

  /**
   * Quick port probe - just check if port is open
   * @param {string} host
   * @param {number} port
   * @param {number} timeout
   * @returns {Promise<Object>}
   */
  probe(host, port, timeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new Socket();

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(this.formatResponse({
          open: false,
          host,
          port,
          timing: { probeMs: Date.now() - startTime },
          reason: 'timeout'
        }));
      }, timeout);

      socket.once('connect', () => {
        clearTimeout(timeoutId);
        const probeMs = Date.now() - startTime;
        cleanup();
        resolve(this.formatResponse({
          open: true,
          host,
          port,
          timing: { probeMs }
        }));
      });

      socket.once('error', (err) => {
        clearTimeout(timeoutId);
        const probeMs = Date.now() - startTime;
        cleanup();
        resolve(this.formatResponse({
          open: false,
          host,
          port,
          timing: { probeMs },
          reason: err.code || err.message
        }));
      });

      socket.connect(port, host);
    });
  }

  /**
   * Test TCP connection - connect and get local address info
   * @param {string} host
   * @param {number} port
   * @param {number} timeout
   * @returns {Promise<Object>}
   */
  connect(host, port, timeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new Socket();

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(this.formatError(`Connection timeout after ${timeout}ms`));
      }, timeout);

      socket.once('connect', () => {
        clearTimeout(timeoutId);
        const connectMs = Date.now() - startTime;
        const localAddress = socket.localAddress;
        const localPort = socket.localPort;
        const remoteAddress = socket.remoteAddress;
        cleanup();
        resolve(this.formatResponse({
          connected: true,
          host,
          port,
          localAddress,
          localPort,
          remoteAddress,
          timing: { connectMs }
        }));
      });

      socket.once('error', (err) => {
        clearTimeout(timeoutId);
        cleanup();
        resolve(this.formatError(`Connection failed: ${err.code || err.message}`));
      });

      socket.connect(port, host);
    });
  }

  /**
   * Send data and receive response
   * @param {string} host
   * @param {number} port
   * @param {string} data
   * @param {string} encoding
   * @param {number} connectTimeout
   * @param {number} readTimeout
   * @param {number} maxSize
   * @returns {Promise<Object>}
   */
  send(host, port, data, encoding, connectTimeout, readTimeout, maxSize) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const socket = new Socket();
      const chunks = [];
      let totalSize = 0;
      let connected = false;
      let dataSent = false;

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      // Connection timeout
      const connectTimeoutId = setTimeout(() => {
        if (!connected) {
          cleanup();
          resolve(this.formatError(`Connection timeout after ${connectTimeout}ms`));
        }
      }, connectTimeout);

      // Read timeout (starts after data is sent)
      let readTimeoutId = null;
      const startReadTimeout = () => {
        readTimeoutId = setTimeout(() => {
          const response = this.assembleResponse(chunks, encoding);
          cleanup();
          resolve(this.formatResponse({
            sent: Buffer.byteLength(data, encoding === 'hex' ? 'hex' : encoding === 'base64' ? 'base64' : 'utf8'),
            received: totalSize,
            response,
            encoding,
            timing: {
              connectMs: connected ? Date.now() - startTime : null,
              totalMs: Date.now() - startTime
            },
            note: 'Read timeout reached'
          }));
        }, readTimeout);
      };

      socket.once('connect', () => {
        clearTimeout(connectTimeoutId);
        connected = true;

        // Encode and send data
        let sendBuffer;
        try {
          if (encoding === 'hex') {
            sendBuffer = Buffer.from(data, 'hex');
          } else if (encoding === 'base64') {
            sendBuffer = Buffer.from(data, 'base64');
          } else {
            sendBuffer = Buffer.from(data, 'utf8');
          }
        } catch (err) {
          cleanup();
          resolve(this.formatError(`Invalid data encoding: ${err.message}`));
          return;
        }

        socket.write(sendBuffer, () => {
          dataSent = true;
          startReadTimeout();
        });
      });

      socket.on('data', (chunk) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          if (readTimeoutId) clearTimeout(readTimeoutId);
          const response = this.assembleResponse(chunks, encoding);
          cleanup();
          resolve(this.formatResponse({
            sent: Buffer.byteLength(data, encoding === 'hex' ? 'hex' : encoding === 'base64' ? 'base64' : 'utf8'),
            received: totalSize,
            response,
            encoding,
            truncated: true,
            timing: { totalMs: Date.now() - startTime }
          }));
          return;
        }
        chunks.push(chunk);
      });

      socket.once('end', () => {
        if (readTimeoutId) clearTimeout(readTimeoutId);
        const response = this.assembleResponse(chunks, encoding);
        cleanup();
        resolve(this.formatResponse({
          sent: Buffer.byteLength(data, encoding === 'hex' ? 'hex' : encoding === 'base64' ? 'base64' : 'utf8'),
          received: totalSize,
          response,
          encoding,
          timing: { totalMs: Date.now() - startTime }
        }));
      });

      socket.once('close', () => {
        if (readTimeoutId) clearTimeout(readTimeoutId);
        if (dataSent && chunks.length > 0) {
          const response = this.assembleResponse(chunks, encoding);
          cleanup();
          resolve(this.formatResponse({
            sent: Buffer.byteLength(data, encoding === 'hex' ? 'hex' : encoding === 'base64' ? 'base64' : 'utf8'),
            received: totalSize,
            response,
            encoding,
            timing: { totalMs: Date.now() - startTime }
          }));
        }
      });

      socket.once('error', (err) => {
        clearTimeout(connectTimeoutId);
        if (readTimeoutId) clearTimeout(readTimeoutId);
        cleanup();
        if (connected && chunks.length > 0) {
          // Return partial data if we got some
          const response = this.assembleResponse(chunks, encoding);
          resolve(this.formatResponse({
            sent: Buffer.byteLength(data, encoding === 'hex' ? 'hex' : encoding === 'base64' ? 'base64' : 'utf8'),
            received: totalSize,
            response,
            encoding,
            error: err.code || err.message,
            timing: { totalMs: Date.now() - startTime }
          }));
        } else {
          resolve(this.formatError(`Connection error: ${err.code || err.message}`));
        }
      });

      socket.connect(port, host);
    });
  }

  /**
   * Assemble response chunks into string
   * @param {Buffer[]} chunks
   * @param {string} encoding
   * @returns {string}
   */
  assembleResponse(chunks, encoding) {
    const buffer = Buffer.concat(chunks);
    if (encoding === 'hex') {
      return buffer.toString('hex');
    } else if (encoding === 'base64') {
      return buffer.toString('base64');
    }
    return buffer.toString('utf8');
  }

  /**
   * Check if host is in allowlist
   * @param {string} hostname
   * @returns {boolean}
   */
  isHostAllowed(hostname) {
    if (this.allowedHosts.length === 0) {
      return false; // Default deny
    }
    if (this.allowedHosts.includes('*')) {
      return true;
    }
    return this.allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        // Wildcard subdomain matching
        const domain = allowed.slice(2);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === allowed;
    });
  }

  /**
   * Check if port is in allowlist
   * @param {number} port
   * @returns {boolean}
   */
  isPortAllowed(port) {
    if (this.allowedPorts.length === 0) {
      return false; // Default deny
    }
    if (this.allowedPorts.includes(0)) {
      return true; // 0 means all ports
    }
    return this.allowedPorts.includes(port);
  }

  /**
   * Format success response in MCP-compatible format
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * Format error response in MCP-compatible format
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }, null, 2)
        }
      ],
      isError: true
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'tcp_connect',
      this.execute.bind(this),
      {
        name: 'tcp_connect',
        description: 'Establish TCP connections to allowed hosts/ports. Supports probing (port check), connecting (test connection), and sending data.',
        inputSchema: {
          type: 'object',
          properties: {
            host: {
              type: 'string',
              description: 'Target hostname or IP address'
            },
            port: {
              type: 'integer',
              minimum: 1,
              maximum: 65535,
              description: 'Target port number'
            },
            action: {
              type: 'string',
              enum: ['probe', 'connect', 'send'],
              default: 'connect',
              description: 'Action to perform: probe (quick port check), connect (test connection), send (send data and receive response)'
            },
            data: {
              type: 'string',
              description: 'Data to send (required for send action)'
            },
            encoding: {
              type: 'string',
              enum: ['utf8', 'hex', 'base64'],
              default: 'utf8',
              description: 'Encoding for data and response'
            },
            timeout: {
              type: 'integer',
              minimum: 100,
              maximum: 60000,
              default: 10000,
              description: 'Connection timeout in milliseconds'
            },
            readTimeout: {
              type: 'integer',
              minimum: 100,
              maximum: 60000,
              default: 5000,
              description: 'Read timeout in milliseconds (for send action)'
            },
            maxResponseSize: {
              type: 'integer',
              minimum: 1,
              maximum: 1048576,
              default: 65536,
              description: 'Maximum response size in bytes'
            }
          },
          required: ['host', 'port']
        }
      }
    );
  }
}

/**
 * Create a TcpConnectTool instance
 * @param {Object} [config]
 * @returns {TcpConnectTool}
 */
export function createTcpConnectTool(config) {
  return new TcpConnectTool(config);
}

export default TcpConnectTool;
