/**
 * Table Block Generator
 * Creates HTML tables from structured data
 */

import { escapeHtml, generateId } from "../utils/template.js";

/**
 * Generate HTML table from block configuration
 * @param {Object} block - Block configuration
 * @param {string[]} [block.headers] - Table headers
 * @param {Array<Array|Object>} block.rows - Table rows (array of arrays or objects)
 * @param {string} [block.caption] - Table caption
 * @param {string} [block.id] - Optional element ID
 * @param {string} [block.class] - Additional CSS classes
 * @param {boolean} [block.striped] - Enable striped rows
 * @param {boolean} [block.hoverable] - Enable hover effect
 * @param {Object} [block.columnAlign] - Column alignment (e.g., {1: 'right', 2: 'center'})
 * @returns {string} HTML string
 * 
 * @example
 * // Array format
 * {
 *   type: "table",
 *   caption: "Sales Data",
 *   headers: ["Product", "Q1", "Q2", "Q3"],
 *   rows: [
 *     ["Widget A", 100, 150, 200],
 *     ["Widget B", 80, 90, 110]
 *   ],
 *   columnAlign: { 1: "right", 2: "right", 3: "right" }
 * }
 * 
 * @example
 * // Object format (auto-generates headers from keys)
 * {
 *   type: "table",
 *   rows: [
 *     { name: "Alice", age: 30, role: "Developer" },
 *     { name: "Bob", age: 25, role: "Designer" }
 *   ]
 * }
 */
export function generateTable(block) {
  const {
    headers,
    rows,
    caption,
    id,
    class: className,
    striped = false,
    hoverable = true,
    columnAlign = {},
  } = block;

  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    throw new Error("Table block requires 'rows' property with at least one row");
  }

  const blockId = id || generateId("table");
  const classes = [
    "block",
    "c-table",
    striped && "table-striped",
    hoverable && "table-hoverable",
    className,
  ].filter(Boolean).join(" ");

  // Determine headers and normalize rows
  let tableHeaders = headers;
  let tableRows = rows;

  // If rows are objects, extract headers from first row's keys
  if (typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    if (!tableHeaders) {
      tableHeaders = Object.keys(rows[0]);
    }
    tableRows = rows.map((row) => tableHeaders.map((h) => row[h]));
  }

  // Build HTML
  let html = `<div id="${blockId}" class="${classes}">
  <table>`;

  // Caption
  if (caption) {
    html += `\n    <caption>${escapeHtml(caption)}</caption>`;
  }

  // Headers
  if (tableHeaders && tableHeaders.length > 0) {
    html += `\n    <thead>\n      <tr>`;
    tableHeaders.forEach((header, i) => {
      const align = columnAlign[i] ? ` style="text-align: ${columnAlign[i]}"` : "";
      html += `\n        <th${align}>${escapeHtml(String(header))}</th>`;
    });
    html += `\n      </tr>\n    </thead>`;
  }

  // Body
  html += `\n    <tbody>`;
  tableRows.forEach((row, rowIndex) => {
    html += `\n      <tr>`;
    const cells = Array.isArray(row) ? row : Object.values(row);
    cells.forEach((cell, cellIndex) => {
      const align = columnAlign[cellIndex] ? ` style="text-align: ${columnAlign[cellIndex]}"` : "";
      const content = cell !== null && cell !== undefined ? escapeHtml(String(cell)) : "";
      html += `\n        <td${align}><input class="c-input" type="text" value="${content}" /></td>`;
    });
    html += `\n      </tr>`;
  });
  html += `\n    </tbody>`;

  html += `\n  </table>
</div>`;

  return html;
}

/**
 * Generate a simple table from 2D array
 * @param {Array<Array>} data - 2D array with first row as headers
 * @returns {string} HTML string
 */
export function simpleTable(data) {
  if (!data || data.length < 2) {
    throw new Error("Simple table requires at least 2 rows (header + data)");
  }

  return generateTable({
    headers: data[0],
    rows: data.slice(1),
  });
}
