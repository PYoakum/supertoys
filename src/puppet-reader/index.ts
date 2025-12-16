#!/usr/bin/env bun

import { parseArgs } from "util";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import puppeteer from "puppeteer";
import { spawn } from "child_process";

interface Config {
  urls: string[];
  waitTime: number;
  outputFile: string;
  screenshotDir: string;
  useOCR: boolean;
  preprocessImage: boolean;
  viewWidth: number;
  viewHeight: number;
}

const defaultConfig: Config = {
  urls: [],
  waitTime: 2000,
  outputFile: "output.txt",
  screenshotDir: "./screenshots",
  useOCR: true,
  preprocessImage: true,
  viewWidth: 1080,
  viewHeight: 1920
};

async function loadConfig(configPath?: string): Promise<Config> {
  if (configPath && existsSync(configPath)) {
    const configFile = readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(configFile);
    return { ...defaultConfig, ...userConfig };
  }
  return defaultConfig;
}

async function takeScreenshot(
  url: string,
  outputPath: string,
  waitTime: number,
  viewWidth: number,
  viewHeight: number
): Promise<void> {
  console.log(`📸 Taking screenshot of: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {

    const page = await browser.newPage();
    await page.setViewport({ width: viewWidth, height: viewHeight });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    console.log('⏳ Waiting...')
    setTimeout(()=>{
        console.log('⌛️ Wait time complete')
    }, waitTime)
    await page.screenshot({ path: outputPath, fullPage: true });
    console.log(`✅ Screenshot saved: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

async function preprocessImage(inputPath: string, outputPath: string): Promise<void> {
  console.log(`✨ Preprocessing image with ImageMagick...`);
  
  return new Promise((resolve, reject) => {
    const process = spawn("convert", [
      inputPath,
      "-colorspace", "Gray",
      "-threshold", "50%",
      "-sharpen", "0x1",
      outputPath
    ]);
    
    process.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Image preprocessed: ${outputPath}`);
        resolve();
      } else {
        reject(new Error(`❌ ImageMagick failed with code ${code}`));
      }
    });
    
    process.on("error", reject);
  });
}

async function extractText(imagePath: string): Promise<string> {
  console.log(`📝 Extracting text with Python OCR...`);
  
  return new Promise((resolve, reject) => {
    const pythonScript = join(__dirname, "ocr_processor.py");
    const process = spawn("python3", [pythonScript, imagePath]);
    
    let output = "";
    let errorOutput = "";
    
    process.stdout.on("data", (data) => {
      output += data.toString();
    });
    
    process.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });
    
    process.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Text extracted successfully`);
        resolve(output);
      } else {
        reject(new Error(`Python OCR failed: ${errorOutput}`));
      }
    });
    
    process.on("error", reject);
  });
}

async function processURL(
  url: string,
  index: number,
  config: Config
): Promise<string> {
  const timestamp = Date.now();
  const screenshotPath = join(config.screenshotDir, `screenshot_${index}_${timestamp}.png`);
  const processedPath = join(config.screenshotDir, `processed_${index}_${timestamp}.png`);
  
  // Take screenshot
  await takeScreenshot(url, screenshotPath, config.waitTime, config.viewWidth, config.viewHeight);
  
  // Preprocess image if enabled
  let imageForOCR = screenshotPath;
  if (config.preprocessImage) {
    await preprocessImage(screenshotPath, processedPath);
    imageForOCR = processedPath;
  }
  
  // Extract text if OCR is enabled
  let extractedText = "";
  if (config.useOCR) {
    extractedText = await extractText(imageForOCR);
  }
  
  return `\n${"=".repeat(80)}\nURL: ${url}\nTimestamp: ${new Date().toISOString()}\n${"=".repeat(80)}\n${extractedText}\n`;
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      config: {
        type: "string",
        short: "c",
      },
      url: {
        type: "string",
        short: "u",
        multiple: true,
      },
      wait: {
        type: "string",
        short: "w",
      },
      output: {
        type: "string",
        short: "o",
      },
      help: {
        type: "boolean",
        short: "h",
      },
    },
    strict: true,
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Web Screenshot & OCR CLI Tool
==============================

Usage: bun run index.ts [options]

Options:
  -c, --config <path>    Path to JSON config file
  -u, --url <url>        URL to process (can be used multiple times)
  -w, --wait <ms>        Wait time in milliseconds (default: 2000)
  -o, --output <path>    Output file path (default: output.txt)
  -h, --help             Show this help message

Config file format (JSON):
{
  "urls": ["https://example.com"],
  "waitTime": 2000,
  "outputFile": "output.txt",
  "screenshotDir": "./screenshots",
  "useOCR": true,
  "preprocessImage": true
}

Examples:
  bun run index.ts -c config.json
  bun run index.ts -u https://example.com -u https://google.com -w 3000 -o results.txt
    `);
    process.exit(0);
  }

  // Load configuration
  let config = await loadConfig(values.config as string);
  
  // Override with CLI arguments
  if (values.url) {
    config.urls = values.url as string[];
  }
  if (values.wait) {
    config.waitTime = parseInt(values.wait as string, 10);
  }
  if (values.output) {
    config.outputFile = values.output as string;
  }

  if (config.urls.length === 0) {
    console.error("❌ Error: No URLs provided. Use -u flag or config file.");
    process.exit(1);
  }

  // Create screenshot directory if it doesn't exist
  if (!existsSync(config.screenshotDir)) {
    await Bun.write(join(config.screenshotDir, ".gitkeep"), "");
  }

  console.log(`\n🚀 Starting web scraping tool...`);
  console.log(`📋 Processing ${config.urls.length} URL(s)`);
  console.log(`⏱️  Wait time: ${config.waitTime}ms\n`);

  let allResults = "";

  // Process each URL
  for (let i = 0; i < config.urls.length; i++) {
    const url = config.urls[i];
    console.log(`\n[${i + 1}/${config.urls.length}] Processing: ${url}`);
    
    try {
      const result = await processURL(url, i, config);
      allResults += result;
    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error);
      allResults += `\n${"=".repeat(80)}\nURL: ${url}\nERROR: ${error}\n${"=".repeat(80)}\n`;
    }
  }

  // Write results to output file
  writeFileSync(config.outputFile, allResults, "utf-8");
  console.log(`\n✨ Done! Results saved to: ${config.outputFile}`);
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});