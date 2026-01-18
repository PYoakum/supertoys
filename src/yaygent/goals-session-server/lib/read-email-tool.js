/**
 * @fileoverview Read Email Tool
 * @module read-email-tool
 *
 * Allows reading email files (.eml, .msg) and adding their content
 * to the session context for processing during task execution.
 */

import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, extname } from 'path';

/**
 * Default limits
 */
const DEFAULT_LIMITS = {
  maxFileSize: 10 * 1024 * 1024,  // 10MB max file size (emails can have attachments)
  maxEmails: 20                    // Max emails per session
};

/**
 * Parse RFC 5322 email headers from .eml content
 * @param {string} content - Raw email content
 * @returns {Object} - Parsed headers and body
 */
function parseEmlContent(content) {
  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split headers and body (empty line separates them)
  const headerBodySplit = normalized.indexOf('\n\n');
  let headerSection, bodySection;

  if (headerBodySplit === -1) {
    // No body, just headers
    headerSection = normalized;
    bodySection = '';
  } else {
    headerSection = normalized.slice(0, headerBodySplit);
    bodySection = normalized.slice(headerBodySplit + 2);
  }

  // Parse headers (handle multi-line headers that start with whitespace)
  const headers = {};
  const headerLines = headerSection.split('\n');
  let currentHeader = null;
  let currentValue = '';

  for (const line of headerLines) {
    if (line.match(/^\s/) && currentHeader) {
      // Continuation of previous header
      currentValue += ' ' + line.trim();
    } else {
      // Save previous header
      if (currentHeader) {
        headers[currentHeader.toLowerCase()] = decodeHeaderValue(currentValue);
      }

      // Parse new header
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        currentHeader = line.slice(0, colonIndex).trim();
        currentValue = line.slice(colonIndex + 1).trim();
      }
    }
  }

  // Save last header
  if (currentHeader) {
    headers[currentHeader.toLowerCase()] = decodeHeaderValue(currentValue);
  }

  // Extract common headers with proper names
  const email = {
    from: parseAddressHeader(headers['from']),
    to: parseAddressHeader(headers['to']),
    cc: parseAddressHeader(headers['cc']),
    bcc: parseAddressHeader(headers['bcc']),
    replyTo: parseAddressHeader(headers['reply-to']),
    subject: headers['subject'] || '(No Subject)',
    date: headers['date'] || null,
    messageId: headers['message-id'] || null,
    inReplyTo: headers['in-reply-to'] || null,
    references: headers['references'] || null,
    contentType: headers['content-type'] || 'text/plain',
    importance: headers['importance'] || headers['x-priority'] || 'normal',
    headers: headers,  // Include all headers for reference
    body: bodySection,
    bodyPreview: bodySection.slice(0, 500) + (bodySection.length > 500 ? '...' : '')
  };

  return email;
}

/**
 * Decode RFC 2047 encoded header values
 * @param {string} value
 * @returns {string}
 */
function decodeHeaderValue(value) {
  if (!value) return '';

  // Match =?charset?encoding?text?= patterns
  const encodedWordRegex = /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi;

  return value.replace(encodedWordRegex, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        // Base64 encoding
        return Buffer.from(text, 'base64').toString('utf-8');
      } else if (encoding.toUpperCase() === 'Q') {
        // Quoted-printable encoding
        return text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-F]{2})/gi, (m, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          );
      }
    } catch (e) {
      // Return original if decoding fails
    }
    return match;
  });
}

/**
 * Parse email address header (handles "Name <email>" format)
 * @param {string} header
 * @returns {Object|Object[]|null}
 */
function parseAddressHeader(header) {
  if (!header) return null;

  // Handle multiple addresses (comma-separated)
  const addresses = [];
  const parts = header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);  // Split on commas not in quotes

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match "Display Name" <email@domain> or email@domain
    const match = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?$/);

    if (match) {
      addresses.push({
        name: match[1]?.trim() || null,
        email: match[2].trim()
      });
    } else {
      // Just use as-is
      addresses.push({
        name: null,
        email: trimmed
      });
    }
  }

  if (addresses.length === 0) return null;
  if (addresses.length === 1) return addresses[0];
  return addresses;
}

/**
 * Format address for display
 * @param {Object|Object[]|null} addr
 * @returns {string}
 */
function formatAddress(addr) {
  if (!addr) return '';

  if (Array.isArray(addr)) {
    return addr.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ');
  }

  return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
}

/**
 * Read Email Tool
 * Reads email files and adds them to session context
 */
export class ReadEmailTool {
  /**
   * @param {import('./session-manager.js').SessionManager} sessionManager
   * @param {Object} [config]
   */
  constructor(sessionManager, config = {}) {
    if (!sessionManager) {
      throw new Error('SessionManager is required for ReadEmailTool');
    }

    /** @type {import('./session-manager.js').SessionManager} */
    this.sessionManager = sessionManager;

    /** @type {number} */
    this.maxFileSize = config.maxFileSize || DEFAULT_LIMITS.maxFileSize;

    /** @type {number} */
    this.maxEmails = config.maxEmails || DEFAULT_LIMITS.maxEmails;

    /** @type {string[]} */
    this.allowedPaths = config.allowedPaths || [];

    /** @type {boolean} */
    this.allowAbsolutePaths = config.allowAbsolutePaths !== false;
  }

  /**
   * Read an email file and add it to session context
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const { sessionId, path: filePath, alias, includeRawHeaders = false } = args;

    // Validate required fields
    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    if (!filePath) {
      return this.formatError('path is required');
    }

    // Resolve the file path
    const resolvedPath = this.allowAbsolutePaths && filePath.startsWith('/')
      ? filePath
      : resolve(process.cwd(), filePath);

    // Check if path is allowed (if restrictions are set)
    if (this.allowedPaths.length > 0) {
      const isAllowed = this.allowedPaths.some(allowed =>
        resolvedPath.startsWith(resolve(process.cwd(), allowed))
      );
      if (!isAllowed) {
        return this.formatError(`Path not allowed: ${filePath}`);
      }
    }

    // Check if file exists
    if (!existsSync(resolvedPath)) {
      return this.formatError(`File not found: ${filePath}`);
    }

    // Validate file extension
    const ext = extname(resolvedPath).toLowerCase();
    if (ext !== '.eml' && ext !== '.msg' && ext !== '.email' && ext !== '.txt') {
      return this.formatError(
        `Unsupported email format: ${ext}. Supported: .eml, .msg, .email, .txt`
      );
    }

    try {
      // Check file size
      const stats = await stat(resolvedPath);
      if (stats.size > this.maxFileSize) {
        return this.formatError(
          `File too large: ${stats.size} bytes (max: ${this.maxFileSize} bytes)`
        );
      }

      // Read file content
      const content = await readFile(resolvedPath, 'utf-8');
      const fileName = alias || basename(resolvedPath);

      // Parse email content
      const email = parseEmlContent(content);

      // Get session and add to context
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        return this.formatError(`Session not found: ${sessionId}`);
      }

      // Check max emails limit
      const currentEmailCount = session.context?.files?.filter(
        f => f.source === 'read_email_tool'
      ).length || 0;

      if (currentEmailCount >= this.maxEmails) {
        return this.formatError(
          `Maximum emails reached: ${this.maxEmails}. Cannot add more emails to context.`
        );
      }

      // Format email content for context
      const formattedContent = this._formatEmailForContext(email, includeRawHeaders);

      // Create file entry
      const fileEntry = {
        path: `emails/${fileName}`,
        content: formattedContent,
        extension: 'email',
        size: stats.size,
        addedAt: new Date().toISOString(),
        source: 'read_email_tool',
        originalPath: filePath,
        emailMetadata: {
          from: formatAddress(email.from),
          to: formatAddress(email.to),
          subject: email.subject,
          date: email.date,
          hasAttachments: email.contentType?.includes('multipart')
        }
      };

      // Add to session context
      if (!session.context) {
        session.context = { files: [], metadata: {} };
      }
      if (!session.context.files) {
        session.context.files = [];
      }

      // Check for duplicate (same path)
      const existingIndex = session.context.files.findIndex(
        f => f.path === fileEntry.path
      );
      if (existingIndex >= 0) {
        // Update existing
        session.context.files[existingIndex] = fileEntry;
      } else {
        // Add new
        session.context.files.push(fileEntry);
      }

      // Update formatted content
      session.context.formattedContent = this._formatContextAsXml(session.context.files);

      return this.formatResponse({
        success: true,
        action: 'read_email',
        email: {
          path: fileEntry.path,
          originalPath: filePath,
          from: formatAddress(email.from),
          to: formatAddress(email.to),
          cc: email.cc ? formatAddress(email.cc) : null,
          subject: email.subject,
          date: email.date,
          bodyPreview: email.bodyPreview,
          bodyLength: email.body.length,
          hasAttachments: email.contentType?.includes('multipart')
        },
        contextFiles: session.context.files.length,
        message: `Email added to session context: ${fileName}`
      });

    } catch (err) {
      return this.formatError(`Failed to read email: ${err.message}`);
    }
  }

  /**
   * List emails in session context
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async list(args) {
    const { sessionId } = args;

    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return this.formatError(`Session not found: ${sessionId}`);
    }

    const files = session.context?.files || [];
    const emailFiles = files.filter(f => f.source === 'read_email_tool');

    return this.formatResponse({
      success: true,
      action: 'list',
      totalContextFiles: files.length,
      emails: emailFiles.map(f => ({
        path: f.path,
        originalPath: f.originalPath,
        ...f.emailMetadata,
        addedAt: f.addedAt
      }))
    });
  }

  /**
   * Remove an email from context
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async remove(args) {
    const { sessionId, path: filePath } = args;

    if (!sessionId) {
      return this.formatError('sessionId is required');
    }

    if (!filePath) {
      return this.formatError('path is required');
    }

    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return this.formatError(`Session not found: ${sessionId}`);
    }

    const files = session.context?.files || [];
    const targetPath = filePath.startsWith('emails/') ? filePath : `emails/${filePath}`;
    const index = files.findIndex(f => f.path === targetPath);

    if (index < 0) {
      return this.formatError(`Email not found in context: ${filePath}`);
    }

    // Only allow removing email files
    if (files[index].source !== 'read_email_tool') {
      return this.formatError('Cannot remove non-email context files');
    }

    const removed = files.splice(index, 1)[0];

    // Update formatted content
    session.context.formattedContent = this._formatContextAsXml(files);

    return this.formatResponse({
      success: true,
      action: 'remove',
      removed: {
        path: removed.path,
        originalPath: removed.originalPath,
        subject: removed.emailMetadata?.subject
      },
      contextFiles: files.length,
      message: `Email removed from context: ${removed.path}`
    });
  }

  /**
   * Format email content for context injection
   * @param {Object} email - Parsed email object
   * @param {boolean} includeRawHeaders
   * @returns {string}
   * @private
   */
  _formatEmailForContext(email, includeRawHeaders = false) {
    const lines = [
      '=== EMAIL ===',
      `From: ${formatAddress(email.from)}`,
      `To: ${formatAddress(email.to)}`
    ];

    if (email.cc) {
      lines.push(`Cc: ${formatAddress(email.cc)}`);
    }

    if (email.bcc) {
      lines.push(`Bcc: ${formatAddress(email.bcc)}`);
    }

    lines.push(`Subject: ${email.subject}`);

    if (email.date) {
      lines.push(`Date: ${email.date}`);
    }

    if (email.messageId) {
      lines.push(`Message-ID: ${email.messageId}`);
    }

    if (email.inReplyTo) {
      lines.push(`In-Reply-To: ${email.inReplyTo}`);
    }

    lines.push('');
    lines.push('--- BODY ---');
    lines.push(email.body);
    lines.push('--- END ---');

    if (includeRawHeaders) {
      lines.push('');
      lines.push('--- RAW HEADERS ---');
      for (const [key, value] of Object.entries(email.headers)) {
        lines.push(`${key}: ${value}`);
      }
      lines.push('--- END HEADERS ---');
    }

    return lines.join('\n');
  }

  /**
   * Format context files as XML
   * @param {Object[]} files
   * @returns {string}
   * @private
   */
  _formatContextAsXml(files) {
    const lines = ['<context>'];

    for (const file of files) {
      const ext = file.extension || 'txt';
      lines.push(`  <file path="${this._escapeXml(file.path)}" extension="${ext}">`);
      lines.push(`    <content><![CDATA[${file.content}]]></content>`);
      lines.push('  </file>');
    }

    lines.push('</context>');
    return lines.join('\n');
  }

  /**
   * Escape XML special characters
   * @param {string} str
   * @returns {string}
   * @private
   */
  _escapeXml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
    // Read email and add to context
    router.registerTool(
      'read_email',
      this.execute.bind(this),
      {
        name: 'read_email',
        description: `Read an email file (.eml format) and add its content to the session context.

Use this tool when you need to:
- Import email content for processing or analysis
- Extract information from emails (sender, recipient, subject, body)
- Include email context for composing replies
- Process email templates or examples

The email is parsed and its content becomes available to subsequent tasks in the session.
Supported formats: .eml, .msg, .email, .txt (RFC 5322 format)

The parsed email includes:
- Headers: From, To, Cc, Bcc, Subject, Date, Message-ID
- Body: Full email body text
- Metadata: Attachments indicator, importance level`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            },
            path: {
              type: 'string',
              description: 'Path to the email file (.eml, .msg, .email, .txt)'
            },
            alias: {
              type: 'string',
              description: 'Optional alias name for the email in context (defaults to filename)'
            },
            includeRawHeaders: {
              type: 'boolean',
              default: false,
              description: 'Include all raw headers in the context (for debugging/analysis)'
            }
          },
          required: ['sessionId', 'path']
        }
      }
    );

    // List emails in context
    router.registerTool(
      'read_email_list',
      this.list.bind(this),
      {
        name: 'read_email_list',
        description: 'List all emails in the session context that were added via read_email tool',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            }
          },
          required: ['sessionId']
        }
      }
    );

    // Remove email from context
    router.registerTool(
      'read_email_remove',
      this.remove.bind(this),
      {
        name: 'read_email_remove',
        description: 'Remove an email from the session context',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (required)'
            },
            path: {
              type: 'string',
              description: 'Path of the email to remove (as shown in read_email_list)'
            }
          },
          required: ['sessionId', 'path']
        }
      }
    );
  }
}

/**
 * Create a ReadEmailTool instance
 * @param {import('./session-manager.js').SessionManager} sessionManager
 * @param {Object} [config]
 * @returns {ReadEmailTool}
 */
export function createReadEmailTool(sessionManager, config) {
  return new ReadEmailTool(sessionManager, config);
}

export default ReadEmailTool;
