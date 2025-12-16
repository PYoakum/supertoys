import { Tokenizer } from './tokenizer';
import { Parser } from './parser';
import { Renderer } from './renderer';
import { ConversionOptions } from './types';

/**
 * Convert Markdown text to HTML
 * 
 * @param markdown - The Markdown text to convert
 * @param options - Optional conversion options
 * @returns HTML string
 * 
 * @example
 * ```typescript
 * import { markdownToHtml } from 'marker';
 * 
 * const markdown = '# Hello World\n\nThis is **bold** text.';
 * const html = markdownToHtml(markdown);
 * console.log(html);
 * // Output: <h1>Hello World</h1><p>This is <strong>bold</strong> text.</p>
 * ```
 * 
 * @example
 * ```typescript
 * // With options
 * const html = markdownToHtml(markdown, {
 *   sanitize: true,
 *   headerIds: true,
 *   highlightCode: true
 * });
 * ```
 */
export default function markdownToHtml(markdown: string, options: ConversionOptions = {}): string {
  try {
    // Step 1: Tokenize the markdown
    const tokenizer = new Tokenizer();
    const tokens = tokenizer.tokenize(markdown);

    // Step 2: Parse tokens into AST
    const parser = new Parser();
    const ast = parser.parse(tokens);

    // Step 3: Render AST to HTML
    const renderer = new Renderer(options);
    const html = renderer.render(ast);

    return html;
  } catch (error) {
    // Handle errors gracefully
    if (error instanceof Error) {
      throw new Error(`Markdown conversion failed: ${error.message}`);
    }
    throw new Error('Markdown conversion failed: Unknown error');
  }
}

// Export types and classes for advanced usage
/*
export { ConversionOptions, TokenType, Token, ASTNode } from './types';
export { Tokenizer } from './tokenizer';
export { Parser } from './parser';
export { Renderer } from './renderer';
export { escapeHtml, isSafeUrl, sanitizeHtml, generateSlug } from './sanitizer';
*/