/**
 * @fileoverview Markdown to DOCX Conversion Tool
 * @module md-docx-tool
 *
 * Converts Markdown files to Microsoft Word DOCX format.
 * Uses the docx library for document generation.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  ImageRun,
  Packer
} from 'docx';

/**
 * Parse Markdown into structured elements
 * @param {string} markdown - Markdown content
 * @returns {Array} Array of parsed elements
 */
function parseMarkdown(markdown) {
  const elements = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      elements.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2]
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push({ type: 'hr' });
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3);
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push({
        type: 'codeblock',
        language: lang,
        content: codeLines.join('\n')
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      elements.push({
        type: 'blockquote',
        content: quoteLines.join('\n')
      });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line.trim())) {
      const listItems = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trim())) {
        listItems.push(lines[i].replace(/^[-*+]\s/, '').trim());
        i++;
      }
      elements.push({
        type: 'ul',
        items: listItems
      });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line.trim())) {
      const listItems = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(lines[i].replace(/^\d+\.\s/, '').trim());
        i++;
      }
      elements.push({
        type: 'ol',
        items: listItems
      });
      continue;
    }

    // Table
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].includes('-')) {
      const tableRows = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').map(c => c.trim()).filter(c => c);
        if (!/^[-:\s|]+$/.test(lines[i])) {
          tableRows.push(cells);
        }
        i++;
      }
      elements.push({
        type: 'table',
        rows: tableRows
      });
      continue;
    }

    // Regular paragraph
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !lines[i].match(/^#{1,6}\s/) &&
           !lines[i].trim().startsWith('```') && !lines[i].trim().startsWith('>') &&
           !/^[-*+]\s/.test(lines[i].trim()) && !/^\d+\.\s/.test(lines[i].trim()) &&
           !lines[i].includes('|') && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      elements.push({
        type: 'paragraph',
        content: paraLines.join(' ')
      });
    }
  }

  return elements;
}

/**
 * Parse inline formatting in text
 * @param {string} text - Text with inline formatting
 * @returns {TextRun[]} Array of TextRun objects
 */
function parseInline(text) {
  const runs = [];
  let remaining = text;

  // Process inline elements
  const inlinePatterns = [
    { pattern: /\*\*\*(.+?)\*\*\*/g, bold: true, italic: true },
    { pattern: /\*\*(.+?)\*\*/g, bold: true },
    { pattern: /\*(.+?)\*/g, italic: true },
    { pattern: /___(.+?)___/g, bold: true, italic: true },
    { pattern: /__(.+?)__/g, bold: true },
    { pattern: /_(.+?)_/g, italic: true },
    { pattern: /~~(.+?)~~/g, strike: true },
    { pattern: /`(.+?)`/g, code: true }
  ];

  // Simple approach: split and process
  // For now, we'll do a simpler processing
  let pos = 0;
  const segments = [];

  // Find all formatting markers
  while (pos < remaining.length) {
    let found = false;

    // Check for bold+italic
    if (remaining.slice(pos).startsWith('***') || remaining.slice(pos).startsWith('___')) {
      const marker = remaining.slice(pos, pos + 3);
      const endPos = remaining.indexOf(marker, pos + 3);
      if (endPos !== -1) {
        segments.push({ text: remaining.slice(pos + 3, endPos), bold: true, italic: true });
        pos = endPos + 3;
        found = true;
      }
    }

    // Check for bold
    if (!found && (remaining.slice(pos).startsWith('**') || remaining.slice(pos).startsWith('__'))) {
      const marker = remaining.slice(pos, pos + 2);
      const endPos = remaining.indexOf(marker, pos + 2);
      if (endPos !== -1) {
        segments.push({ text: remaining.slice(pos + 2, endPos), bold: true });
        pos = endPos + 2;
        found = true;
      }
    }

    // Check for italic
    if (!found && (remaining[pos] === '*' || remaining[pos] === '_')) {
      const marker = remaining[pos];
      const endPos = remaining.indexOf(marker, pos + 1);
      if (endPos !== -1 && endPos > pos + 1) {
        segments.push({ text: remaining.slice(pos + 1, endPos), italic: true });
        pos = endPos + 1;
        found = true;
      }
    }

    // Check for strikethrough
    if (!found && remaining.slice(pos).startsWith('~~')) {
      const endPos = remaining.indexOf('~~', pos + 2);
      if (endPos !== -1) {
        segments.push({ text: remaining.slice(pos + 2, endPos), strike: true });
        pos = endPos + 2;
        found = true;
      }
    }

    // Check for inline code
    if (!found && remaining[pos] === '`') {
      const endPos = remaining.indexOf('`', pos + 1);
      if (endPos !== -1) {
        segments.push({ text: remaining.slice(pos + 1, endPos), code: true });
        pos = endPos + 1;
        found = true;
      }
    }

    // Regular character
    if (!found) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && !lastSeg.bold && !lastSeg.italic && !lastSeg.strike && !lastSeg.code) {
        lastSeg.text += remaining[pos];
      } else {
        segments.push({ text: remaining[pos] });
      }
      pos++;
    }
  }

  // Convert segments to TextRuns
  for (const seg of segments) {
    runs.push(new TextRun({
      text: seg.text,
      bold: seg.bold,
      italics: seg.italic,
      strike: seg.strike,
      font: seg.code ? 'Courier New' : undefined,
      shading: seg.code ? { fill: 'E8E8E8' } : undefined
    }));
  }

  return runs.length > 0 ? runs : [new TextRun(text)];
}

/**
 * Markdown to DOCX Tool
 */
export class MdDocxTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for MdDocxTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {string} */
    this.defaultFont = config.defaultFont || 'Arial';

    /** @type {number} */
    this.defaultFontSize = config.defaultFontSize || 24; // half-points (24 = 12pt)
  }

  /**
   * Main entry point
   * @param {Object} args
   * @returns {Promise<Object>}
   */
  async execute(args) {
    const {
      sessionId,
      inputPath,
      outputPath,
      inputContent,
      title,
      author
    } = args;

    // Validate required fields
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!inputPath && !inputContent) {
      return this.formatError('Either inputPath or inputContent is required');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);

    try {
      // Get input content
      let markdown;
      if (inputPath) {
        const absInputPath = join(sandboxPath, inputPath);

        if (!existsSync(absInputPath)) {
          return this.formatError(`Input file not found: ${inputPath}`);
        }

        markdown = await readFile(absInputPath, 'utf-8');
      } else {
        markdown = inputContent;
      }

      // Parse markdown
      const elements = parseMarkdown(markdown);

      // Build document children
      const children = [];

      for (const el of elements) {
        switch (el.type) {
          case 'heading':
            const headingLevel = [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
              HeadingLevel.HEADING_5,
              HeadingLevel.HEADING_6
            ][el.level - 1] || HeadingLevel.HEADING_1;

            children.push(new Paragraph({
              children: parseInline(el.content),
              heading: headingLevel
            }));
            break;

          case 'paragraph':
            children.push(new Paragraph({
              children: parseInline(el.content)
            }));
            break;

          case 'codeblock':
            children.push(new Paragraph({
              children: [
                new TextRun({
                  text: el.content,
                  font: 'Courier New',
                  size: 20
                })
              ],
              shading: { fill: 'F0F0F0' },
              spacing: { before: 200, after: 200 }
            }));
            break;

          case 'blockquote':
            children.push(new Paragraph({
              children: parseInline(el.content),
              indent: { left: 720 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 6, color: '999999' }
              }
            }));
            break;

          case 'ul':
            for (const item of el.items) {
              children.push(new Paragraph({
                children: parseInline(item),
                bullet: { level: 0 }
              }));
            }
            break;

          case 'ol':
            for (let idx = 0; idx < el.items.length; idx++) {
              children.push(new Paragraph({
                children: [
                  new TextRun(`${idx + 1}. `),
                  ...parseInline(el.items[idx])
                ]
              }));
            }
            break;

          case 'table':
            const tableRows = el.rows.map((row, rowIdx) =>
              new TableRow({
                children: row.map(cell =>
                  new TableCell({
                    children: [new Paragraph({ children: parseInline(cell) })],
                    shading: rowIdx === 0 ? { fill: 'E0E0E0' } : undefined
                  })
                )
              })
            );
            children.push(new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE }
            }));
            break;

          case 'hr':
            children.push(new Paragraph({
              children: [new TextRun({ text: '' })],
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
              spacing: { before: 200, after: 200 }
            }));
            break;
        }
      }

      // Create document
      const doc = new Document({
        title: title,
        creator: author,
        sections: [{
          properties: {},
          children
        }]
      });

      // Generate buffer
      const buffer = await Packer.toBuffer(doc);

      // Determine output path
      const outputFileName = outputPath || (inputPath ? inputPath.replace(/\.md$/i, '.docx') : 'output.docx');
      const absOutputPath = join(sandboxPath, outputFileName);

      // Write output
      await writeFile(absOutputPath, buffer);

      return this.formatResponse({
        success: true,
        inputPath: inputPath || '(content)',
        outputPath: outputFileName,
        elementCount: elements.length,
        fileSize: buffer.length,
        sandboxPath
      });
    } catch (err) {
      return this.formatError(`Conversion failed: ${err.message}`);
    }
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
      'md_docx',
      this.execute.bind(this),
      {
        name: 'md_docx',
        description: 'Convert Markdown files to Microsoft Word DOCX format. Supports headings, paragraphs, lists, tables, code blocks, blockquotes, and inline formatting (bold, italic, strikethrough, code).',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            inputPath: {
              type: 'string',
              description: 'Path to input Markdown file (relative to sandbox)'
            },
            outputPath: {
              type: 'string',
              description: 'Path for output DOCX file (optional, defaults to input name with .docx extension)'
            },
            inputContent: {
              type: 'string',
              description: 'Markdown content as string (alternative to inputPath)'
            },
            title: {
              type: 'string',
              description: 'Document title metadata'
            },
            author: {
              type: 'string',
              description: 'Document author metadata'
            }
          },
          required: ['sessionId']
        }
      }
    );
  }
}

/**
 * Create a MdDocxTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {MdDocxTool}
 */
export function createMdDocxTool(sandboxManager, config) {
  return new MdDocxTool(sandboxManager, config);
}

export default MdDocxTool;
