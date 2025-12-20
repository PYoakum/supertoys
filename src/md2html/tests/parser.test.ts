import { describe, test, expect } from 'bun:test';
import { Parser } from '../parser';
import { TokenType } from '../types';
import { Token } from "../Token";

describe('Parser', () => {
  const parser = new Parser();

  describe('parseInline', () => {
    test('parses bold text with **', () => {
      const nodes = parser.parseInline('This is **bold** text');
      expect(nodes).toHaveLength(3);
      expect(nodes[0].type).toBe('text');
      expect(nodes[1].type).toBe('bold');
      expect(nodes[2].type).toBe('text');
    });

    test('parses italic text with *', () => {
      const nodes = parser.parseInline('This is *italic* text');
      expect(nodes).toHaveLength(3);
      expect(nodes[1].type).toBe('italic');
    });

    test('parses links', () => {
      const nodes = parser.parseInline('Visit [Google](https://google.com)');
      expect(nodes).toHaveLength(2);
      expect(nodes[1].type).toBe('link');
      expect(nodes[1].attributes?.href).toBe('https://google.com');
    });

    test('parses images', () => {
      const nodes = parser.parseInline('![Alt text](image.png)');
      expect(nodes[0].type).toBe('image');
      expect(nodes[0].attributes?.src).toBe('image.png');
      expect(nodes[0].attributes?.alt).toBe('Alt text');
    });

    test('parses inline code', () => {
      const nodes = parser.parseInline('Use `console.log()` for debugging');
      expect(nodes).toHaveLength(3);
      expect(nodes[1].type).toBe('inline_code');
      expect(nodes[1].content).toBe('console.log()');
    });

    test('parses strikethrough', () => {
      const nodes = parser.parseInline('This is ~~deleted~~ text');
      expect(nodes).toHaveLength(3);
      expect(nodes[1].type).toBe('strikethrough');
    });

    test('parses multiple inline elements', () => {
      const nodes = parser.parseInline('**bold** and *italic* and `code`');
      expect(nodes.length).toBeGreaterThan(3);
    });

    test('handles plain text', () => {
      const nodes = parser.parseInline('Just plain text');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('text');
      expect(nodes[0].content).toBe('Just plain text');
    });
  });

  describe('parse', () => {
    test('parses heading tokens', () => {
      const tokens: Token[] = [
        { type: TokenType.HEADING, value: 'Hello World', depth: 1 }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe('heading');
      expect(ast.children![0].attributes?.level).toBe('1');
    });

    test('parses paragraph tokens', () => {
      const tokens: Token[] = [
        { type: TokenType.PARAGRAPH, value: 'This is a paragraph' }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe('paragraph');
    });

    test('parses code block tokens', () => {
      const tokens: Token[] = [
        { 
          type: TokenType.CODE_BLOCK, 
          value: 'const x = 1;',
          metadata: { language: 'javascript' }
        }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe('code_block');
      expect(ast.children![0].content).toBe('const x = 1;');
    });

    test('parses list items', () => {
      const tokens: Token[] = [
        { type: TokenType.LIST_ITEM, value: 'Item 1', depth: 0, metadata: { ordered: false } },
        { type: TokenType.LIST_ITEM, value: 'Item 2', depth: 0, metadata: { ordered: false } }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe('unordered_list');
      expect(ast.children![0].children).toHaveLength(2);
    });

    test('parses nested lists', () => {
      const tokens: Token[] = [
        { type: TokenType.LIST_ITEM, value: 'Item 1', depth: 0, metadata: { ordered: false } },
        { type: TokenType.LIST_ITEM, value: 'Item 1.1', depth: 1, metadata: { ordered: false } },
        { type: TokenType.LIST_ITEM, value: 'Item 2', depth: 0, metadata: { ordered: false } }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe('unordered_list');
      expect(ast.children![0].children).toHaveLength(2);
      // First item should have nested list
      expect(ast.children![0].children![0].children).toHaveLength(2);
    });

    test('parses horizontal rule', () => {
      const tokens: Token[] = [
        { type: TokenType.HR, value: '' }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(1);
      expect(ast.children![0].type).toBe('hr');
    });

    test('parses mixed content', () => {
      const tokens: Token[] = [
        { type: TokenType.HEADING, value: 'Title', depth: 1 },
        { type: TokenType.PARAGRAPH, value: 'Some text' },
        { type: TokenType.HR, value: '' }
      ];
      const ast = parser.parse(tokens);
      expect(ast.children).toHaveLength(3);
    });
  });
});
