#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

interface Config {
  inputFile: string;
  outputFile: string;
  delimiter: string;
  hasHeader: boolean;
  format: "array" | "object" | "records";
  pretty: boolean;
  skipEmpty: boolean;
  trim: boolean;
}

const USAGE = `
CSV to JSON Converter CLI Tool

Usage:
  bun run csv2json.ts --input <file> --output <file> [options]

Required Arguments:
  --input, -i      Input CSV file path
  --output, -o     Output JSON file path

Optional Arguments:
  --delimiter, -d  Column delimiter (default: ",")
  --no-header      CSV has no header row (uses col0, col1, etc.)
  --format, -f     Output format: array|object|records (default: array)
  --pretty, -p     Pretty print JSON with indentation
  --skip-empty     Skip empty rows
  --trim, -t       Trim whitespace from values
  --help           Show this help message

Output Formats:
  array    - Array of arrays [[col1, col2], [val1, val2]]
  object   - Object with headers as keys {header1: [vals], header2: [vals]}
  records  - Array of objects [{header1: val1, header2: val2}] (default)

Examples:
  # Basic conversion
  bun run csv2json.ts -i data.csv -o data.json

  # With custom delimiter (TSV)
  bun run csv2json.ts -i data.tsv -o data.json -d "\\t"

  # Pretty printed records format
  bun run csv2json.ts -i data.csv -o data.json -f records --pretty

  # Trim whitespace and skip empty rows
  bun run csv2json.ts -i data.csv -o data.json --trim --skip-empty

  # CSV without headers
  bun run csv2json.ts -i data.csv -o data.json --no-header
`;

async function parseCliArgs(): Promise<Config | null> {
  try {
    const { values } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        input: {
          type: "string",
          short: "i",
        },
        output: {
          type: "string",
          short: "o",
        },
        delimiter: {
          type: "string",
          short: "d",
          default: ",",
        },
        "no-header": {
          type: "boolean",
          default: false,
        },
        format: {
          type: "string",
          short: "f",
          default: "records",
        },
        pretty: {
          type: "boolean",
          short: "p",
          default: false,
        },
        "skip-empty": {
          type: "boolean",
          default: false,
        },
        trim: {
          type: "boolean",
          short: "t",
          default: false,
        },
        help: {
          type: "boolean",
        },
      },
      strict: true,
    });

    if (values.help) {
      console.log(USAGE);
      return null;
    }

    if (!values.input || !values.output) {
      console.error("Error: Missing required arguments\n");
      console.log(USAGE);
      process.exit(1);
    }

    const format = values.format as string;
    if (!["array", "object", "records"].includes(format)) {
      console.error(`Error: Invalid format "${format}". Must be: array, object, or records\n`);
      process.exit(1);
    }

    // Handle escape sequences in delimiter
    let delimiter = values.delimiter as string;
    delimiter = delimiter.replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\r/g, "\r");

    return {
      inputFile: values.input,
      outputFile: values.output,
      delimiter,
      hasHeader: !values["no-header"],
      format: format as "array" | "object" | "records",
      pretty: values.pretty,
      skipEmpty: values["skip-empty"],
      trim: values.trim,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(USAGE);
    process.exit(1);
  }
}

async function readCsvFile(filePath: string): Promise<string> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`📖 Reading CSV file: ${resolvedPath}`);
    const content = await readFile(resolvedPath, "utf-8");
    console.log(`✓ Successfully read file (${content.length} bytes)`);
    return content;
  } catch (error) {
    console.error(`Error reading CSV file "${filePath}":`, error);
    process.exit(1);
  }
}

function parseCSV(
  content: string,
  delimiter: string,
  skipEmpty: boolean,
  trim: boolean
): string[][] {
  const lines = content.split(/\r?\n/);
  const rows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines if requested
    if (skipEmpty && line.trim() === "") {
      continue;
    }

    // Simple CSV parsing (handles basic cases)
    // For complex CSV with quotes and escapes, this can be enhanced
    const columns = parseCsvLine(line, delimiter);

    // Apply trim if requested
    const processedColumns = trim
      ? columns.map((col) => col.trim())
      : columns;

    // Skip completely empty rows after processing
    if (skipEmpty && processedColumns.every((col) => col === "")) {
      continue;
    }

    rows.push(processedColumns);
  }

  return rows;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      // End of field
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  // Add the last field
  result.push(current);

  return result;
}

function convertToArray(rows: string[][]): string[][] {
  return rows;
}

function convertToObject(rows: string[][], hasHeader: boolean): Record<string, string[]> {
  if (rows.length === 0) {
    return {};
  }

  const headers = hasHeader
    ? rows[0]
    : rows[0].map((_, i) => `col${i}`);

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const result: Record<string, string[]> = {};

  // Initialize arrays for each header
  headers.forEach((header) => {
    result[header] = [];
  });

  // Populate data
  dataRows.forEach((row) => {
    row.forEach((value, index) => {
      const header = headers[index];
      if (header) {
        result[header].push(value);
      }
    });
  });

  return result;
}

function convertToRecords(rows: string[][], hasHeader: boolean): Record<string, string>[] {
  if (rows.length === 0) {
    return [];
  }

  const headers = hasHeader
    ? rows[0]
    : rows[0].map((_, i) => `col${i}`);

  const dataRows = hasHeader ? rows.slice(1) : rows;
  const result: Record<string, string>[] = [];

  dataRows.forEach((row) => {
    const record: Record<string, string> = {};
    row.forEach((value, index) => {
      const header = headers[index];
      if (header) {
        record[header] = value;
      }
    });
    result.push(record);
  });

  return result;
}

function convertCsvToJson(
  rows: string[][],
  format: "array" | "object" | "records",
  hasHeader: boolean
): any {
  console.log(`🔄 Converting to JSON format: ${format}`);
  console.log(`   Rows: ${rows.length}, Columns: ${rows[0]?.length || 0}`);

  switch (format) {
    case "array":
      return convertToArray(rows);
    case "object":
      return convertToObject(rows, hasHeader);
    case "records":
      return convertToRecords(rows, hasHeader);
    default:
      return rows;
  }
}

async function writeJsonFile(
  filePath: string,
  data: any,
  pretty: boolean
): Promise<void> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`💾 Writing JSON to: ${resolvedPath}`);

    const jsonString = pretty
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);

    await writeFile(resolvedPath, jsonString, "utf-8");

    const size = jsonString.length;
    console.log(`✓ Successfully wrote ${size} bytes`);
  } catch (error) {
    console.error(`Error writing JSON file "${filePath}":`, error);
    process.exit(1);
  }
}

async function main() {
  console.log("🚀 CSV to JSON Converter\n");

  const config = await parseCliArgs();
  if (!config) {
    return;
  }

  try {
    // Read CSV file
    const csvContent = await readCsvFile(config.inputFile);

    // Parse CSV
    console.log(`📊 Parsing CSV (delimiter: "${config.delimiter === "\t" ? "\\t" : config.delimiter}")`);
    const rows = parseCSV(
      csvContent,
      config.delimiter,
      config.skipEmpty,
      config.trim
    );

    if (rows.length === 0) {
      console.warn("⚠️  Warning: CSV file is empty");
      await writeJsonFile(config.outputFile, [], config.pretty);
      return;
    }

    console.log(`✓ Parsed ${rows.length} rows`);

    // Convert to JSON
    const jsonData = convertCsvToJson(rows, config.format, config.hasHeader);

    // Write JSON file
    await writeJsonFile(config.outputFile, {'data':jsonData}, config.pretty);

    console.log("\n✅ Conversion completed successfully!");

    // Show preview
    if (config.format === "records" && Array.isArray(jsonData) && jsonData.length > 0) {
      console.log(`\n📋 Preview (first record):`);
      console.log(JSON.stringify(jsonData[0], null, 2));
      if (jsonData.length > 1) {
        console.log(`   ... and ${jsonData.length - 1} more records`);
      }
    }
  } catch (error) {
    console.error("\n❌ Conversion failed:", error);
    process.exit(1);
  }
}

main();