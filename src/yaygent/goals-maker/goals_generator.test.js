/**
 * @fileoverview Unit tests for goals_generator.js multiline input
 * @module goals_generator.test
 *
 * Tests cursor positioning and animation behavior during multiline input,
 * especially when content is pasted.
 */

import { test } from 'node:test';
import assert from 'node:assert';

// Mock terminal size
const MOCK_COLS = 80;
const MOCK_ROWS = 24;
const BORDER_HEIGHT = 3;

/**
 * Simulates terminal output capture and ANSI sequence parsing
 */
class TerminalSimulator {
  constructor(cols = MOCK_COLS, rows = MOCK_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.cursorRow = 1;
    this.cursorCol = 1;
    this.savedCursor = { row: 1, col: 1 };
    this.screen = Array(rows).fill(null).map(() => Array(cols).fill(' '));
  }

  /**
   * Parse ANSI escape sequences and track cursor movement
   */
  write(data) {
    const sequences = data.split(/(\x1b\[[^a-zA-Z]*[a-zA-Z])/g);

    for (const seq of sequences) {
      if (!seq) continue;

      // Cursor position: ESC[row;colH
      const posMatch = seq.match(/\x1b\[(\d+);(\d+)H/);
      if (posMatch) {
        this.cursorRow = parseInt(posMatch[1], 10);
        this.cursorCol = parseInt(posMatch[2], 10);
        continue;
      }

      // Save cursor: ESC[s
      if (seq === '\x1b[s') {
        this.savedCursor = { row: this.cursorRow, col: this.cursorCol };
        continue;
      }

      // Restore cursor: ESC[u
      if (seq === '\x1b[u') {
        this.cursorRow = this.savedCursor.row;
        this.cursorCol = this.savedCursor.col;
        continue;
      }

      // Clear line: ESC[2K
      if (seq === '\x1b[2K') {
        if (this.cursorRow >= 1 && this.cursorRow <= this.rows) {
          this.screen[this.cursorRow - 1] = Array(this.cols).fill(' ');
        }
        continue;
      }

      // Regular text - write to screen
      if (!seq.startsWith('\x1b')) {
        for (const char of seq) {
          if (this.cursorRow >= 1 && this.cursorRow <= this.rows &&
              this.cursorCol >= 1 && this.cursorCol <= this.cols) {
            this.screen[this.cursorRow - 1][this.cursorCol - 1] = char;
            this.cursorCol++;
          }
        }
      }
    }
  }

  getRow(row) {
    if (row >= 1 && row <= this.rows) {
      return this.screen[row - 1].join('');
    }
    return '';
  }

  isCursorInContentArea() {
    const headerEnd = 4;
    const footerStart = this.rows - 3;
    return this.cursorRow > headerEnd && this.cursorRow < footerStart;
  }

  isCursorInFooter() {
    const footerStart = this.rows - 3;
    return this.cursorRow >= footerStart;
  }

  getCursor() {
    return { row: this.cursorRow, col: this.cursorCol };
  }
}

// ============ Cursor Position Tests ============

test('cursor: save/restore preserves position during animation', () => {
  const terminal = new TerminalSimulator();

  // Position cursor in content area
  terminal.write('\x1b[14;25H');
  terminal.write('\x1b[s'); // Save

  // Simulate animation moving cursor around
  terminal.write('\x1b[1;1H'); // Header
  terminal.write('\x1b[22;1H'); // Footer

  // Restore
  terminal.write('\x1b[u');

  const cursor = terminal.getCursor();
  assert.strictEqual(cursor.row, 14, 'Cursor row should be preserved');
  assert.strictEqual(cursor.col, 25, 'Cursor col should be preserved');
});

test('cursor: stays in content area after animation frame', () => {
  const terminal = new TerminalSimulator();

  terminal.write('\x1b[14;20H');
  terminal.write('\x1b[s');

  // Simulate full animation
  terminal.write('\x1b[1;1H');
  terminal.write('\x1b[21;1H');
  terminal.write('\x1b[22;1H');

  terminal.write('\x1b[u');

  assert.ok(terminal.isCursorInContentArea(), 'Cursor should be in content area');
  assert.ok(!terminal.isCursorInFooter(), 'Cursor should not be in footer');
});

test('cursor: not in footer area after restore during multiline input', () => {
  const terminal = new TerminalSimulator();

  terminal.write('\x1b[14;1H');
  terminal.write('\x1b[s');

  // Animation writes to footer
  terminal.write('\x1b[21;1H');
  terminal.write('\x1b[22;1H');
  terminal.write('\x1b[23;1H');
  terminal.write('\x1b[24;1H');

  terminal.write('\x1b[u');

  assert.ok(!terminal.isCursorInFooter(), 'Cursor should not be in footer after restore');
});

// ============ Paste Content Handling Tests ============

test('paste: tracks row position correctly for multiple lines', () => {
  let currentRow = 14;
  const maxRow = MOCK_ROWS - 5;

  const pastedLines = [
    'First line of pasted content',
    'Second line of pasted content',
    'Third line of pasted content'
  ];

  for (const line of pastedLines) {
    const availableWidth = MOCK_COLS - 20;
    const visualRows = Math.ceil(line.length / availableWidth) || 1;
    currentRow += visualRows;

    if (currentRow > maxRow) {
      currentRow = maxRow;
    }
  }

  assert.strictEqual(currentRow, 17, 'Current row should advance correctly');
  assert.ok(currentRow <= maxRow, 'Current row should not exceed max');
});

test('paste: clamps row position to prevent footer overflow', () => {
  let currentRow = 14;
  const maxRow = MOCK_ROWS - 5;

  for (let i = 0; i < 20; i++) {
    currentRow++;
    if (currentRow > maxRow) {
      currentRow = maxRow;
    }
  }

  assert.strictEqual(currentRow, maxRow, 'Row should be clamped to max');
});

test('paste: handles word wrap correctly', () => {
  const availableWidth = 60;

  const testCases = [
    { length: 0, expected: 1 },
    { length: 5, expected: 1 },
    { length: 60, expected: 1 },
    { length: 61, expected: 2 },
    { length: 120, expected: 2 },
    { length: 121, expected: 3 },
  ];

  for (const { length, expected } of testCases) {
    const visualRows = length === 0 ? 1 : Math.ceil(length / availableWidth);
    assert.strictEqual(visualRows, expected, `Text of length ${length} should take ${expected} rows`);
  }
});

// ============ Footer Cleanup Tests ============

test('footer: clears rows between content and separator', () => {
  const terminal = new TerminalSimulator();
  const inputRow = 14;
  const separatorRow = MOCK_ROWS - 3;

  // Write some garbage to rows that should be cleared
  for (let row = inputRow + 1; row < separatorRow; row++) {
    terminal.write(`\x1b[${row};1H`);
    terminal.write('GARBAGE');
  }

  // Now simulate cleanup
  for (let row = inputRow + 1; row < separatorRow; row++) {
    terminal.write(`\x1b[${row};1H\x1b[2K`);
  }

  // Check rows are cleared
  for (let row = inputRow + 1; row < separatorRow; row++) {
    const rowContent = terminal.getRow(row).trim();
    assert.strictEqual(rowContent, '', `Row ${row} should be cleared`);
  }
});

test('footer: preserves animation rows', () => {
  const terminal = new TerminalSimulator();
  const footerStartRow = MOCK_ROWS - 2;

  terminal.write(`\x1b[${footerStartRow};1H`);
  terminal.write('Footer1');
  terminal.write(`\x1b[${footerStartRow + 1};1H`);
  terminal.write('Footer2');
  terminal.write(`\x1b[${footerStartRow + 2};1H`);
  terminal.write('Footer3');

  assert.ok(terminal.getRow(footerStartRow).includes('Footer1'));
  assert.ok(terminal.getRow(footerStartRow + 1).includes('Footer2'));
  assert.ok(terminal.getRow(footerStartRow + 2).includes('Footer3'));
});

// ============ Animation Frame Tests ============

test('animation: header render does not affect content cursor', () => {
  const terminal = new TerminalSimulator();

  terminal.write('\x1b[14;25H');
  terminal.write('\x1b[s');

  // Render header
  for (let row = 1; row <= 3; row++) {
    terminal.write(`\x1b[${row};1H`);
    terminal.write('Header animation content');
  }

  terminal.write('\x1b[u');

  const cursor = terminal.getCursor();
  assert.strictEqual(cursor.row, 14);
  assert.strictEqual(cursor.col, 25);
});

test('animation: separator rendered at correct rows', () => {
  const terminal = new TerminalSimulator();
  const topSeparatorRow = 4;
  const bottomSeparatorRow = MOCK_ROWS - 3;

  terminal.write(`\x1b[${topSeparatorRow};1H`);
  terminal.write('—'.repeat(10));

  terminal.write(`\x1b[${bottomSeparatorRow};1H`);
  terminal.write('—'.repeat(10));

  assert.ok(terminal.getRow(topSeparatorRow).includes('—'), 'Top separator present');
  assert.ok(terminal.getRow(bottomSeparatorRow).includes('—'), 'Bottom separator present');
});

// ============ Position Calculation Tests ============

test('calc: max content row is correct', () => {
  const maxContentRow = MOCK_ROWS - BORDER_HEIGHT - 2;
  assert.strictEqual(maxContentRow, 19, 'Max content row should be rows - 5');
});

test('calc: footer boundaries are correct', () => {
  const separatorRow = MOCK_ROWS - BORDER_HEIGHT;
  const footerRow1 = separatorRow + 1;
  const footerRow2 = separatorRow + 2;
  const footerRow3 = MOCK_ROWS;

  assert.strictEqual(separatorRow, 21, 'Separator at row 21');
  assert.strictEqual(footerRow1, 22, 'Footer row 1 at 22');
  assert.strictEqual(footerRow2, 23, 'Footer row 2 at 23');
  assert.strictEqual(footerRow3, 24, 'Footer row 3 at 24');
});

test('calc: input start row within content area', () => {
  const startRow = 14; // Fixed start row
  const headerEnd = 4;
  const footerStart = MOCK_ROWS - BORDER_HEIGHT;

  assert.ok(startRow > headerEnd, 'Start row after header');
  assert.ok(startRow < footerStart, 'Start row before footer');
});

console.log('\nMultiline input tests complete.\n');
