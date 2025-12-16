import { describe, test, expect } from 'bun:test';
import { Renderer } from '../renderer';
import { ASTNode } from '../types';

describe('Renderer', () => {
  describe('basic rendering', () => {
    test('renders heading', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'heading',
          attributes: { level: '1' },
          children: [{ type: 'text', content: 'Hello World' }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<h1>Hello World</h1>');
    });

    test('renders paragraph', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', content: 'This is a paragraph' }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p>This is a paragraph</p>');
    });

    test('renders bold text', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'bold',
            children: [{ type: 'text', content: 'bold' }]
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p><strong>bold</strong></p>');
    });

    test('renders italic text', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'italic',
            children: [{ type: 'text', content: 'italic' }]
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p><em>italic</em></p>');
    });

    test('renders strikethrough text', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'strikethrough',
            children: [{ type: 'text', content: 'deleted' }]
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p><del>deleted</del></p>');
    });

    test('renders link', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'link',
            attributes: { href: 'https://example.com' },
            children: [{ type: 'text', content: 'Click here' }]
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p><a href="https://example.com">Click here</a></p>');
    });

    test('renders image', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'image',
            attributes: { src: 'image.png', alt: 'Alt text' }
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p><img src="image.png" alt="Alt text"></p>');
    });

    test('renders inline code', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'inline_code',
            content: 'console.log()'
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<p><code>console.log()</code></p>');
    });

    test('renders code block', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'code_block',
          content: 'const x = 1;',
          attributes: { language: '' }
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<pre><code>const x = 1;</code></pre>');
    });

    test('renders unordered list', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'unordered_list',
          children: [
            { type: 'list_item', children: [{ type: 'text', content: 'Item 1' }] },
            { type: 'list_item', children: [{ type: 'text', content: 'Item 2' }] }
          ]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>');
    });

    test('renders ordered list', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'ordered_list',
          children: [
            { type: 'list_item', children: [{ type: 'text', content: 'First' }] },
            { type: 'list_item', children: [{ type: 'text', content: 'Second' }] }
          ]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<ol><li>First</li><li>Second</li></ol>');
    });

    test('renders blockquote', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'blockquote',
          children: [{
            type: 'paragraph',
            children: [{ type: 'text', content: 'Quote text' }]
          }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<blockquote><p>Quote text</p></blockquote>');
    });

    test('renders horizontal rule', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{ type: 'hr' }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<hr>');
    });
  });

  describe('options', () => {
    test('adds header IDs when enabled', () => {
      const renderer = new Renderer({ headerIds: true });
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'heading',
          content: 'Hello World',
          attributes: { level: '1' },
          children: [{ type: 'text', content: 'Hello World' }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<h1 id="hello-world">Hello World</h1>');
    });

    test('adds syntax highlighting classes', () => {
      const renderer = new Renderer({ highlightCode: true });
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'code_block',
          content: 'const x = 1;',
          attributes: { language: 'javascript' }
        }]
      };
      const html = renderer.render(ast);
      expect(html).toBe('<pre><code class="language-javascript">const x = 1;</code></pre>');
    });

    test('escapes HTML characters', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{ type: 'text', content: '<script>alert("XSS")</script>' }]
        }]
      };
      const html = renderer.render(ast);
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    });

    test('validates URLs in links', () => {
      const renderer = new Renderer();
      const ast: ASTNode = {
        type: 'root',
        children: [{
          type: 'paragraph',
          children: [{
            type: 'link',
            attributes: { href: 'javascript:alert("XSS")' },
            children: [{ type: 'text', content: 'Click' }]
          }]
        }]
      };
      const html = renderer.render(ast);
      // Should not render the link with javascript: protocol
      expect(html).not.toContain('href="javascript:');
    });
  });
});
