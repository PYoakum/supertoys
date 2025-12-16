/**
 * Markdown Block Generator
 * Converts markdown content to HTML
 */

import { generateId } from "../utils/template.js";
import  markdownToHtml  from "../../../md2html/index.js"

/**
 * Generate HTML from markdown block configuration
 * @param {Object} block - Block configuration
 * @param {string} block.content - Markdown content
 * @param {string} [block.id] - Optional element ID
 * @param {string} [block.class] - Additional CSS classes
 * @returns {string} HTML string
 * 
 * @example
 * {
 *   type: "markdown",
 *   content: "# Hello World\n\nThis is **bold** text.",
 *   class: "intro-section"
 * }
 */
export function generateMarkdown(block) {
  const { content, id, class: className } = block;

  if (!content) {
    throw new Error("Markdown block requires 'content' property");
  }

  const blockId = id || generateId("md");
  const classes = ["block", "markdown-block", className].filter(Boolean).join(" ");

  // Convert markdown to HTML

  const html = markdownToHtml(content)
  //const html = marked.parse(content);

  return `<section id="${blockId}" class="${classes}">
${html}
</section>`;
}

/**
 * Generate inline markdown (no wrapping element)
 * @param {string} content - Markdown content
 * @returns {string} HTML string
 */
export function parseMarkdownInline(content) {
  return markdownToHtml(content);
}

/**
 * Available markdown features:
 * - Headers (# to ######)
 * - Bold (**text**)
 * - Italic (*text* or _text_)
 * - Strikethrough (~~text~~)
 * - Links ([text](url))
 * - Images (![alt](url))
 * - Code (`inline` and ```fenced```)
 * - Blockquotes (> text)
 * - Lists (ordered and unordered)
 * - Tables (GFM)
 * - Horizontal rules (---)
 */
