/**
 * @fileoverview Tablemaker Tool for generating editable HTML tables from data
 * @module tablemaker-tool
 */

import { writeFile } from 'fs/promises';
import { createHash } from 'crypto';

/**
 * @typedef {Object} TableData
 * @property {string[]} headers - Column headers
 * @property {(string|number)[][]} rows - Row data (array of arrays)
 */

/**
 * @typedef {Object} TableOptions
 * @property {string} [title] - Table title
 * @property {boolean} [editable=true] - Make cells editable
 * @property {boolean} [sortable=true] - Enable column sorting
 * @property {boolean} [exportCsv=true] - Include CSV export button
 * @property {string} [theme='default'] - Table theme (default, dark, minimal)
 */

/**
 * Tablemaker Tool for generating editable HTML tables from structured data
 */
export class TablemakerTool {
  /**
   * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
   * @param {Object} [config]
   */
  constructor(sandboxManager, config = {}) {
    if (!sandboxManager) {
      throw new Error('SandboxManager is required for TablemakerTool');
    }

    /** @type {import('./sandbox-manager.js').SandboxManager} */
    this.sandboxManager = sandboxManager;

    /** @type {Object} */
    this.config = config;
  }

  /**
   * Main entry point - generate an HTML table from data
   * @param {Object} args
   * @returns {Promise<Object>} MCP-compatible response
   */
  async execute(args) {
    const {
      sessionId,
      path,
      inputFormat = 'json',
      data,
      options = {}
    } = args;

    if (!path) {
      throw new Error('path is required');
    }
    if (!data) {
      throw new Error('data is required');
    }

    // Parse input data based on format
    let tableData;
    switch (inputFormat) {
      case 'json':
        tableData = this.parseJsonInput(data);
        break;
      case 'csv':
        tableData = this.parseCsvInput(data);
        break;
      case 'object':
        tableData = this.parseObjectInput(data);
        break;
      default:
        throw new Error(`Unknown input format: ${inputFormat}. Valid formats: json, csv, object`);
    }

    // Generate HTML
    const html = this.buildHtmlPage(tableData, options);
    const buffer = Buffer.from(html, 'utf-8');

    // Resolve path within sandbox
    const absPath = await this.sandboxManager.resolvePath(sessionId, path);

    // Validate size
    this.sandboxManager.validateFileSize(buffer.length, sessionId);

    // Ensure parent directory exists
    await this.sandboxManager.ensureParentDir(absPath);

    // Write file
    await writeFile(absPath, buffer);

    // Update size tracking
    this.sandboxManager.updateSandboxSize(sessionId, buffer.length);

    // Calculate checksum
    const checksum = createHash('sha256').update(buffer).digest('hex');

    return this.formatResponse({
      success: true,
      path,
      size: buffer.length,
      checksum: `sha256:${checksum}`,
      rowCount: tableData.rows.length,
      columnCount: tableData.headers.length,
      headers: tableData.headers
    });
  }

  /**
   * Parse JSON input format
   * @param {Object|string} data - JSON data with headers and rows
   * @returns {TableData}
   */
  parseJsonInput(data) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    if (!parsed.headers || !Array.isArray(parsed.headers)) {
      throw new Error('JSON input must have a "headers" array');
    }
    if (!parsed.rows || !Array.isArray(parsed.rows)) {
      throw new Error('JSON input must have a "rows" array');
    }

    return {
      headers: parsed.headers.map(h => String(h)),
      rows: parsed.rows.map(row =>
        Array.isArray(row) ? row.map(cell => cell ?? '') : []
      )
    };
  }

  /**
   * Parse CSV input format
   * Headers are comma-separated, rows are semicolon-separated lines with comma values
   * @param {string} data - CSV string
   * @returns {TableData}
   */
  parseCsvInput(data) {
    if (typeof data !== 'string') {
      throw new Error('CSV input must be a string');
    }

    const lines = data.trim().split('\n');
    if (lines.length < 1) {
      throw new Error('CSV input must have at least a header line');
    }

    const headers = this.parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(line => this.parseCsvLine(line));

    return { headers, rows };
  }

  /**
   * Parse a CSV line handling quoted values
   * @param {string} line
   * @returns {string[]}
   */
  parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    return values;
  }

  /**
   * Parse array of objects input format
   * @param {Object[]} data - Array of objects
   * @returns {TableData}
   */
  parseObjectInput(data) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Object input must be a non-empty array of objects');
    }

    // Extract headers from first object's keys
    const headers = Object.keys(data[0]);
    const rows = data.map(obj => headers.map(h => obj[h] ?? ''));

    return { headers, rows };
  }

  /**
   * Build complete HTML page with editable table
   * @param {TableData} tableData
   * @param {TableOptions} options
   * @returns {string}
   */
  buildHtmlPage(tableData, options = {}) {
    const {
      title = 'Data Table',
      editable = true,
      sortable = true,
      exportCsv = true,
      theme = 'default'
    } = options;

    const tableHtml = this.buildEditableTable(tableData, { editable, sortable });
    const styles = this.getStyles(theme);
    const scripts = this.getScripts({ sortable, exportCsv });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${this.escapeHtml(title)}</h1>
      <div class="toolbar">
        ${exportCsv ? '<button id="export-csv" class="btn">Export CSV</button>' : ''}
        ${editable ? '<button id="add-row" class="btn">Add Row</button>' : ''}
      </div>
    </header>
    <main>
      ${tableHtml}
    </main>
  </div>
  <script>${scripts}</script>
</body>
</html>`;
  }

  /**
   * Build the editable table HTML
   * @param {TableData} tableData
   * @param {Object} options
   * @returns {string}
   */
  buildEditableTable(tableData, options = {}) {
    const { editable = true, sortable = true } = options;
    const { headers, rows } = tableData;

    const headerCells = headers.map((h, i) =>
      `<th${sortable ? ` data-col="${i}" class="sortable"` : ''}>${this.escapeHtml(String(h))}</th>`
    ).join('\n          ');

    const bodyRows = rows.map((row, rowIdx) => {
      const cells = headers.map((_, colIdx) => {
        const value = row[colIdx] ?? '';
        if (editable) {
          return `<td><input type="text" value="${this.escapeHtml(String(value))}" data-row="${rowIdx}" data-col="${colIdx}"></td>`;
        }
        return `<td>${this.escapeHtml(String(value))}</td>`;
      }).join('\n          ');
      return `        <tr data-row="${rowIdx}">\n          ${cells}\n        </tr>`;
    }).join('\n');

    return `<table id="data-table">
      <thead>
        <tr>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
${bodyRows}
      </tbody>
    </table>`;
  }

  /**
   * Get CSS styles for the table
   * @param {string} theme
   * @returns {string}
   */
  getStyles(theme) {
    const themes = {
      default: {
        bg: '#f5f5f5',
        containerBg: '#ffffff',
        headerBg: '#2196F3',
        headerColor: '#ffffff',
        borderColor: '#ddd',
        hoverBg: '#f0f0f0',
        inputBg: '#ffffff',
        textColor: '#333'
      },
      dark: {
        bg: '#1a1a2e',
        containerBg: '#16213e',
        headerBg: '#0f3460',
        headerColor: '#e94560',
        borderColor: '#0f3460',
        hoverBg: '#1a1a2e',
        inputBg: '#16213e',
        textColor: '#eee'
      },
      minimal: {
        bg: '#ffffff',
        containerBg: '#ffffff',
        headerBg: '#f8f9fa',
        headerColor: '#212529',
        borderColor: '#dee2e6',
        hoverBg: '#f8f9fa',
        inputBg: '#ffffff',
        textColor: '#212529'
      }
    };

    const t = themes[theme] || themes.default;

    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: ${t.bg};
        color: ${t.textColor};
        padding: 20px;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: ${t.containerBg};
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        overflow: hidden;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        background: ${t.headerBg};
        color: ${t.headerColor};
      }
      h1 { font-size: 1.5rem; font-weight: 600; }
      .toolbar { display: flex; gap: 10px; }
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: rgba(255,255,255,0.2);
        color: inherit;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
      }
      .btn:hover { background: rgba(255,255,255,0.3); }
      main { padding: 20px; overflow-x: auto; }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th, td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid ${t.borderColor};
      }
      th {
        background: ${t.headerBg};
        color: ${t.headerColor};
        font-weight: 600;
        position: sticky;
        top: 0;
      }
      th.sortable { cursor: pointer; user-select: none; }
      th.sortable:hover { opacity: 0.8; }
      th.sortable::after { content: ' ⇅'; opacity: 0.5; }
      th.sort-asc::after { content: ' ↑'; opacity: 1; }
      th.sort-desc::after { content: ' ↓'; opacity: 1; }
      tr:hover { background: ${t.hoverBg}; }
      td input {
        width: 100%;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: 4px;
        background: ${t.inputBg};
        color: ${t.textColor};
        font-size: inherit;
        transition: border-color 0.2s;
      }
      td input:focus {
        outline: none;
        border-color: ${t.headerBg};
      }
    `;
  }

  /**
   * Get JavaScript for table interactivity
   * @param {Object} options
   * @returns {string}
   */
  getScripts(options = {}) {
    const { sortable = true, exportCsv = true } = options;

    return `
      (function() {
        const table = document.getElementById('data-table');
        const tbody = table.querySelector('tbody');
        const headers = Array.from(table.querySelectorAll('th'));

        // Get current data
        function getData() {
          const headerNames = headers.map(th => th.textContent.trim());
          const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => {
            return Array.from(tr.querySelectorAll('input, td')).map(cell =>
              cell.tagName === 'INPUT' ? cell.value : cell.textContent
            );
          });
          return { headers: headerNames, rows };
        }

        ${sortable ? `
        // Sorting
        let sortCol = -1;
        let sortAsc = true;

        headers.forEach((th, idx) => {
          if (th.classList.contains('sortable')) {
            th.addEventListener('click', () => {
              if (sortCol === idx) {
                sortAsc = !sortAsc;
              } else {
                sortCol = idx;
                sortAsc = true;
              }

              headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
              th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');

              const rows = Array.from(tbody.querySelectorAll('tr'));
              rows.sort((a, b) => {
                const aVal = a.querySelector(\`[data-col="\${idx}"]\`)?.value ||
                            a.children[idx]?.textContent || '';
                const bVal = b.querySelector(\`[data-col="\${idx}"]\`)?.value ||
                            b.children[idx]?.textContent || '';
                const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
                return sortAsc ? cmp : -cmp;
              });
              rows.forEach(row => tbody.appendChild(row));
            });
          }
        });
        ` : ''}

        ${exportCsv ? `
        // CSV Export
        document.getElementById('export-csv')?.addEventListener('click', () => {
          const { headers: h, rows } = getData();
          const escape = v => '"' + String(v).replace(/"/g, '""') + '"';
          const csv = [h.map(escape).join(',')]
            .concat(rows.map(r => r.map(escape).join(',')))
            .join('\\n');

          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'table-export.csv';
          a.click();
          URL.revokeObjectURL(url);
        });
        ` : ''}

        // Add Row
        document.getElementById('add-row')?.addEventListener('click', () => {
          const colCount = headers.length;
          const rowCount = tbody.querySelectorAll('tr').length;
          const tr = document.createElement('tr');
          tr.dataset.row = rowCount;

          for (let i = 0; i < colCount; i++) {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.dataset.row = rowCount;
            input.dataset.col = i;
            td.appendChild(input);
            tr.appendChild(td);
          }

          tbody.appendChild(tr);
        });
      })();
    `;
  }

  /**
   * Escape HTML special characters
   * @param {string} str
   * @returns {string}
   */
  escapeHtml(str) {
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return str.replace(/[&<>"']/g, c => escapeMap[c]);
  }

  /**
   * Format response in MCP-compatible format
   * @param {Object} data
   * @returns {Object}
   */
  formatResponse(data) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  }

  /**
   * Register tool with router
   * @param {import('./tool-router.js').ToolRouter} router
   */
  registerTools(router) {
    router.registerTool(
      'tablemaker',
      this.execute.bind(this),
      {
        name: 'tablemaker',
        description: 'Generate editable HTML tables from structured data (JSON, CSV, or object arrays). Creates interactive web pages with sorting, editing, and CSV export capabilities.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID for sandbox isolation (optional, uses "default" if not provided)'
            },
            path: {
              type: 'string',
              description: 'Output path for the HTML file within the sandbox (e.g., "output/table.html")'
            },
            inputFormat: {
              type: 'string',
              enum: ['json', 'csv', 'object'],
              default: 'json',
              description: 'Format of input data: "json" (headers+rows), "csv" (string), or "object" (array of objects)'
            },
            data: {
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    headers: { type: 'array', items: { type: 'string' } },
                    rows: { type: 'array', items: { type: 'array' } }
                  },
                  required: ['headers', 'rows'],
                  description: 'JSON format: { headers: ["Col1", "Col2"], rows: [["val1", "val2"]] }'
                },
                {
                  type: 'string',
                  description: 'CSV format: header line followed by data rows'
                },
                {
                  type: 'array',
                  items: { type: 'object' },
                  description: 'Object format: array of objects with consistent keys'
                }
              ],
              description: 'The data to render as a table'
            },
            options: {
              type: 'object',
              description: 'Table rendering options',
              properties: {
                title: {
                  type: 'string',
                  default: 'Data Table',
                  description: 'Title displayed above the table'
                },
                editable: {
                  type: 'boolean',
                  default: true,
                  description: 'Make table cells editable'
                },
                sortable: {
                  type: 'boolean',
                  default: true,
                  description: 'Enable column sorting by clicking headers'
                },
                exportCsv: {
                  type: 'boolean',
                  default: true,
                  description: 'Include CSV export button'
                },
                theme: {
                  type: 'string',
                  enum: ['default', 'dark', 'minimal'],
                  default: 'default',
                  description: 'Visual theme for the table'
                }
              }
            }
          },
          required: ['path', 'data']
        }
      }
    );
  }
}

/**
 * Create a TablemakerTool instance
 * @param {import('./sandbox-manager.js').SandboxManager} sandboxManager
 * @param {Object} [config]
 * @returns {TablemakerTool}
 */
export function createTablemakerTool(sandboxManager, config) {
  return new TablemakerTool(sandboxManager, config);
}

export default TablemakerTool;
