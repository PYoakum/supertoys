import { describe, test, expect } from 'bun:test';
import  markdownToHtml  from '../index'

describe('Integration Tests', () => {
  describe('basic markdown conversion', () => {
    test('converts simple heading', () => {
      const markdown = '# Hello World';
      const html = markdownToHtml(markdown);
      expect(html).toBe('<h1>Hello World</h1>');
    });

    test('converts multiple headings', () => {
      const markdown = '# H1\n## H2\n### H3';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<h1>H1</h1>');
      expect(html).toContain('<h2>H2</h2>');
      expect(html).toContain('<h3>H3</h3>');
    });

    test('converts paragraph', () => {
      const markdown = 'This is a paragraph.';
      const html = markdownToHtml(markdown);
      expect(html).toBe('<p>This is a paragraph.</p>');
    });

    test('converts bold text', () => {
      const markdown = 'This is **bold** text.';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<strong>bold</strong>');
    });

    test('converts italic text', () => {
      const markdown = 'This is *italic* text.';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<em>italic</em>');
    });

    test('converts strikethrough text', () => {
      const markdown = 'This is ~~deleted~~ text.';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<del>deleted</del>');
    });

    test('converts inline code', () => {
      const markdown = 'Use `console.log()` for debugging.';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<code>console.log()</code>');
    });

    test('converts links', () => {
      const markdown = 'Visit [Google](https://google.com).';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<a href="https://google.com">Google</a>');
    });

    test('converts images', () => {
      const markdown = '![Alt text](image.png)';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<img src="image.png" alt="Alt text">');
    });

    test('converts unordered list', () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<ul>');
      expect(html).toContain('<li>Item 1</li>');
      expect(html).toContain('<li>Item 2</li>');
      expect(html).toContain('<li>Item 3</li>');
      expect(html).toContain('</ul>');
    });

    test('converts ordered list', () => {
      const markdown = '1. First\n2. Second\n3. Third';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<ol>');
      expect(html).toContain('<li>First</li>');
      expect(html).toContain('<li>Second</li>');
      expect(html).toContain('<li>Third</li>');
      expect(html).toContain('</ol>');
    });

    test('converts code block', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<pre><code>');
      expect(html).toContain('const x = 1;');
      expect(html).toContain('</code></pre>');
    });

    test('converts blockquote', () => {
      const markdown = '> This is a quote';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<blockquote>');
      expect(html).toContain('This is a quote');
      expect(html).toContain('</blockquote>');
    });

    test('converts horizontal rule', () => {
      const markdown = '---';
      const html = markdownToHtml(markdown);
      expect(html).toBe('<hr>');
    });
  });

  describe('complex markdown', () => {
    test('converts nested lists', () => {
      const markdown = '- Item 1\n  - Nested 1\n  - Nested 2\n- Item 2';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<ul>');
      expect(html).toContain('Nested 1');
      expect(html).toContain('Nested 2');
    });

    test('converts mixed inline formatting', () => {
      const markdown = 'This is **bold**, *italic*, and `code`.';
      const html = markdownToHtml(markdown);
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
      expect(html).toContain('<code>code</code>');
    });

    test('converts complete document', () => {
      const markdown = `# Title

This is a paragraph with **bold** and *italic* text.

## Subsection

- List item 1
- List item 2

\`\`\`javascript
const x = 1;
\`\`\`

> A quote

[Link](https://example.com)`;

      const html = markdownToHtml(markdown);
      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('<h2>Subsection</h2>');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('<em>italic</em>');
      expect(html).toContain('<ul>');
      expect(html).toContain('<pre><code>');
      expect(html).toContain('<blockquote>');
      expect(html).toContain('<a href="https://example.com">Link</a>');
    });
  });

  describe('options', () => {
    test('adds header IDs', () => {
      const markdown = '# Hello World';
      const html = markdownToHtml(markdown, { headerIds: true });
      expect(html).toContain('id="hello-world"');
    });

    test('adds syntax highlighting classes', () => {
      const markdown = '```javascript\nconst x = 1;\n```';
      const html = markdownToHtml(markdown, { highlightCode: true });
      expect(html).toContain('class="language-javascript"');
    });

    test('sanitizes output by default', () => {
      const markdown = '<script>alert("XSS")</script>';
      const html = markdownToHtml(markdown);
      expect(html).not.toContain('<script>');
    });
  });

  describe('edge cases', () => {
    test('handles empty string', () => {
      const html = markdownToHtml('');
      expect(html).toBe('');
    });

    test('handles string with only whitespace', () => {
      const html = markdownToHtml('   \n\n   ');
      expect(html).toBe('');
    });

    test('handles special characters in text', () => {
      const markdown = 'Text with <, >, &, ", and \' characters.';
      const html = markdownToHtml(markdown);
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
      expect(html).toContain('&amp;');
    });

    test('handles malformed markdown gracefully', () => {
      const markdown = '**unclosed bold\n*unclosed italic';
      const html = markdownToHtml(markdown);
      // Should not throw, should produce some output
      expect(html).toBeTruthy();
    });
  });

  describe('security', () => {
    test('blocks javascript: URLs in links', () => {
      const markdown = '[Click](javascript:alert("XSS"))';
      const html = markdownToHtml(markdown);
      expect(html).not.toContain('href="javascript:');
    });

    test('blocks javascript: URLs in images', () => {
      const markdown = '![Alt](javascript:alert("XSS"))';
      const html = markdownToHtml(markdown);
      expect(html).not.toContain('src="javascript:');
    });

    test('allows safe URL protocols', () => {
      const markdown = '[HTTP](http://example.com) [HTTPS](https://example.com) [Mailto](mailto:test@example.com)';
      const html = markdownToHtml(markdown);
      expect(html).toContain('href="http://example.com"');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('href="mailto:test@example.com"');
    });

    test('allows relative URLs', () => {
      const markdown = '[Relative](./page.html) [Root](/page.html)';
      const html = markdownToHtml(markdown);
      expect(html).toContain('href="./page.html"');
      expect(html).toContain('href="/page.html"');
    });
  });
});
