#!/usr/bin/env node

const { parseArgs } = require("util");
const { existsSync, readFileSync, writeFileSync } = require("fs");
const { basename, extname, join } = require("path");

// Simple HTML to Markdown converter
function htmlToMarkdown(html) {
  let markdown = html;

  // Remove DOCTYPE and html/head/body tags
  markdown = markdown.replace(/<!DOCTYPE[^>]*>/gi, "");
  markdown = markdown.replace(/<html[^>]*>/gi, "");
  markdown = markdown.replace(/<\/html>/gi, "");
  markdown = markdown.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
  markdown = markdown.replace(/<body[^>]*>/gi, "");
  markdown = markdown.replace(/<\/body>/gi, "");

  // Headers (h1-h6)
  for (let i = 6; i >= 1; i--) {
    const regex = new RegExp(`<h${i}[^>]*>(.*?)<\/h${i}>`, "gi");
    markdown = markdown.replace(regex, (_, content) => {
      return "#".repeat(i) + " " + content.trim() + "\n\n";
    });
  }

  // Bold
  markdown = markdown.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, "**$2**");

  // Italic
  markdown = markdown.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, "*$2*");

  // Links
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // Images
  markdown = markdown.replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, "![$2]($1)");
  markdown = markdown.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*\/?>/gi, "![$1]($2)");
  markdown = markdown.replace(/<img[^>]*src=["']([^"']*)["'][^>]*\/?>/gi, "![]($1)");

  // Code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    return "```\n" + code.trim() + "\n```\n\n";
  });

  // Inline code
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");

  // Blockquotes
  markdown = markdown.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return content.trim().split("\n").map((line) => "> " + line.trim()).join("\n") + "\n\n";
  });

  // Unordered lists
  markdown = markdown.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return content.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n") + "\n";
  });

  // Ordered lists
  markdown = markdown.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let counter = 1;
    return content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => {
      return `${counter++}. $1\n`;
    }) + "\n";
  });

  // Horizontal rules
  markdown = markdown.replace(/<hr[^>]*\/?>/gi, "\n---\n\n");

  // Paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");

  // Line breaks
  markdown = markdown.replace(/<br[^>]*\/?>/gi, "\n");

  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, " ");
  markdown = markdown.replace(/&lt;/g, "<");
  markdown = markdown.replace(/&gt;/g, ">");
  markdown = markdown.replace(/&amp;/g, "&");
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&#39;/g, "'");

  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  
  // Remove leading whitespace from lines while preserving code block indentation
  const lines = markdown.split('\n');
  const cleanedLines = lines.map(line => {
    // Don't trim lines that are inside code blocks (already processed)
    if (line.trim().startsWith('```')) return line.trim();
    // For other lines, trim leading spaces but keep the content
    return line.trimStart();
  });
  markdown = cleanedLines.join('\n');
  
  markdown = markdown.trim();

  return markdown;
}

// Simple Markdown to HTML converter
function markdownToHtml(markdown) {
  let html = markdown;

  // Escape HTML special characters first (but not in code blocks)
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (match) => {
    codeBlocks.push(match);
    return `<<<CODEBLOCK_${codeBlocks.length - 1}>>>`;
  });

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr>");
  html = html.replace(/^\*\*\*$/gm, "<hr>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Images (must come before links)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // Unordered lists - mark them first
  const listLines = html.split('\n');
  let inUL = false;
  let inOL = false;
  let processedLines = [];
  
  for (let i = 0; i < listLines.length; i++) {
    const line = listLines[i];
    const isULItem = /^[\-\*]\s+(.+)$/.test(line);
    const isOLItem = /^\d+\.\s+(.+)$/.test(line);
    
    if (isULItem) {
      if (inOL) {
        processedLines.push('</ol>');
        inOL = false;
      }
      if (!inUL) {
        processedLines.push('<ul>');
        inUL = true;
      }
      processedLines.push(line.replace(/^[\-\*]\s+(.+)$/, '<li>$1</li>'));
    } else if (isOLItem) {
      if (inUL) {
        processedLines.push('</ul>');
        inUL = false;
      }
      if (!inOL) {
        processedLines.push('<ol>');
        inOL = true;
      }
      processedLines.push(line.replace(/^\d+\.\s+(.+)$/, '<li>$1</li>'));
    } else {
      if (inUL) {
        processedLines.push('</ul>');
        inUL = false;
      }
      if (inOL) {
        processedLines.push('</ol>');
        inOL = false;
      }
      processedLines.push(line);
    }
  }
  
  if (inUL) processedLines.push('</ul>');
  if (inOL) processedLines.push('</ol>');
  
  html = processedLines.join('\n');

  // Paragraphs (wrap text that isn't already in a tag)
  const lines = html.split("\n");
  const wrappedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    // Don't wrap code block placeholders
    if (trimmed.match(/^<<<CODEBLOCK_\d+>>>$/)) return line;
    if (trimmed.match(/^<(h[1-6]|ul|ol|li|blockquote|pre|hr|code)/)) return line;
    if (trimmed.match(/<\/(h[1-6]|ul|ol|li|blockquote|pre|code)>$/)) return line;
    if (line.startsWith("<") && line.endsWith(">")) return line;
    return "<p>" + line + "</p>";
  });
  html = wrappedLines.join("\n");

  // Restore code blocks and wrap them (after paragraph wrapping to prevent conflicts)
  html = html.replace(/<<<CODEBLOCK_(\d+)>>>/g, (_, index) => {
    const codeBlock = codeBlocks[parseInt(index)];
    const code = codeBlock.replace(/```\n?/g, "").trim();
    return `<pre><code>${code}</code></pre>`;
  });

  // Wrap in basic HTML structure
  html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Converted Document</title>
</head>
<body>
${html}
</body>
</html>`;

  return html;
}

function showHelp() {
  console.log(`
HTML/Markdown Converter CLI

Usage:
  node converter.js <input-file> [options]
  bun converter.js <input-file> [options]

Options:
  -o, --output <file>    Output file path (default: auto-generated)
  -h, --help             Show this help message

Examples:
  node converter.js document.html
  bun converter.js document.md -o output.html
  node converter.js input.html --output result.md

The conversion direction is automatically detected from the input file extension.
  `);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    showHelp();
    process.exit(0);
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      output: {
        type: "string",
        short: "o",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    allowPositionals: true,
  });

  if (positionals.length === 0) {
    console.error("Error: No input file specified");
    showHelp();
    process.exit(1);
  }

  const inputFile = positionals[0];

  if (!existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' does not exist`);
    process.exit(1);
  }

  const inputExt = extname(inputFile).toLowerCase();
  const inputContent = readFileSync(inputFile, "utf-8");

  let outputContent;
  let defaultOutputExt;

  if (inputExt === ".html" || inputExt === ".htm") {
    console.log("Converting HTML to Markdown...");
    outputContent = htmlToMarkdown(inputContent);
    defaultOutputExt = ".md";
  } else if (inputExt === ".md" || inputExt === ".markdown") {
    console.log("Converting Markdown to HTML...");
    outputContent = markdownToHtml(inputContent);
    defaultOutputExt = ".html";
  } else {
    console.error(`Error: Unsupported file extension '${inputExt}'`);
    console.error("Supported extensions: .html, .htm, .md, .markdown");
    process.exit(1);
  }

  const outputFile =
    values.output ||
    join(
      process.cwd(),
      basename(inputFile, inputExt) + defaultOutputExt
    );

  writeFileSync(outputFile, outputContent, "utf-8");
  console.log(`✓ Conversion complete: ${outputFile}`);
}

main();