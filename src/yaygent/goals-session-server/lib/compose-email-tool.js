/**
 * @fileoverview Email Composition Tool
 * @module compose-email-tool
 *
 * Allows LLM to compose emails by streaming text to a notepad resource,
 * then export as a properly formatted .eml file.
 *
 * Uses placeholder addresses for template-style composition:
 * - Sender: SENDER@SENDER.SEND (or custom)
 * - Recipient: RECIPIENT@RECIPIENT.RECEIVE (or custom)
 *
 * The .eml format follows RFC 5322 (Internet Message Format).
 */

import { writeFile, readFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Default placeholder email addresses
 * These can be replaced via token_replace tool or manually
 */
const PLACEHOLDER_ADDRESSES = {
  sender: 'SENDER@SENDER.SEND',
  recipient: 'RECIPIENT@RECIPIENT.RECEIVE',
  cc: 'CC@CC.COPY',
  bcc: 'BCC@BCC.BLIND',
  replyTo: 'REPLY@REPLY.TO'
};

/**
 * Email notepad storage (in-memory per session)
 * Maps sessionId -> { subject, body, headers }
 */
const emailNotepads = new Map();

/**
 * Generate RFC 5322 compliant Message-ID
 * @returns {string}
 */
function generateMessageId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `<${timestamp}.${random}@yaygent.local>`;
}

/**
 * Format date for email headers (RFC 5322)
 * @param {Date} [date]
 * @returns {string}
 */
function formatEmailDate(date = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const d = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // Get timezone offset
  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');

  return `${d}, ${day} ${month} ${year} ${hours}:${minutes}:${seconds} ${tzSign}${tzHours}${tzMins}`;
}

/**
 * Encode header value for non-ASCII characters (RFC 2047)
 * @param {string} value
 * @returns {string}
 */
function encodeHeaderValue(value) {
  // Check if encoding needed
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  // Use Base64 encoding for non-ASCII
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

/**
 * Format email address with optional display name
 * @param {string} email
 * @param {string} [name]
 * @returns {string}
 */
function formatAddress(email, name) {
  if (name) {
    return `${encodeHeaderValue(name)} <${email}>`;
  }
  return email;
}

/**
 * Wrap long lines for email body (RFC 5322 recommends 78 chars)
 * @param {string} text
 * @param {number} [maxLength=76]
 * @returns {string}
 */
function wrapLines(text, maxLength = 76) {
  const lines = text.split('\n');
  const wrapped = [];

  for (const line of lines) {
    if (line.length <= maxLength) {
      wrapped.push(line);
      continue;
    }

    let remaining = line;
    while (remaining.length > maxLength) {
      // Find last space before maxLength
      let breakPoint = remaining.lastIndexOf(' ', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }
      wrapped.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    if (remaining) {
      wrapped.push(remaining);
    }
  }

  return wrapped.join('\n');
}

/**
 * Build .eml file content from email data
 * @param {Object} email
 * @returns {string}
 */
function buildEmlContent(email) {
  const lines = [];

  // Required headers
  lines.push(`From: ${formatAddress(email.from || PLACEHOLDER_ADDRESSES.sender, email.fromName)}`);
  lines.push(`To: ${formatAddress(email.to || PLACEHOLDER_ADDRESSES.recipient, email.toName)}`);
  lines.push(`Subject: ${encodeHeaderValue(email.subject || '(No Subject)')}`);
  lines.push(`Date: ${formatEmailDate(email.date || new Date())}`);
  lines.push(`Message-ID: ${email.messageId || generateMessageId()}`);

  // Optional headers
  if (email.cc) {
    const ccAddresses = Array.isArray(email.cc) ? email.cc : [email.cc];
    lines.push(`Cc: ${ccAddresses.map(addr => formatAddress(addr)).join(', ')}`);
  }

  if (email.bcc) {
    const bccAddresses = Array.isArray(email.bcc) ? email.bcc : [email.bcc];
    lines.push(`Bcc: ${bccAddresses.map(addr => formatAddress(addr)).join(', ')}`);
  }

  if (email.replyTo) {
    lines.push(`Reply-To: ${formatAddress(email.replyTo)}`);
  }

  // MIME headers
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 8bit');

  // Custom headers
  lines.push('X-Mailer: YayAgent Compose Email Tool');
  lines.push('X-Priority: 3');

  if (email.importance) {
    lines.push(`Importance: ${email.importance}`);
  }

  // Empty line separates headers from body
  lines.push('');

  // Body
  const body = email.body || '';
  lines.push(wrapLines(body));

  return lines.join('\r\n');
}

/**
 * Compose Email Tool
 */
export class ComposeEmailTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   * @param {import('./tool-router.js').NotepadTool} [config.notepadTool] - Optional notepad tool for cross-tool access
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for ComposeEmailTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {import('./tool-router.js').NotepadTool|null} */
    this.notepadTool = config.notepadTool || null;

    /** @type {Object} */
    this.defaultAddresses = {
      ...PLACEHOLDER_ADDRESSES,
      ...config.defaultAddresses
    };
  }

  /**
   * Sync email content to notepad for cross-tool access
   * @param {string} sessionId
   * @param {Object} notepad - Email notepad data
   * @param {string} [notepadFilename='email_draft'] - Filename to use in notepad
   * @private
   */
  async _syncToNotepad(sessionId, notepad, notepadFilename = 'email_draft') {
    if (!this.notepadTool) return;

    try {
      // Write full email content to notepad
      const emailContent = [
        `Subject: ${notepad.subject || '(No Subject)'}`,
        `From: ${notepad.fromName ? `${notepad.fromName} <${notepad.from}>` : notepad.from}`,
        `To: ${notepad.toName ? `${notepad.toName} <${notepad.to}>` : notepad.to}`,
        notepad.cc ? `Cc: ${notepad.cc}` : null,
        notepad.bcc ? `Bcc: ${notepad.bcc}` : null,
        '',
        notepad.body || ''
      ].filter(line => line !== null).join('\n');

      await this.notepadTool.write({
        sessionId,
        filename: notepadFilename,
        content: emailContent,
        append: false
      });

      return notepadFilename;
    } catch (err) {
      // Log but don't fail - notepad sync is optional
      console.error(`[compose_email] Failed to sync to notepad: ${err.message}`);
      return null;
    }
  }

  /**
   * Main entry point - routes to appropriate action
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const { sessionId, action = 'compose' } = args;

    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    switch (action) {
      case 'compose':
      case 'new':
        return this._newEmail(args);

      case 'append':
      case 'stream':
        return this._appendBody(args);

      case 'set':
      case 'update':
        return this._updateField(args);

      case 'preview':
        return this._preview(args);

      case 'export':
      case 'save':
        return this._export(args);

      case 'clear':
        return this._clear(args);

      case 'status':
        return this._status(args);

      default:
        return this.formatError(`Unknown action: ${action}. Use: compose, append, set, preview, export, clear, status`);
    }
  }

  /**
   * Start a new email composition
   * @private
   */
  async _newEmail(args) {
    const {
      sessionId,
      to,
      toName,
      from,
      fromName,
      subject,
      body,
      cc,
      bcc,
      replyTo,
      importance,
      usePlaceholders = true,
      notepadFilename = 'email_draft'
    } = args;

    const notepad = {
      to: to || (usePlaceholders ? this.defaultAddresses.recipient : undefined),
      toName,
      from: from || (usePlaceholders ? this.defaultAddresses.sender : undefined),
      fromName,
      subject: subject || '',
      body: body || '',
      cc,
      bcc,
      replyTo,
      importance,
      notepadFilename, // Store the filename for subsequent syncs
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    emailNotepads.set(sessionId, notepad);

    // Sync to notepad for cross-tool access
    const syncedFilename = await this._syncToNotepad(sessionId, notepad, notepadFilename);

    return this.formatResponse({
      success: true,
      action: 'compose',
      message: 'New email composition started',
      notepad: {
        to: notepad.to,
        from: notepad.from,
        subject: notepad.subject,
        bodyLength: notepad.body.length,
        hasPlaceholders: usePlaceholders
      },
      syncedToNotepad: !!syncedFilename,
      notepadFilename: syncedFilename,
      notepadAccess: syncedFilename ? {
        tool: 'notepad_read',
        sessionId: sessionId,
        filename: syncedFilename,
        hint: `Use notepad_read with sessionId="${sessionId}" and filename="${syncedFilename}" to read this email`
      } : null,
      instructions: [
        'Use action="append" with text="..." to add content to the body',
        'Use action="set" with field="subject" and value="..." to update fields',
        'Use action="preview" to see the full email',
        'Use action="export" to save as .eml file',
        'Placeholder addresses can be replaced with token_replace tool',
        syncedFilename ? `Email content is available via notepad_read with sessionId="${sessionId}" and filename="${syncedFilename}"` : null
      ].filter(Boolean)
    });
  }

  /**
   * Append text to email body (streaming)
   * @private
   */
  async _appendBody(args) {
    const { sessionId, text, newline = true } = args;

    if (!text) {
      return this.formatError('text is required for append action');
    }

    let notepad = emailNotepads.get(sessionId);
    if (!notepad) {
      // Auto-create notepad if not exists
      notepad = {
        to: this.defaultAddresses.recipient,
        from: this.defaultAddresses.sender,
        subject: '',
        body: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      emailNotepads.set(sessionId, notepad);
    }

    // Append text with optional newline
    notepad.body += text + (newline ? '\n' : '');
    notepad.updatedAt = new Date().toISOString();

    // Sync to notepad for cross-tool access (use stored filename)
    await this._syncToNotepad(sessionId, notepad, notepad.notepadFilename || 'email_draft');

    return this.formatResponse({
      success: true,
      action: 'append',
      message: `Appended ${text.length} characters to body`,
      bodyLength: notepad.body.length,
      lineCount: notepad.body.split('\n').length,
      notepadFilename: notepad.notepadFilename || 'email_draft'
    });
  }

  /**
   * Update a specific email field
   * @private
   */
  async _updateField(args) {
    const { sessionId, field, value } = args;

    if (!field) {
      return this.formatError('field is required for set action');
    }

    let notepad = emailNotepads.get(sessionId);
    if (!notepad) {
      return this.formatError('No email composition in progress. Use action="compose" first.');
    }

    const allowedFields = ['to', 'toName', 'from', 'fromName', 'subject', 'body', 'cc', 'bcc', 'replyTo', 'importance'];
    if (!allowedFields.includes(field)) {
      return this.formatError(`Invalid field: ${field}. Allowed: ${allowedFields.join(', ')}`);
    }

    notepad[field] = value;
    notepad.updatedAt = new Date().toISOString();

    // Sync to notepad for cross-tool access (use stored filename)
    await this._syncToNotepad(sessionId, notepad, notepad.notepadFilename || 'email_draft');

    return this.formatResponse({
      success: true,
      action: 'set',
      field,
      message: `Updated ${field}`,
      preview: field === 'body' ? `${String(value).slice(0, 50)}...` : value,
      notepadFilename: notepad.notepadFilename || 'email_draft'
    });
  }

  /**
   * Preview the composed email
   * @private
   */
  async _preview(args) {
    const { sessionId, format = 'summary' } = args;

    const notepad = emailNotepads.get(sessionId);
    if (!notepad) {
      return this.formatError('No email composition in progress. Use action="compose" first.');
    }

    if (format === 'full' || format === 'eml') {
      // Return full .eml preview
      const emlContent = buildEmlContent(notepad);
      return this.formatResponse({
        success: true,
        action: 'preview',
        format: 'eml',
        content: emlContent
      });
    }

    // Summary format
    return this.formatResponse({
      success: true,
      action: 'preview',
      format: 'summary',
      email: {
        from: notepad.from,
        fromName: notepad.fromName,
        to: notepad.to,
        toName: notepad.toName,
        cc: notepad.cc,
        bcc: notepad.bcc,
        replyTo: notepad.replyTo,
        subject: notepad.subject,
        bodyPreview: notepad.body.slice(0, 200) + (notepad.body.length > 200 ? '...' : ''),
        bodyLength: notepad.body.length,
        lineCount: notepad.body.split('\n').length,
        importance: notepad.importance,
        createdAt: notepad.createdAt,
        updatedAt: notepad.updatedAt
      },
      placeholderInfo: {
        senderPlaceholder: PLACEHOLDER_ADDRESSES.sender,
        recipientPlaceholder: PLACEHOLDER_ADDRESSES.recipient,
        note: 'Use token_replace tool to replace placeholders with actual addresses'
      }
    });
  }

  /**
   * Export email to .eml file
   * @private
   */
  async _export(args) {
    const { sessionId, outputPath, filename } = args;

    const notepad = emailNotepads.get(sessionId);
    if (!notepad) {
      return this.formatError('No email composition in progress. Use action="compose" first.');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeSubject = (notepad.subject || 'email')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 30);
    const defaultFilename = `${safeSubject}-${timestamp}.eml`;
    const finalFilename = filename || outputPath || defaultFilename;

    // Build .eml content
    const emlContent = buildEmlContent(notepad);

    // Write file
    const absOutputPath = join(sandboxPath, finalFilename);
    await writeFile(absOutputPath, emlContent, 'utf-8');

    return this.formatResponse({
      success: true,
      action: 'export',
      outputPath: finalFilename,
      absolutePath: absOutputPath,
      fileSize: emlContent.length,
      message: 'Email exported successfully',
      email: {
        from: notepad.from,
        to: notepad.to,
        subject: notepad.subject,
        bodyLength: notepad.body.length
      },
      nextSteps: [
        'Use token_replace to substitute placeholder addresses',
        'Open .eml file in email client to send',
        'Or use pdf_export to create printable version'
      ]
    });
  }

  /**
   * Clear the current email composition
   * @private
   */
  async _clear(args) {
    const { sessionId } = args;

    const existed = emailNotepads.has(sessionId);
    emailNotepads.delete(sessionId);

    return this.formatResponse({
      success: true,
      action: 'clear',
      message: existed ? 'Email composition cleared' : 'No composition was in progress'
    });
  }

  /**
   * Get status of current composition
   * @private
   */
  async _status(args) {
    const { sessionId } = args;

    const notepad = emailNotepads.get(sessionId);

    if (!notepad) {
      return this.formatResponse({
        success: true,
        action: 'status',
        hasComposition: false,
        message: 'No email composition in progress'
      });
    }

    return this.formatResponse({
      success: true,
      action: 'status',
      hasComposition: true,
      email: {
        from: notepad.from,
        to: notepad.to,
        subject: notepad.subject,
        bodyLength: notepad.body.length,
        lineCount: notepad.body.split('\n').length
      },
      createdAt: notepad.createdAt,
      updatedAt: notepad.updatedAt
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
      'compose_email',
      this.execute.bind(this),
      {
        name: 'compose_email',
        description: `Compose emails by streaming text to a notepad resource, then export as .eml file.

CROSS-TOOL ACCESS (IMPORTANT):
- Email content is automatically saved to notepad for other tools to access
- Default notepad filename: "email_draft" (customizable via notepadFilename parameter)
- To read email content from another task, use: notepad_read with the SAME sessionId and filename="email_draft"
- The response includes notepadAccess object with exact parameters needed to read the email

IMPORTANT EMAIL FORMATTING:
- Uses placeholder addresses by default for template-style composition
- Default sender: SENDER@SENDER.SEND
- Default recipient: RECIPIENT@RECIPIENT.RECEIVE
- Replace placeholders using token_replace tool before sending

WORKFLOW:
1. action="compose" - Start new email with subject, optional body (saves to notepad automatically)
2. action="append" - Stream/add text to body incrementally (updates notepad)
3. action="set" - Update specific fields (to, from, subject, etc.) (updates notepad)
4. action="preview" - View email before export
5. action="export" - Save as .eml file

The exported .eml file can be:
- Opened in any email client (Outlook, Thunderbird, Apple Mail)
- Processed with token_replace to substitute placeholder addresses
- Converted to PDF using pdf_export tool`,
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            action: {
              type: 'string',
              enum: ['compose', 'new', 'append', 'stream', 'set', 'update', 'preview', 'export', 'save', 'clear', 'status'],
              default: 'compose',
              description: 'Action to perform on the email notepad'
            },
            // For compose/new action
            to: {
              type: 'string',
              description: 'Recipient email (default: RECIPIENT@RECIPIENT.RECEIVE)'
            },
            toName: {
              type: 'string',
              description: 'Recipient display name'
            },
            from: {
              type: 'string',
              description: 'Sender email (default: SENDER@SENDER.SEND)'
            },
            fromName: {
              type: 'string',
              description: 'Sender display name'
            },
            subject: {
              type: 'string',
              description: 'Email subject line'
            },
            body: {
              type: 'string',
              description: 'Initial email body content'
            },
            cc: {
              type: ['string', 'array'],
              description: 'CC recipients (single or array)'
            },
            bcc: {
              type: ['string', 'array'],
              description: 'BCC recipients (single or array)'
            },
            replyTo: {
              type: 'string',
              description: 'Reply-To address'
            },
            importance: {
              type: 'string',
              enum: ['low', 'normal', 'high'],
              description: 'Email importance level'
            },
            usePlaceholders: {
              type: 'boolean',
              default: true,
              description: 'Use placeholder addresses (SENDER@SENDER.SEND, RECIPIENT@RECIPIENT.RECEIVE)'
            },
            notepadFilename: {
              type: 'string',
              default: 'email_draft',
              description: 'Filename for notepad cross-tool access. Email content is automatically saved to notepad and can be read via notepad_read with this filename and the same sessionId.'
            },
            // For append action
            text: {
              type: 'string',
              description: 'Text to append to email body'
            },
            newline: {
              type: 'boolean',
              default: true,
              description: 'Add newline after appended text'
            },
            // For set action
            field: {
              type: 'string',
              enum: ['to', 'toName', 'from', 'fromName', 'subject', 'body', 'cc', 'bcc', 'replyTo', 'importance'],
              description: 'Field to update'
            },
            value: {
              type: 'string',
              description: 'New value for the field'
            },
            // For preview action
            format: {
              type: 'string',
              enum: ['summary', 'full', 'eml'],
              default: 'summary',
              description: 'Preview format (summary or full .eml content)'
            },
            // For export action
            outputPath: {
              type: 'string',
              description: 'Output filename for .eml file (auto-generated if not provided)'
            },
            filename: {
              type: 'string',
              description: 'Alias for outputPath'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Create a ComposeEmailTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {ComposeEmailTool}
 */
export function createComposeEmailTool(sandboxManager, config) {
  return new ComposeEmailTool(sandboxManager, config);
}

export default ComposeEmailTool;
