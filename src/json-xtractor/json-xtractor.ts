#!/usr/bin/env bun

import { parseArgs } from "util";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";

interface Config {
  inputFile: string;
  arrayPath: string;
  keyName: string;
  outputFile: string;
}

const USAGE = `
JSON Array Value Extractor CLI Tool

Usage:
  bun run json-xtractor.ts --input <file> --array <path> --key <name> --output <file>

Required Arguments:
  --input, -i      Input JSON file path
  --array, -a      Path to the array in the JSON (e.g., "data" or "users.items")
  --key, -k        Key name to extract from each array item
  --output, -o     Output text file path (one value per line)

Optional Arguments:
  --help           Show this help message

Examples:
  # Extract email addresses from users array
  bun run json-xtractor.ts -i data.json -a users -k email -o emails.txt

  # Extract nested array values
  bun run json-xtractor.ts -i response.json -a data.items -k id -o ids.txt

  # Extract product names
  bun run json-xtractor.ts -i products.json -a products -k name -o product-names.txt
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
        array: {
          type: "string",
          short: "a",
        },
        key: {
          type: "string",
          short: "k",
        },
        output: {
          type: "string",
          short: "o",
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

    if (!values.input || !values.array || !values.key || !values.output) {
      console.error("Error: Missing required arguments\n");
      console.log(USAGE);
      process.exit(1);
    }

    return {
      inputFile: values.input,
      arrayPath: values.array,
      keyName: values.key,
      outputFile: values.output,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error);
    console.log(USAGE);
    process.exit(1);
  }
}

async function readJsonFile(filePath: string): Promise<any> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`📖 Reading JSON file: ${resolvedPath}`);
    const content = await readFile(resolvedPath, "utf-8");
    const jsonData = JSON.parse(content);
    console.log(`✓ Successfully parsed JSON`);
    return jsonData;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in file "${filePath}"`);
      console.error(error.message);
    } else {
      console.error(`Error reading file "${filePath}":`, error);
    }
    process.exit(1);
  }
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || current === undefined) {
      throw new Error(
        `Cannot access property "${part}" of ${current} at path "${parts.slice(0, i).join(".")}"`
      );
    }
    if (!(part in current)) {
      throw new Error(
        `Property "${part}" not found in object at path "${parts.slice(0, i).join(".")}"`
      );
    }
    current = current[part];
  }

  return current;
}

function extractValuesFromArray(
  data: any,
  arrayPath: string,
  keyName: string
): string[] {
  try {
    console.log(`🔍 Navigating to array path: "${arrayPath}"`);
    const array = getNestedValue(data, arrayPath);

    if (!Array.isArray(array)) {
      throw new Error(
        `Value at path "${arrayPath}" is not an array (found: ${typeof array})`
      );
    }

    console.log(`✓ Found array with ${array.length} items`);
    console.log(`🔑 Extracting key: "${keyName}"`);

    const values: string[] = [];
    const errors: string[] = [];

    array.forEach((item, index) => {
      if (item === null || item === undefined) {
        errors.push(`Item at index ${index} is ${item}`);
        return;
      }

      if (typeof item !== "object") {
        errors.push(`Item at index ${index} is not an object (found: ${typeof item})`);
        return;
      }

      if (!(keyName in item)) {
        errors.push(`Item at index ${index} does not have key "${keyName}"`);
        return;
      }

      const value = item[keyName];
      // Convert to string, handling different types
      if (value === null || value === undefined) {
        values.push("");
      } else if (typeof value === "object") {
        values.push(JSON.stringify(value));
      } else {
        values.push(String(value));
      }
    });

    if (errors.length > 0) {
      console.warn(`⚠️  Warning: Encountered ${errors.length} issue(s):`);
      errors.forEach((err) => console.warn(`   - ${err}`));
    }

    console.log(`✓ Successfully extracted ${values.length} values`);
    return values;
  } catch (error) {
    console.error("Error extracting values:", error);
    process.exit(1);
  }
}

async function writeTextFile(filePath: string, values: string[]): Promise<void> {
  try {
    const resolvedPath = resolve(filePath);
    console.log(`💾 Writing output to: ${resolvedPath}`);
    
    const content = values.join("\n");
    await writeFile(resolvedPath, content + "\n", "utf-8");
    
    console.log(`✓ Successfully wrote ${values.length} lines to output file`);
  } catch (error) {
    console.error(`Error writing output file "${filePath}":`, error);
    process.exit(1);
  }
}

async function main() {
  console.log("🚀 JSON Array Value Extractor\n");

  const config = await parseCliArgs();
  if (!config) {
    return;
  }

  try {
    // Read and parse JSON file
    const jsonData = await readJsonFile(config.inputFile);

    // Extract values from array
    const values = extractValuesFromArray(
      jsonData,
      config.arrayPath,
      config.keyName
    );

    // Write to output file
    await writeTextFile(config.outputFile, values);

    console.log("\n✅ Process completed successfully!");
    console.log(`📊 Summary: Extracted ${values.length} values from array`);
  } catch (error) {
    console.error("\n❌ Process failed:", error);
    process.exit(1);
  }
}

main();