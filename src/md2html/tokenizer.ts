import { Token, TokenType } from './types';

/**
 * Tokenizer class for converting Markdown text into tokens
 */
export class Tokenizer {
  private lines: string[];
  private currentIndex: number;

  constructor() {
    this.lines = [];
    this.currentIndex = 0;
  }

  /**
   * Tokenize Markdown text into an array of tokens
   * @param markdown - The Markdown text to tokenize
   * @returns Array of tokens
   */
  public tokenize(markdown: string): Token[] {
    this.lines = markdown.split('\n');
    this.currentIndex = 0;
    const tokens: Token[] = [];

    while (this.currentIndex < this.lines.length) {
      const token = this.nextToken();
      if (token) {
        tokens.push(token);
      }
    }

    return tokens;
  }

  /**
   * Get the next token from the input
   * @returns The next token or null
   */
  private nextToken():Token | null {
    if (this.currentIndex >= this.lines.length) {
      return null;
    }

    const line = this.lines[this.currentIndex];

    // Skip empty lines (they separate blocks)
    if (line.trim() === '') {
      this.currentIndex++;
      return null;
    }

    // Check for horizontal rule
    if (this.isHorizontalRule(line)) {
      this.currentIndex++;
      return { type: TokenType.HR, value: '' };
    }

    // Check for heading
    const heading = this.parseHeading(line);
    if (heading) {
      this.currentIndex++;
      return heading;
    }

    // Check for code block
    const codeBlock = this.parseCodeBlock();
    if (codeBlock) {
      return codeBlock;
    }

    // Check for blockquote
    const blockquote = this.parseBlockquote();
    if (blockquote) {
      return blockquote;
    }

    // Check for list item
    const listItem = this.parseListItem(line);
    if (listItem) {
      this.currentIndex++;
      return listItem;
    }

    // Default to paragraph
    return this.parseParagraph();
  }

  /**
   * Check if a line is a horizontal rule
   */
  private isHorizontalRule(line: string): boolean {
    const trimmed = line.trim();
    return /^(\*{3,}|-{3,}|_{3,})$/.test(trimmed);
  }

  /**
   * Parse a heading line
   */
  private parseHeading(line: string): Token | null {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      return {
        type: TokenType.HEADING,
        value: match[2].trim(),
        depth: match[1].length,
      };
    }
    return null;
  }

  /**
   * Parse a code block
   */
  private parseCodeBlock(): Token | null {
    const line = this.lines[this.currentIndex];
    const match = line.match(/^```(\w*)$/);
    
    if (match) {
      const language = match[1] || '';
      const codeLines: string[] = [];
      this.currentIndex++;

      // Collect lines until closing fence
      while (this.currentIndex < this.lines.length) {
        const currentLine = this.lines[this.currentIndex];
        if (currentLine.trim() === '```') {
          this.currentIndex++;
          break;
        }
        codeLines.push(currentLine);
        this.currentIndex++;
      }

      return {
        type: TokenType.CODE_BLOCK,
        value: codeLines.join('\n'),
        metadata: { language },
      };
    }

    return null;
  }

  /**
   * Parse a blockquote
   */
  private parseBlockquote(): Token | null {
    const line = this.lines[this.currentIndex];
    
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      
      while (this.currentIndex < this.lines.length) {
        const currentLine = this.lines[this.currentIndex];
        if (!currentLine.trim().startsWith('>')) {
          break;
        }
        quoteLines.push(currentLine.replace(/^\s*>\s?/, ''));
        this.currentIndex++;
      }

      return {
        type: TokenType.BLOCKQUOTE,
        value: quoteLines.join('\n'),
      };
    }

    return null;
  }

  /**
   * Parse a list item
   */
  private parseListItem(line: string): Token | null {
    // Unordered list
    const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (unorderedMatch) {
      const indent = unorderedMatch[1].length;
      return {
        type: TokenType.LIST_ITEM,
        value: unorderedMatch[3],
        depth: Math.floor(indent / 2),
        metadata: { ordered: false },
      };
    }

    // Ordered list
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const indent = orderedMatch[1].length;
      return {
        type: TokenType.LIST_ITEM,
        value: orderedMatch[3],
        depth: Math.floor(indent / 2),
        metadata: { ordered: true, number: parseInt(orderedMatch[2]) },
      };
    }

    return null;
  }

  /**
   * Parse a paragraph (collect consecutive non-empty lines)
   */
  private parseParagraph(): Token {
    const paragraphLines: string[] = [];
    
    while (this.currentIndex < this.lines.length) {
      const line = this.lines[this.currentIndex];
      
      // Stop at empty line
      if (line.trim() === '') {
        break;
      }

      // Stop at special syntax
      if (this.isHorizontalRule(line) ||
          this.parseHeading(line) ||
          line.trim().startsWith('>') ||
          line.trim().startsWith('```') ||
          this.parseListItem(line)) {
        break;
      }

      paragraphLines.push(line);
      this.currentIndex++;
    }

    return {
      type: TokenType.PARAGRAPH,
      value: paragraphLines.join('\n'),
    };
  }
}