/**
 * @fileoverview DOCX to Markdown Conversion Tool
 * @module docx-md-tool
 *
 * Converts Microsoft Word DOCX files to Markdown format.
 * Uses mammoth for DOCX parsing and custom HTML-to-MD conversion.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import mammoth from 'mammoth';

/**
 * Convert HTML to Markdown
 * @param {string} html - HTML content
 * @returns {string} Markdown content
 */
function htmlToMarkdown(html) {
  let md = html;

  // Handle headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // Handle bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // Handle underline (no direct MD equivalent, use emphasis)
  md = md.replace(/<u[^>]*>(.*?)<\/u>/gi, '_$1_');

  // Handle strikethrough
  md = md.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~');
  md = md.replace(/<strike[^>]*>(.*?)<\/strike>/gi, '~~$1~~');
  md = md.replace(/<del[^>]*>(.*?)<\/del>/gi, '~~$1~~');

  // Handle links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Handle images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  // Handle unordered lists
  md = md.replace(/<ul[^>]*>/gi, '\n');
  md = md.replace(/<\/ul>/gi, '\n');
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');

  // Handle ordered lists (simplified - doesn't track numbers)
  md = md.replace(/<ol[^>]*>/gi, '\n');
  md = md.replace(/<\/ol>/gi, '\n');

  // Handle paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');

  // Handle line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Handle blockquotes
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (match, content) => {
    return content.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
  });

  // Handle code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // Handle horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n\n');

  // Handle tables (basic)
  md = md.replace(/<table[^>]*>(.*?)<\/table>/gis, (match, content) => {
    let tableRows = [];
    const rowMatches = content.match(/<tr[^>]*>(.*?)<\/tr>/gis) || [];

    rowMatches.forEach((row, idx) => {
      const cells = [];
      const cellMatches = row.match(/<t[hd][^>]*>(.*?)<\/t[hd]>/gis) || [];
      cellMatches.forEach(cell => {
        const cellContent = cell.replace(/<\/?t[hd][^>]*>/gi, '').trim();
        cells.push(cellContent);
      });
      tableRows.push('| ' + cells.join(' | ') + ' |');

      // Add header separator after first row
      if (idx === 0) {
        tableRows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
      }
    });

    return tableRows.join('\n') + '\n\n';
  });

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&nbsp;/g, ' ');
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");

  // Clean up extra whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

/**
 * DOCX to Markdown Tool
 */
export class DocxMdTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for DocxMdTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {boolean} */
    this.extractImages = config.extractImages !== false;

    /** @type {string} */
    this.imageDir = config.imageDir || 'images';
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
      extractImages = this.extractImages,
      imageDir = this.imageDir
    } = args;

    // Validate required fields
    if (!sessionId) {
      return this.formatError('sessionId is required for sandbox isolation');
    }

    if (!inputPath) {
      return this.formatError('inputPath is required');
    }

    // Get sandbox path
    const sandboxPath = await this.sandboxManager.ensureSandbox(sessionId);
    const absInputPath = join(sandboxPath, inputPath);

    // Verify input file exists
    if (!existsSync(absInputPath)) {
      return this.formatError(`Input file not found: ${inputPath}`);
    }

    // Determine output path
    const outputFileName = outputPath || inputPath.replace(/\.docx$/i, '.md');
    const absOutputPath = join(sandboxPath, outputFileName);

    try {
      // Read the DOCX file
      const docxBuffer = await readFile(absInputPath);

      // Configure mammoth options
      const mammothOptions = {};

      if (extractImages) {
        const absImageDir = join(dirname(absOutputPath), imageDir);
        let imageCount = 0;

        mammothOptions.convertImage = mammoth.images.imgElement(async (image) => {
          imageCount++;
          const ext = image.contentType.split('/')[1] || 'png';
          const imageName = `image_${imageCount}.${ext}`;
          const imagePath = join(absImageDir, imageName);

          // Ensure image directory exists
          const { mkdir } = await import('fs/promises');
          await mkdir(absImageDir, { recursive: true });

          // Write image
          const imageBuffer = await image.read();
          await writeFile(imagePath, imageBuffer);

          return { src: `${imageDir}/${imageName}` };
        });
      }

      // Convert DOCX to HTML
      const result = await mammoth.convertToHtml({ buffer: docxBuffer }, mammothOptions);
      const html = result.value;
      const warnings = result.messages.filter(m => m.type === 'warning').map(m => m.message);

      // Convert HTML to Markdown
      const markdown = htmlToMarkdown(html);

      // Write output file
      await writeFile(absOutputPath, markdown, 'utf-8');

      return this.formatResponse({
        success: true,
        inputPath,
        outputPath: outputFileName,
        markdownLength: markdown.length,
        warnings: warnings.length > 0 ? warnings : undefined,
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
      'docx_md',
      this.execute.bind(this),
      {
        name: 'docx_md',
        description: 'Convert Microsoft Word DOCX files to Markdown format. Extracts text, formatting, tables, and optionally images. Useful for document processing workflows.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (required)'
            },
            inputPath: {
              type: 'string',
              description: 'Path to input DOCX file (relative to sandbox)'
            },
            outputPath: {
              type: 'string',
              description: 'Path for output Markdown file (optional, defaults to input name with .md extension)'
            },
            extractImages: {
              type: 'boolean',
              default: true,
              description: 'Extract embedded images to separate files'
            },
            imageDir: {
              type: 'string',
              default: 'images',
              description: 'Directory name for extracted images (relative to output file)'
            }
          },
          required: ['sessionId', 'inputPath']
        }
      }
    );
  }
}

/**
 * Create a DocxMdTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {DocxMdTool}
 */
export function createDocxMdTool(sandboxManager, config) {
  return new DocxMdTool(sandboxManager, config);
}

export default DocxMdTool;
