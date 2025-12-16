/**
 * Token types for Markdown parsing
 */
export enum TokenType {
  HEADING = 'HEADING',
  PARAGRAPH = 'PARAGRAPH',
  BOLD = 'BOLD',
  ITALIC = 'ITALIC',
  STRIKETHROUGH = 'STRIKETHROUGH',
  LINK = 'LINK',
  IMAGE = 'IMAGE',
  CODE_BLOCK = 'CODE_BLOCK',
  INLINE_CODE = 'INLINE_CODE',
  LIST_ITEM = 'LIST_ITEM',
  ORDERED_LIST = 'ORDERED_LIST',
  UNORDERED_LIST = 'UNORDERED_LIST',
  BLOCKQUOTE = 'BLOCKQUOTE',
  HR = 'HR',
  TEXT = 'TEXT',
  LINE_BREAK = 'LINE_BREAK',
}

/**
 * Token interface representing a parsed Markdown element
 */
export interface Token {
  type: TokenType;
  value: string;
  depth?: number;
  metadata?: Record<string, any>;
}

/**
 * AST Node interface for building the abstract syntax tree
 */
export interface ASTNode {
  type: string;
  content?: string;
  children?: ASTNode[];
  attributes?: Record<string, string>;
  metadata?: Record<string, any>;
}

/**
 * Configuration options for Markdown to HTML conversion
 */
export interface ConversionOptions {
  /**
   * Sanitize HTML output to prevent XSS attacks
   * @default true
   */
  sanitize?: boolean;

  /**
   * Allow raw HTML passthrough in Markdown
   * @default false
   */
  allowRawHtml?: boolean;

  /**
   * Convert single line breaks (\n) to <br> tags
   * @default false
   */
  breaks?: boolean;

  /**
   * Add ID attributes to header elements
   * @default false
   */
  headerIds?: boolean;

  /**
   * Add syntax highlighting classes to code blocks
   * @default false
   */
  highlightCode?: boolean;
}
