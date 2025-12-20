import { TokenType } from './types';
import { type ASTNode } from "./ASTNode";
import { type Token } from "./Token";

/**
 * Parser class for building an Abstract Syntax Tree from tokens
 */
export class Parser {
  private tokens: Token[];
  private currentIndex: number;
  private maxRecursionDepth: number = 50;

  constructor() {
    this.tokens = [];
    this.currentIndex = 0;
  }

  /**
   * Parse tokens into an Abstract Syntax Tree
   * @param tokens - Array of tokens to parse
   * @returns Root AST node
   */
  public parse(tokens: Token[]): ASTNode {
    this.tokens = tokens;
    this.currentIndex = 0;

    const children: ASTNode[] = [];

    while (this.currentIndex < this.tokens.length) {
      const node = this.parseBlock();
      if (node) {
        children.push(node);
      }
    }

    return {
      type: 'root',
      children,
    };
  }

  /**
   * Parse a block-level element
   * @returns An AST node
   */
  private parseBlock(): ASTNode | null {
    if (this.currentIndex >= this.tokens.length) {
      return null;
    }

    const token = this.tokens[this.currentIndex];
    this.currentIndex++;

    switch (token.type) {
      case TokenType.HEADING:
        return this.parseHeadingNode(token);
      
      case TokenType.PARAGRAPH:
        return this.parseParagraphNode(token);
      
      case TokenType.CODE_BLOCK:
        return this.parseCodeBlockNode(token);
      
      case TokenType.BLOCKQUOTE:
        return this.parseBlockquoteNode(token);
      
      case TokenType.LIST_ITEM:
        // Put the token back and parse as a list
        this.currentIndex--;
        return this.parseList();
      
      case TokenType.HR:
        return { type: 'hr' };
      
      default:
        return null;
    }
  }

  /**
   * Parse a heading node
   */
  private parseHeadingNode(token: Token): ASTNode {
    return {
      type: 'heading',
      content: token.value,
      attributes: {
        level: String(token.depth || 1),
      },
      children: this.parseInline(token.value),
    };
  }

  /**
   * Parse a paragraph node
   */
  private parseParagraphNode(token: Token): ASTNode {
    return {
      type: 'paragraph',
      children: this.parseInline(token.value),
    };
  }

  /**
   * Parse a code block node
   */
  private parseCodeBlockNode(token: Token): ASTNode {
    return {
      type: 'code_block',
      content: token.value,
      attributes: {
        language: token.metadata?.language || '',
      },
    };
  }

  /**
   * Parse a blockquote node
   */
  private parseBlockquoteNode(token: Token): ASTNode {
    // Recursively parse the content of the blockquote
    const parser = new Parser();
    const tokenizer = new (require('./tokenizer').Tokenizer)();
    const innerTokens = tokenizer.tokenize(token.value);
    const innerAst = parser.parse(innerTokens);

    return {
      type: 'blockquote',
      children: innerAst.children,
    };
  }

  /**
   * Parse a list (collect consecutive list items)
   */
  private parseList(): ASTNode | null {
    const items: Token[] = [];
    let isOrdered = false;

    // Collect consecutive list items
    while (this.currentIndex < this.tokens.length) {
      const token = this.tokens[this.currentIndex];
      
      if (token.type !== TokenType.LIST_ITEM) {
        break;
      }

      if (items.length === 0) {
        isOrdered = token.metadata?.ordered || false;
      }

      // Check if this item matches the list type
      if ((token.metadata?.ordered || false) !== isOrdered) {
        break;
      }

      items.push(token);
      this.currentIndex++;
    }

    if (items.length === 0) {
      return null;
    }

    // Build nested list structure
    const listItems = this.buildNestedList(items, 0);

    return {
      type: isOrdered ? 'ordered_list' : 'unordered_list',
      children: listItems,
    };
  }

  /**
   * Build nested list structure from flat list items
   */
  private buildNestedList(items: Token[], depth: number, recursionLevel: number = 0): ASTNode[] {
    // Prevent infinite recursion
    if (recursionLevel > this.maxRecursionDepth) {
      return [];
    }

    const result: ASTNode[] = [];
    let i = 0;

    while (i < items.length) {
      const item = items[i];
      const itemDepth = item.depth || 0;

      if (itemDepth < depth) {
        // This item belongs to a parent level
        break;
      }

      if (itemDepth === depth) {
        // This item belongs to current level
        const listItemNode: ASTNode = {
          type: 'list_item',
          children: this.parseInline(item.value),
        };

        // Check if next items are nested
        const nestedItems: Token[] = [];
        let j = i + 1;
        
        while (j < items.length && (items[j].depth || 0) > depth) {
          nestedItems.push(items[j]);
          j++;
        }

        if (nestedItems.length > 0) {
          // Recursively parse nested items
          const nestedList = this.buildNestedList(nestedItems, depth + 1, recursionLevel + 1);
          
          if (nestedList.length > 0) {
            const isOrdered = nestedItems[0].metadata?.ordered || false;
            listItemNode.children!.push({
              type: isOrdered ? 'ordered_list' : 'unordered_list',
              children: nestedList,
            });
          }
          
          i = j;
        } else {
          i++;
        }

        result.push(listItemNode);
      } else {
        // This item is nested deeper, skip it (should be handled by parent)
        i++;
      }
    }

    return result;
  }

  /**
   * Parse inline elements (bold, italic, links, etc.)
   * @param text - Text to parse
   * @returns Array of AST nodes
   */
  public parseInline(text: string): ASTNode[] {
    const nodes: ASTNode[] = [];
    let currentPos = 0;

    // Define inline patterns with priority
    const patterns = [
      { regex: /!\[([^\]]*)\]\(([^)]+)\)/g, type: 'image' },      // Images
      { regex: /\[([^\]]+)\]\(([^)]+)\)/g, type: 'link' },        // Links
      { regex: /`([^`]+)`/g, type: 'inline_code' },               // Inline code
      { regex: /\*\*([^*]+)\*\*/g, type: 'bold' },                // Bold **
      { regex: /__([^_]+)__/g, type: 'bold' },                    // Bold __
      { regex: /\*([^*]+)\*/g, type: 'italic' },                  // Italic *
      { regex: /_([^_]+)_/g, type: 'italic' },                    // Italic _
      { regex: /~~([^~]+)~~/g, type: 'strikethrough' },           // Strikethrough
    ];

    // Find all matches with their positions
    interface Match {
      index: number;
      length: number;
      type: string;
      content: string;
      url?: string;
      alt?: string;
    }

    const matches: Match[] = [];

    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match;
      
      while ((match = pattern.regex.exec(text)) !== null) {
        if (pattern.type === 'image') {
          matches.push({
            index: match.index,
            length: match[0].length,
            type: pattern.type,
            content: match[1],
            url: match[2],
            alt: match[1],
          });
        } else if (pattern.type === 'link') {
          matches.push({
            index: match.index,
            length: match[0].length,
            type: pattern.type,
            content: match[1],
            url: match[2],
          });
        } else {
          matches.push({
            index: match.index,
            length: match[0].length,
            type: pattern.type,
            content: match[1],
          });
        }
      }
    }

    // Sort matches by position
    matches.sort((a, b) => a.index - b.index);

    // Remove overlapping matches (keep first one)
    const validMatches: Match[] = [];
    let lastEnd = -1;

    for (const match of matches) {
      if (match.index >= lastEnd) {
        validMatches.push(match);
        lastEnd = match.index + match.length;
      }
    }

    // Build nodes from matches
    for (const match of validMatches) {
      // Add text before match
      if (match.index > currentPos) {
        nodes.push({
          type: 'text',
          content: text.substring(currentPos, match.index),
        });
      }

      // Add matched node
      switch (match.type) {
        case 'image':
          nodes.push({
            type: 'image',
            attributes: {
              src: match.url!,
              alt: match.alt!,
            },
          });
          break;
        
        case 'link':
          nodes.push({
            type: 'link',
            attributes: {
              href: match.url!,
            },
            children: [{ type: 'text', content: match.content }],
          });
          break;
        
        case 'inline_code':
          nodes.push({
            type: 'inline_code',
            content: match.content,
          });
          break;
        
        case 'bold':
          nodes.push({
            type: 'bold',
            children: [{ type: 'text', content: match.content }],
          });
          break;
        
        case 'italic':
          nodes.push({
            type: 'italic',
            children: [{ type: 'text', content: match.content }],
          });
          break;
        
        case 'strikethrough':
          nodes.push({
            type: 'strikethrough',
            children: [{ type: 'text', content: match.content }],
          });
          break;
      }

      currentPos = match.index + match.length;
    }

    // Add remaining text
    if (currentPos < text.length) {
      nodes.push({
        type: 'text',
        content: text.substring(currentPos),
      });
    }

    return nodes.length > 0 ? nodes : [{ type: 'text', content: text }];
  }
}
