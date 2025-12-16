#!/usr/bin/env bun

import { parseArgs } from "util";
import { existsSync } from "fs";
import { parseHTML } from 'linkedom';


const path = './style.css';
const file = Bun.file(path);

const css = await file.text();


// YAML parsing and stringifying
const YAML = {
  parse: (text: string) => {
    // Simple YAML parser for basic structures
    const lines = text.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    const result: any = {};
    let currentKey = '';
    let currentArray: any[] = [];
    let inArray = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Array item
      if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2).trim();
        currentArray.push(parseValue(value));
        inArray = true;
      }
      // Key-value pair
      else if (trimmed.includes(':')) {
        if (inArray && currentKey) {
          result[currentKey] = currentArray;
          currentArray = [];
          inArray = false;
        }
        
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        
        if (value) {
          result[key] = parseValue(value);
        } else {
          currentKey = key;
          currentArray = [];
        }
      }
    }
    
    if (inArray && currentKey) {
      result[currentKey] = currentArray;
    }
    
    return result;
  },
  
  stringify: (obj: any, indent = 0): string => {
    const spaces = '  '.repeat(indent);
    let yaml = '';
    
    for (const [key, value] of Object.entries(obj)) {

      console.log(`key 🔑 ${key} value 🪙 ${value}`)

      if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n`;
        for (const item of value) {

          if (typeof item === 'object' && item !== null) {
            yaml += `${spaces}- \n${YAML.stringify(item, indent + 1)}`;
          } else {
            yaml += `${spaces}- ${stringifyValue(item)}\n`;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        yaml += `${spaces}${key}:\n${YAML.stringify(value, indent + 1)}`;
      } else {
        yaml += `${spaces}${key}: ${stringifyValue(value)}\n`;
      }
    }
    
    return yaml;
  }
};

function parseValue(value: string): any {
  // Try to parse as number
  if (/^-?\d+\.?\d*$/.test(value)) {
    return parseFloat(value);
  }
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;
  // String (remove quotes if present)
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function stringifyValue(value: any): string {
  if (typeof value === 'string' && (value.includes(':') || value.includes('\n'))) {
    return `"${value}"`;
  }
  return String(value);
}


function yamlToHtml(cssData: any, yamlData: any): string {
const compiledHtml = `
<!doctype html>\r
<html lang="en-US">\r
\t<head>\r
\t\t<meta charset="utf-8" />\r
\t\t<meta name="viewport" content="width=device-width, initial-scale=1" />\r
\t\t<meta name="description" content="Showcase of common UI content elements" />\r
\t\t<title>𝒀𝑨𝑴𝑳 ⟺ 𝑯𝑻𝑴𝑳</title>\r
\t</head>\r
\t<body>\r
\t\t<div class="app theme-mac" data-cmp="app-root">\r
\t\t\t<header role="banner">\r
\t\t\t\t<div class="c-header">\r
\t\t\t\t\t<div class="c-header__bar c-window" role="navigation" aria-label="Primary">\r
\t\t\t\t\t\t<strong class="c-header__brand">𝒀𝑨𝑴𝑳 ⟺ 𝑯𝑻𝑴𝑳</strong>\r
\t\t\t\t\t</div>\r
\t\t\t\t</div>\r
\t\t\t</header>\r
\t\t\t<section aria-label="generated table" id="yaml-content">\r
\t\t\t\t<div class="c-window c-window__content" id="table-content">\r
${objectToHtml(yamlData, 5)}
\t\t\t\t</div>\r
\t\t\t</section>\r
\t\t</div>\r
\t\t<style>\r
\t\t\t${cssData}\r
\t\t</style>\r
\t</body>\r
</html>`;
return compiledHtml
}

function extractElementContent(htmlString, elementId) {
  const { document } = parseHTML(htmlString);
  const element = document.getElementById(elementId);
  
  return element ? element.innerHTML : null;
}

function parseSelector(selector:string) {
  if (selector.startsWith('#')) {
    return { type: 'id', value: selector.slice(1) };
  } else if (selector.startsWith('.')) {
    return { type: 'class', value: selector.slice(1) };
  } else {
    return { type: 'tag', value: selector };
  }
}

function extractContent(html:string, tagName:string, startPos:string) {
  let depth = 1;
  let i = startPos;
  
  while (i < html.length && depth > 0) {
    // Check for opening tag
    if (html[i] === '<') {
      const restOfHtml = html.slice(i);
      
      // Check for closing tag
      const closeMatch = restOfHtml.match(new RegExp(`^<\\s*\\/\\s*${tagName}\\s*>`, 'i'));
      if (closeMatch) {
        depth--;
        if (depth === 0) {
          return html.substring(startPos, i);
        }
        i += closeMatch[0].length;
        continue;
      }
      
      // Check for self-closing tag
      const selfCloseMatch = restOfHtml.match(new RegExp(`^<\\s*${tagName}\\s+[^>]*?\\/\\s*>`, 'i'));
      if (selfCloseMatch) {
        i += selfCloseMatch[0].length;
        continue;
      }
      
      // Check for opening tag
      const openMatch = restOfHtml.match(new RegExp(`^<\\s*${tagName}(?:\\s+[^>]*)?>`, 'i'));
      if (openMatch) {
        depth++;
        i += openMatch[0].length;
        continue;
      }
    }
    i++;
  }
  
  return null;
}


function objectToHtml(obj: any, indentLevel: number = 0): string {
  const indent = '\t'.repeat(indentLevel);
  let html = '';
  
  for (const [key, value] of Object.entries(obj)) {
    html += `${indent}<div class="item">\r`;
    html += `${indent}\t<span class="key">${escapeHtml(key)}:</span>\r`;
    
    if (Array.isArray(value)) {
      html += `${indent}\t\t<ul>\r`;
      for (const item of value) {
        html += `${indent}\t\t\t\t<li>`;
        if (typeof item === 'object' && item !== null) {
          html += '\n' + objectToHtml(item, indentLevel + 3) + `${indent}    `;
        } else {
          html += `<span class="value">${escapeHtml(String(item))}</span>`;
        }
        html += `</li>\r`;
      }
      html += `${indent}\t\t</ul>\r`;
    } else if (typeof value === 'object' && value !== null) {
      html += `${indent}\t\t<div class="nested">\n`;
      html += objectToHtml(value, indentLevel + 2);
      html += `${indent}\t\t</div>\r`;
    } else {
      html += `${indent}\t<span class="value">${escapeHtml(String(value))}</span>\r`;
    }
    
    html += `${indent}</div>\r`;
  }
  
  html = html.replace(/^[\\s]*[\\r\\n]/gm, '');
  
  return html;
}

function htmlToYaml(html: string): any {
  // Simple HTML to data structure converter
  // Extracts text content and basic structure
  const result: any = {};

  // Remove script and style tags
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove empty lines
  html = html.replace(/^[\\s]*[\\r\\n]/gm, '');

  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }
  
  // Extract headings and paragraphs
  const headings = html.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi);
  if (headings) {
    result.headings = headings.map(h => h.replace(/<[^>]+>/g, '').trim());
  }
  
  // Extract list items
  const listItems = html.match(/<li[^>]*>([^<]+)<\/li>/gi);
  if (listItems) {
    result.list_items = listItems.map(li => li.replace(/<[^>]+>/g, '').trim());
  }
  
  // Extract paragraphs
  const paragraphs = html.match(/<p[^>]*>([^<]+)<\/p>/gi);
  if (paragraphs) {
    result.paragraphs = paragraphs.map(p => p.replace(/<[^>]+>/g, '').trim());
  }
  
  // Extract links
  const links = html.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi);
  if (links) {
    result.links = links.map(link => {
      const hrefMatch = link.match(/href="([^"]+)"/);
      const textMatch = link.match(/>([^<]+)</);
      return {
        url: hrefMatch ? hrefMatch[1] : '',
        text: textMatch ? textMatch[1].trim() : ''
      };
    });
  }
  
  return result;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// CLI logic
async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
      'to-html': { type: 'boolean' },
      'to-yaml': { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (values.help || (!values.input && positionals.length === 0)) {
    console.log(`
YAML ↔ HTML Converter for Bun

Usage:
  y2h [options]

Options:
  -i, --input <file>      Input file path
  -o, --output <file>     Output file path (defaults to stdout)
  --to-html               Convert YAML to HTML (auto-detected if not specified)
  --to-yaml               Convert HTML to YAML (auto-detected if not specified)
  -h, --help              Show this help message

Examples:
  # Convert YAML to HTML
  yaml-html-converter -i data.yaml -o output.html
  yaml-html-converter -i data.yaml --to-html
  
  # Convert HTML to YAML
  yaml-html-converter -i page.html -o data.yaml
  yaml-html-converter -i page.html --to-yaml
  
  # Output to stdout
  yaml-html-converter -i data.yaml
`);
    process.exit(0);
  }

  const inputFile = values.input || positionals[0];
  
  if (!inputFile) {
    console.error('Error: Input file is required');
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Error: Input file "${inputFile}" not found`);
    process.exit(1);
  }

  // Read input file
  const inputContent = await Bun.file(inputFile).text();
  
  // Determine conversion direction
  let toHtml = values['to-html'];
  let toYaml = values['to-yaml'];
  
  if (!toHtml && !toYaml) {
    // Auto-detect based on file extension
    if (inputFile.endsWith('.yaml') || inputFile.endsWith('.yml')) {
      toHtml = true;
    } else if (inputFile.endsWith('.html') || inputFile.endsWith('.htm')) {
      toYaml = true;
    } else {
      console.error('Error: Cannot auto-detect conversion direction. Use --to-html or --to-yaml');
      process.exit(1);
    }
  }

  let output: string;

  try {

    if (toHtml) {
      // YAML → HTML
      const yamlData = YAML.parse(await inputContent);
      output = yamlToHtml(css, yamlData);
    } else {
      // HTML → YAML

      console.log('html input content', await inputContent)
      const data = htmlToYaml(inputContent);
      output = YAML.stringify(data);
    }

    // Write output
    if (values.output) {
      await Bun.write(values.output, output);
      console.log(`✓ Converted ${inputFile} → ${values.output}`);
    } else {
      console.log(output);
    }
  } catch (error) {
    console.error('Error during conversion:', error);
    process.exit(1);
  }
}

main();