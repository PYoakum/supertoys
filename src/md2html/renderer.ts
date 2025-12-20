import { type ConversionOptions } from './types';
import { type ASTNode } from "./ASTNode";
import { escapeHtml, isSafeUrl, sanitizeHtml, generateSlug } from './sanitizer';

/**
 * Renderer class for converting AST to HTML
 */
export class Renderer {
  private options: Required<ConversionOptions>;

  constructor(options: ConversionOptions = {}) {
    this.options = {
      sanitize: options.sanitize ?? true,
      allowRawHtml: options.allowRawHtml ?? false,
      breaks: options.breaks ?? false,
      headerIds: options.headerIds ?? false,
      highlightCode: options.highlightCode ?? false,
    };
  }

  /**
   * Render an AST to HTML
   * @param ast - The AST to render
   * @returns HTML string
   */
  public render(ast: ASTNode): string {
    let html = this.renderNode(ast);

    // Sanitize the output if enabled
    if (this.options.sanitize) {
      html = sanitizeHtml(html);
    }

    return html;
  }

  /**
   * Render a single AST node
   * @param node - The node to render
   * @returns HTML string
   */
  private renderNode(node: ASTNode): string {
    switch (node.type) {
      case 'root':
        return this.renderChildren(node);
      
      case 'heading':
        return this.renderHeading(node);
      
      case 'paragraph':
        return this.renderParagraph(node);
      
      case 'code_block':
        return this.renderCodeBlock(node);
      
      case 'blockquote':
        return this.renderBlockquote(node);
      
      case 'ordered_list':
        return this.renderOrderedList(node);
      
      case 'unordered_list':
        return this.renderUnorderedList(node);
      
      case 'list_item':
        return this.renderListItem(node);
      
      case 'hr':
        return '<hr>';
      
      case 'bold':
        return this.renderBold(node);
      
      case 'italic':
        return this.renderItalic(node);
      
      case 'strikethrough':
        return this.renderStrikethrough(node);
      
      case 'link':
        return this.renderLink(node);
      
      case 'image':
        return this.renderImage(node);
      
      case 'inline_code':
        return this.renderInlineCode(node);
      
      case 'text':
        return this.renderText(node);
      
      default:
        return '';
    }
  }

  /**
   * Render child nodes
   */
  private renderChildren(node: ASTNode): string {
    if (!node.children || node.children.length === 0) {
      return '';
    }
    return node.children.map(child => this.renderNode(child)).join('');
  }

  /**
   * Render a heading
   */
  private renderHeading(node: ASTNode): string {
    const level = node.attributes?.level || '1';
    const content = this.renderChildren(node);
    
    if (this.options.headerIds && node.content) {
      const id = generateSlug(node.content);
      return `<h${level} id="${escapeHtml(id)}">${content}</h${level}>`;
    }
    
    return `<h${level}>${content}</h${level}>`;
  }

  /**
   * Render a paragraph
   */
  private renderParagraph(node: ASTNode): string {
    let content = this.renderChildren(node);
    
    if (this.options.breaks) {
      // Convert newlines to <br> tags
      content = content.replace(/\n/g, '<br>');
    }
    
    return `<p>${content}</p>`;
  }

  /**
   * Render a code block
   */
  private renderCodeBlock(node: ASTNode): string {
    const code = escapeHtml(node.content || '');
    const language = node.attributes?.language || '';
    
    if (this.options.highlightCode && language) {
      return `<pre><code class="language-${escapeHtml(language)}">${code}</code></pre>`;
    }
    
    return `<pre><code>${code}</code></pre>`;
  }

  /**
   * Render a blockquote
   */
  private renderBlockquote(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<blockquote>${content}</blockquote>`;
  }

  /**
   * Render an ordered list
   */
  private renderOrderedList(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<ol>${content}</ol>`;
  }

  /**
   * Render an unordered list
   */
  private renderUnorderedList(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<ul>${content}</ul>`;
  }

  /**
   * Render a list item
   */
  private renderListItem(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<li>${content}</li>`;
  }

  /**
   * Render bold text
   */
  private renderBold(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<strong>${content}</strong>`;
  }

  /**
   * Render italic text
   */
  private renderItalic(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<em>${content}</em>`;
  }

  /**
   * Render strikethrough text
   */
  private renderStrikethrough(node: ASTNode): string {
    const content = this.renderChildren(node);
    return `<del>${content}</del>`;
  }

  /**
   * Render a link
   */
  private renderLink(node: ASTNode): string {
    const href = node.attributes?.href || '';
    const content = this.renderChildren(node);
    
    // Validate URL for security
    if (!isSafeUrl(href)) {
      return content;
    }
    
    return `<a href="${escapeHtml(href)}">${content}</a>`;
  }

  /**
   * Render an image
   */
  private renderImage(node: ASTNode): string {
    const src = node.attributes?.src || '';
    const alt = node.attributes?.alt || '';
    
    // Validate URL for security
    if (!isSafeUrl(src)) {
      return '';
    }
    
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  }

  /**
   * Render inline code
   */
  private renderInlineCode(node: ASTNode): string {
    const code = escapeHtml(node.content || '');
    return `<code>${code}</code>`;
  }

  /**
   * Render plain text
   */
  private renderText(node: ASTNode): string {
    return escapeHtml(node.content || '');
  }
}
