/**
 * @fileoverview Network Tools for ping, traceroute, mtr, and packet capture
 * @module net-tools-tool
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  timeout: 30000,         // 30 seconds
  outputSize: 1024 * 1024, // 1MB
  maxPackets: 100,
  maxHops: 64
};

/**
 * Maximum allowed limits
 */
const MAX_LIMITS = {
  timeout: 300000,        // 5 minutes
  outputSize: 10 * 1024 * 1024, // 10MB
  maxPackets: 1000,
  maxHops: 128,
  capturePackets: 10000,
  captureBytes: 65535
};

/**
 * Network Tools
 */
export class NetToolsTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} [sandboxManager]
   * @param {Object} [config]
   */
  constructor(sandboxManager = null, config = {}) {
    /** @type {import('./sandbox-manager.js').SandboxManager|null} */
    this.sandboxManager = sandboxManager;

    /** @type {string[]} */
    this.allowedHosts = config.allowedHosts || [];

    /** @type {boolean} */
    this.allowAllHosts = config.allowAllHosts === true;

    /** @type {boolean} */
    this.captureEnabled = config.captureEnabled === true;

    /** @type {string[]} */
    this.allowedInterfaces = config.allowedInterfaces || ['any', 'lo', 'eth0', 'en0'];

    /** @type {Object} */
    this.toolPaths = {
      ping: config.pingPath || 'ping',
      traceroute: config.traceroutePath || 'traceroute',
      mtr: config.mtrPath || 'mtr',
      tcpdump: config.tcpdumpPath || 'tcpdump'
    };
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const { action, sessionId } = args;

    if (!action) {
      return this.formatError('action is required (ping, traceroute, mtr, capture)');
    }

    switch (action) {
      case 'ping':
        return this.executePing(args);
      case 'traceroute':
        return this.executeTraceroute(args);
      case 'mtr':
        return this.executeMtr(args);
      case 'capture':
        return this.executeCapture(args);
      default:
        return this.formatError(`Unknown action: ${action}. Supported: ping, traceroute, mtr, capture`);
    }
  }

  /**
   * Check if host is allowed
   * @param {string} host
   * @returns {boolean}
   */
  isHostAllowed(host) {
    if (this.allowAllHosts) return true;
    if (this.allowedHosts.length === 0) return false;
    if (this.allowedHosts.includes('*')) return true;

    return this.allowedHosts.some(allowed => {
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2);
        return host === domain || host.endsWith('.' + domain);
      }
      return host === allowed;
    });
  }

  /**
   * Execute ping
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async executePing(args) {
    const {
      host,
      count = 4,
      interval = 1,
      timeout = DEFAULT_LIMITS.timeout,
      packetSize = 56,
      ttl
    } = args;

    if (!host) {
      return this.formatError('host is required for ping');
    }

    if (!this.isHostAllowed(host)) {
      return this.formatError(`Host not allowed: ${host}`);
    }

    // Build ping arguments
    const pingArgs = [
      '-c', Math.min(count, DEFAULT_LIMITS.maxPackets).toString(),
      '-i', Math.max(0.2, interval).toString(),
      '-s', Math.min(packetSize, 65507).toString()
    ];

    if (ttl) {
      pingArgs.push('-t', Math.min(ttl, MAX_LIMITS.maxHops).toString());
    }

    pingArgs.push(host);

    const result = await this.runCommand(this.toolPaths.ping, pingArgs, timeout);

    // Parse ping output
    const parsed = this.parsePingOutput(result.stdout);

    return this.formatResponse({
      action: 'ping',
      host,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      statistics: parsed,
      rawOutput: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut
    });
  }

  /**
   * Parse ping output for statistics
   * @param {string} output
   * @returns {Object}
   */
  parsePingOutput(output) {
    const stats = {
      packetsTransmitted: 0,
      packetsReceived: 0,
      packetLoss: 100,
      rttMin: null,
      rttAvg: null,
      rttMax: null,
      rttMdev: null
    };

    // Parse packet statistics
    const packetMatch = output.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received,\s+([\d.]+)%\s+packet loss/i);
    if (packetMatch) {
      stats.packetsTransmitted = parseInt(packetMatch[1], 10);
      stats.packetsReceived = parseInt(packetMatch[2], 10);
      stats.packetLoss = parseFloat(packetMatch[3]);
    }

    // Parse RTT statistics
    const rttMatch = output.match(/rtt\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/i);
    if (rttMatch) {
      stats.rttMin = parseFloat(rttMatch[1]);
      stats.rttAvg = parseFloat(rttMatch[2]);
      stats.rttMax = parseFloat(rttMatch[3]);
      stats.rttMdev = parseFloat(rttMatch[4]);
    }

    return stats;
  }

  /**
   * Execute traceroute
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async executeTraceroute(args) {
    const {
      host,
      maxHops = 30,
      timeout = DEFAULT_LIMITS.timeout,
      queries = 3,
      waitTime = 5,
      useIcmp = false
    } = args;

    if (!host) {
      return this.formatError('host is required for traceroute');
    }

    if (!this.isHostAllowed(host)) {
      return this.formatError(`Host not allowed: ${host}`);
    }

    // Build traceroute arguments
    const trArgs = [
      '-m', Math.min(maxHops, MAX_LIMITS.maxHops).toString(),
      '-q', Math.min(queries, 10).toString(),
      '-w', Math.min(waitTime, 10).toString()
    ];

    if (useIcmp) {
      trArgs.push('-I');
    }

    trArgs.push(host);

    const result = await this.runCommand(this.toolPaths.traceroute, trArgs, timeout);

    // Parse traceroute output
    const hops = this.parseTracerouteOutput(result.stdout);

    return this.formatResponse({
      action: 'traceroute',
      host,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      hops,
      hopCount: hops.length,
      rawOutput: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut
    });
  }

  /**
   * Parse traceroute output
   * @param {string} output
   * @returns {Object[]}
   */
  parseTracerouteOutput(output) {
    const hops = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Match hop lines like: " 1  192.168.1.1 (192.168.1.1)  1.234 ms  1.456 ms  1.678 ms"
      const hopMatch = line.match(/^\s*(\d+)\s+(.+)/);
      if (hopMatch) {
        const hopNum = parseInt(hopMatch[1], 10);
        const rest = hopMatch[2];

        // Check for timeout (*)
        if (rest.trim() === '* * *') {
          hops.push({ hop: hopNum, host: null, ip: null, times: [], timeout: true });
          continue;
        }

        // Parse host/IP and times
        const parts = rest.split(/\s+/);
        let host = null;
        let ip = null;
        const times = [];

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (part.startsWith('(') && part.endsWith(')')) {
            ip = part.slice(1, -1);
          } else if (part === 'ms') {
            // Previous part was a time
            const time = parseFloat(parts[i - 1]);
            if (!isNaN(time)) times.push(time);
          } else if (!host && !part.match(/^[\d.]+$/) && part !== '*') {
            host = part;
          } else if (!ip && part.match(/^\d+\.\d+\.\d+\.\d+$/)) {
            ip = part;
          }
        }

        hops.push({ hop: hopNum, host: host || ip, ip, times, timeout: false });
      }
    }

    return hops;
  }

  /**
   * Execute mtr (My TraceRoute)
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async executeMtr(args) {
    const {
      host,
      count = 10,
      timeout = DEFAULT_LIMITS.timeout,
      reportWide = true,
      useIcmp = false,
      noDns = false
    } = args;

    if (!host) {
      return this.formatError('host is required for mtr');
    }

    if (!this.isHostAllowed(host)) {
      return this.formatError(`Host not allowed: ${host}`);
    }

    // Build mtr arguments (report mode for non-interactive output)
    const mtrArgs = [
      '--report',
      '-c', Math.min(count, DEFAULT_LIMITS.maxPackets).toString()
    ];

    if (reportWide) {
      mtrArgs.push('--report-wide');
    }

    if (useIcmp) {
      mtrArgs.push('--icmp');
    }

    if (noDns) {
      mtrArgs.push('--no-dns');
    }

    mtrArgs.push(host);

    const result = await this.runCommand(this.toolPaths.mtr, mtrArgs, timeout);

    // Parse mtr output
    const hops = this.parseMtrOutput(result.stdout);

    return this.formatResponse({
      action: 'mtr',
      host,
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      hops,
      hopCount: hops.length,
      rawOutput: result.stdout,
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut
    });
  }

  /**
   * Parse mtr report output
   * @param {string} output
   * @returns {Object[]}
   */
  parseMtrOutput(output) {
    const hops = [];
    const lines = output.split('\n');

    for (const line of lines) {
      // Match mtr report lines like: " 1.|-- 192.168.1.1    0.0%     10    1.2   1.3   1.1   1.5   0.1"
      const hopMatch = line.match(/^\s*(\d+)\.\|[-─]+\s+(\S+)\s+([\d.]+)%\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (hopMatch) {
        hops.push({
          hop: parseInt(hopMatch[1], 10),
          host: hopMatch[2] === '???' ? null : hopMatch[2],
          loss: parseFloat(hopMatch[3]),
          sent: parseInt(hopMatch[4], 10),
          last: parseFloat(hopMatch[5]),
          avg: parseFloat(hopMatch[6]),
          best: parseFloat(hopMatch[7]),
          worst: parseFloat(hopMatch[8]),
          stdev: parseFloat(hopMatch[9])
        });
      }
    }

    return hops;
  }

  /**
   * Execute packet capture (tcpdump)
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async executeCapture(args) {
    if (!this.captureEnabled) {
      return this.formatError('Packet capture is not enabled on this server');
    }

    const {
      sessionId,
      interface: iface = 'any',
      filter = '',
      count = 100,
      timeout = DEFAULT_LIMITS.timeout,
      snaplen = 96,
      saveToFile = false
    } = args;

    // Validate interface
    if (!this.allowedInterfaces.includes(iface) && !this.allowedInterfaces.includes('*')) {
      return this.formatError(`Interface not allowed: ${iface}. Allowed: ${this.allowedInterfaces.join(', ')}`);
    }

    // Build tcpdump arguments
    const tcpArgs = [
      '-i', iface,
      '-c', Math.min(count, MAX_LIMITS.capturePackets).toString(),
      '-s', Math.min(snaplen, MAX_LIMITS.captureBytes).toString(),
      '-n', // Don't resolve hostnames
      '-tttt' // Human-readable timestamps
    ];

    // Handle file output
    let outputFile = null;
    if (saveToFile && sessionId && this.sandboxManager) {
      const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
      outputFile = join(sandboxPath, `capture-${randomUUID()}.pcap`);
      tcpArgs.push('-w', outputFile);
    }

    // Add filter if provided
    if (filter) {
      tcpArgs.push(filter);
    }

    const result = await this.runCommand(this.toolPaths.tcpdump, tcpArgs, timeout);

    // Parse capture output (if not writing to file)
    let packets = [];
    if (!saveToFile) {
      packets = this.parseTcpdumpOutput(result.stdout);
    }

    return this.formatResponse({
      action: 'capture',
      interface: iface,
      filter: filter || '(none)',
      success: result.exitCode === 0 || result.exitCode === null,
      exitCode: result.exitCode,
      packetsCount: packets.length || count,
      packets: saveToFile ? [] : packets,
      outputFile: outputFile || null,
      rawOutput: saveToFile ? '(output written to file)' : result.stdout.slice(0, 10000),
      stderr: result.stderr,
      duration: result.duration,
      timedOut: result.timedOut
    });
  }

  /**
   * Parse tcpdump output
   * @param {string} output
   * @returns {Object[]}
   */
  parseTcpdumpOutput(output) {
    const packets = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // Basic parsing - extract timestamp, src, dst, protocol info
      const match = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(.+)$/);
      if (match) {
        packets.push({
          timestamp: match[1],
          summary: match[2].slice(0, 200)
        });
      }
    }

    return packets.slice(0, 1000); // Limit parsed packets
  }

  /**
   * Run a network command
   * @param {string} command
   * @param {string[]} args
   * @param {number} timeout
   * @returns {Promise<Object>}
   */
  async runCommand(command, args, timeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, Math.min(timeout, MAX_LIMITS.timeout));

      proc.stdout.on('data', (data) => {
        if (stdout.length < MAX_LIMITS.outputSize) {
          stdout += data.toString();
        }
      });

      proc.stderr.on('data', (data) => {
        if (stderr.length < MAX_LIMITS.outputSize) {
          stderr += data.toString();
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: code,
          stdout: stdout.slice(0, MAX_LIMITS.outputSize),
          stderr: stderr.slice(0, MAX_LIMITS.outputSize),
          duration: Date.now() - startTime,
          timedOut
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          duration: Date.now() - startTime,
          timedOut: false
        });
      });
    });
  }

  /**
   * Format success response
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
   * Format error response
   * @param {string} message
   * @returns {Object}
   */
  formatError(message) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message })
        }
      ],
      isError: true
    };
  }

  /**
   * Register tools with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'net_tools',
      this.execute.bind(this),
      {
        name: 'net_tools',
        description: 'Network diagnostic tools including ping, traceroute, mtr (My TraceRoute), and packet capture. Use for network troubleshooting and connectivity testing.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['ping', 'traceroute', 'mtr', 'capture'],
              description: 'Network action to perform'
            },
            sessionId: {
              type: 'string',
              description: 'Session ID (required for capture with file output)'
            },
            host: {
              type: 'string',
              description: 'Target hostname or IP address (required for ping, traceroute, mtr)'
            },
            // Ping options
            count: {
              type: 'integer',
              default: 4,
              description: 'Number of packets/probes to send'
            },
            interval: {
              type: 'number',
              default: 1,
              description: 'Interval between pings in seconds'
            },
            packetSize: {
              type: 'integer',
              default: 56,
              description: 'Ping packet size in bytes'
            },
            ttl: {
              type: 'integer',
              description: 'Time-to-live for ping packets'
            },
            // Traceroute options
            maxHops: {
              type: 'integer',
              default: 30,
              description: 'Maximum number of hops for traceroute'
            },
            queries: {
              type: 'integer',
              default: 3,
              description: 'Number of queries per hop'
            },
            waitTime: {
              type: 'integer',
              default: 5,
              description: 'Wait time for response in seconds'
            },
            useIcmp: {
              type: 'boolean',
              default: false,
              description: 'Use ICMP instead of UDP'
            },
            // MTR options
            reportWide: {
              type: 'boolean',
              default: true,
              description: 'Wide report format for mtr'
            },
            noDns: {
              type: 'boolean',
              default: false,
              description: 'Skip DNS resolution'
            },
            // Capture options
            interface: {
              type: 'string',
              default: 'any',
              description: 'Network interface for capture'
            },
            filter: {
              type: 'string',
              description: 'BPF filter expression for capture (e.g., "port 80", "host 192.168.1.1")'
            },
            snaplen: {
              type: 'integer',
              default: 96,
              description: 'Snapshot length (bytes per packet)'
            },
            saveToFile: {
              type: 'boolean',
              default: false,
              description: 'Save capture to pcap file in sandbox'
            },
            // Common
            timeout: {
              type: 'integer',
              default: 30000,
              description: 'Operation timeout in milliseconds'
            }
          },
          required: ['action']
        }
      }
    );
  }
}

/**
 * Create a NetToolsTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} [sandboxManager]
 * @param {Object} [config]
 * @returns {NetToolsTool}
 */
export function createNetToolsTool(sandboxManager, config) {
  return new NetToolsTool(sandboxManager, config);
}

export default NetToolsTool;
