#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

interface HTMLToken {
  tag: string;
  classes: string;
  id: string;
  attributes: string;
  content: string;
}

function parseHTML(html: string): HTMLToken[] {
  const tokens: HTMLToken[] = [];
  
  // Match all opening tags (both self-closing and regular)
  const tagRegex = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1];
    const attributesStr = match[2];
    const startPos = match.index;
    const openTagEnd = match.index + match[0].length;
    
    // Check if it's a self-closing tag
    const isSelfClosing = attributesStr.trim().endsWith("/");
    
    // Skip closing tags
    if (tagName.startsWith("/")) {
      continue;
    }
    
    let content = "";
    
    // If not self-closing, try to find content until closing tag
    if (!isSelfClosing) {
      const closingTagRegex = new RegExp(`</${tagName}>`, "i");
      const closingMatch = closingTagRegex.exec(html.slice(openTagEnd));
      
      if (closingMatch) {
        const rawContent = html.slice(openTagEnd, openTagEnd + closingMatch.index);
        // Remove nested tags and normalize whitespace
        content = rawContent
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    
    // Parse attributes
    const classes: string[] = [];
    let id = "";
    const otherAttributes: string[] = [];
    
    // Extract class attribute
    const classMatch = /class=["']([^"']*)["']/i.exec(attributesStr);
    if (classMatch) {
      classes.push(...classMatch[1].split(/\s+/).filter(c => c));
    }
    
    // Extract id attribute
    const idMatch = /id=["']([^"']*)["']/i.exec(attributesStr);
    if (idMatch) {
      id = idMatch[1];
    }
    
    // Extract other attributes
    const attrRegex = /([a-zA-Z][a-zA-Z0-9-]*)=["']([^"']*)["']/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[2];
      
      if (attrName !== "class" && attrName !== "id") {
        otherAttributes.push(`${attrName}="${attrValue}"`);
      }
    }
    
    // Also handle attributes without quotes
    const attrNoQuoteRegex = /([a-zA-Z][a-zA-Z0-9-]*)=([^\s"'>]+)/g;
    let attrNoQuoteMatch;
    while ((attrNoQuoteMatch = attrNoQuoteRegex.exec(attributesStr)) !== null) {
      const attrName = attrNoQuoteMatch[1].toLowerCase();
      const attrValue = attrNoQuoteMatch[2];
      
      if (attrName !== "class" && attrName !== "id" && !attrValue.includes('"')) {
        otherAttributes.push(`${attrName}="${attrValue}"`);
      }
    }
    
    tokens.push({
      tag: tagName,
      classes: classes.join(" "),
      id: id,
      attributes: otherAttributes.join("; "),
      content: content
    });
  }
  
  return tokens;
}

function escapeCSV(value: string): string {
  // Escape double quotes and wrap in quotes if contains comma, newline, or quote
  if (value.includes('"') || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function tokensToCSV(tokens: HTMLToken[]): string {
  const headers = ["Tag", "Classes", "ID", "Attributes", "Content"];
  const rows = [headers.join(",")];
  
  for (const token of tokens) {
    const row = [
      escapeCSV(token.tag),
      escapeCSV(token.classes),
      escapeCSV(token.id),
      escapeCSV(token.attributes),
      escapeCSV(token.content)
    ];
    rows.push(row.join(","));
  }
  
  return rows.join("\n");
}

function main() {
  // Support both Bun and Node.js
  const args = typeof Bun !== "undefined" ? Bun.argv.slice(2) : process.argv.slice(2);
  
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

  if (values.help || positionals.length === 0) {
    console.log(`
HTML to CSV Converter

Usage: bun html2csv.ts <input.html> [options]

Options:
  -o, --output <file>  Output CSV file (default: output.csv)
  -h, --help           Show this help message

Example:
  bun html2csv.ts index.html -o result.csv
    `);
    process.exit(values.help ? 0 : 1);
  }

  const inputFile = positionals[0];
  const outputFile = values.output || "output.csv";

  try {
    // Read HTML file
    const htmlContent = readFileSync(resolve(inputFile), "utf-8");
    
    // Parse HTML
    console.log("Parsing HTML...");
    const tokens = parseHTML(htmlContent);
    console.log(`Found ${tokens.length} elements`);
    
    // Convert to CSV
    console.log("Converting to CSV...");
    const csv = tokensToCSV(tokens);
    
    // Write CSV file
    writeFileSync(resolve(outputFile), csv, "utf-8");
    console.log(`✓ CSV written to ${outputFile}`);
    
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main(); 