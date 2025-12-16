#!/usr/bin/env bun

import puppeteer from "puppeteer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

type Mode = "json" | "dir";

interface CliOptions {
  url: string;
  mode: Mode;
  outDir: string;
  contentTypes: string[] | undefined;
}

// For __dirname in ESM/Bun
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------ CLI PARSING ------------------ */

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];

  function getFlag(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) {
      return args[idx + 1];
    }
    return undefined;
  }

  const url = getFlag("--url");
  if (!url) {
    console.error("Error: --url is required");
    printHelpAndExit(1);
  }

  const modeStr = getFlag("--mode") ?? "json";
  const mode = (["json", "dir"].includes(modeStr) ? modeStr : "json") as Mode;

  const outDir = getFlag("--out") ?? "downloads";

  const contentTypesStr = getFlag("--content-types");
  const contentTypes = contentTypesStr
    ? contentTypesStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  return { url, mode, outDir, contentTypes };
}

function printHelpAndExit(code = 0): never {
  console.log(
    `Usage:
  bun run crawl.ts --url <url> [--mode json|dir] [--out <dir>] [--content-types <list>]

Options:
  --url            The page URL to crawl (required).
  --mode           "json" (default) to print HTML + asset URLs as JSON,
                   "dir" to download assets and save HTML as index.html.
  --out            Output directory for "dir" mode. Default: "downloads".
  --content-types  Comma-separated list of Content-Type prefixes to keep.
                   Examples:
                     --content-types text/css,image/,application/javascript
                   If omitted, all asset content types are included.

Examples:
  bun run crawl.ts --url https://example.com --mode json
  bun run crawl.ts --url https://example.com --mode dir --out ./mirror --content-types text/css,image/
`
  );
  process.exit(code);
}

/* ------------------ CORE LOGIC ------------------ */

let browserPromise: Promise<puppeteer.Browser> | null = null;

async function getBrowser(): Promise<puppeteer.Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

function isAssetResourceType(type: string): boolean {
  const assetTypes = new Set([
    "stylesheet",
    "image",
    "media",
    "font",
    "script",
    "xhr",
    "fetch",
    "websocket",
    "manifest",
    "other",
  ]);
  return assetTypes.has(type as any);
}

/**
 * Check whether a given Content-Type header matches any of the configured
 * contentType filters. Matching is prefix-based, so "image/" matches
 * "image/png", "image/jpeg", etc.
 */
function contentTypeMatchesFilter(
  contentTypeHeader: string | undefined,
  filters?: string[]
): boolean {
  if (!filters || filters.length === 0) return true; // no filter ⇒ accept all
  if (!contentTypeHeader) return false;

  const header = contentTypeHeader.toLowerCase();
  const normalizedFilters = filters.map((f) => f.toLowerCase());

  return normalizedFilters.some((f) => header.startsWith(f));
}

function safeFilenameFromUrl(u: string, index: number): string {
  try {
    const urlObj = new URL(u);
    let pathname = urlObj.pathname;

    if (!pathname || pathname === "/") {
      pathname = "/index";
    }

    // Grab basename and extension
    let base = path.basename(pathname);
    if (!base) base = "file";

    // Remove query-ish stuff
    base = base.replace(/[?#].*$/, "");

    // Replace ugly chars
    base = base.replace(/[^a-zA-Z0-9._-]/g, "_");

    // If no ext, default to .bin
    if (!path.extname(base)) {
      base = base + ".bin";
    }

    // Prefix with index to avoid collisions
    return `${index.toString().padStart(4, "0")}_${base}`;
  } catch {
    // Fallback if URL parsing fails
    return `${index.toString().padStart(4, "0")}_asset.bin`;
  }
}

async function scrapePage(
  url: string,
  contentTypes?: string[]
): Promise<{ html: string; assets: string[] }> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  const assets = new Set<string>();

  page.on("response", async (response) => {
    try {
      const req = response.request();
      const type = req.resourceType();
      const resUrl = response.url();

      if (!isAssetResourceType(type) || resUrl === url) {
        return;
      }

      const headers = response.headers();
      const headerContentType =
        headers["content-type"] || headers["Content-Type"];

      if (!contentTypeMatchesFilter(headerContentType, contentTypes)) {
        return;
      }

      assets.add(resUrl);
    } catch {
      // ignore per-response errors
    }
  });

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 60_000,
  });

  //await page.waitForTimeout(1000);
  setTimeout(()=>{}, 1000)

  const html = await page.content();
  await page.close();

  return { html, assets: Array.from(assets) };
}

async function downloadAssets(
  urls: string[],
  outDir: string
): Promise<string[]> {
  const resolvedOutputDir = path.resolve(__dirname, outDir);
  await mkdir(resolvedOutputDir, { recursive: true });
  const savedPaths: string[] = [];

  let idx = 0;
  for (const u of urls) {
    idx++;
    try {
      const resp = await fetch(u);
      if (!resp.ok) {
        console.warn(`Failed to download ${u}: ${resp.status}`);
        continue;
      }

      const buf = new Uint8Array(await resp.arrayBuffer());
      const filename = safeFilenameFromUrl(u, idx);
      const outPath = path.join(resolvedOutputDir, filename);
      await writeFile(outPath, buf);

      savedPaths.push(path.relative(process.cwd(), outPath));
    } catch (err) {
      console.warn(`Error downloading ${u}:`, err);
    }
  }

  return savedPaths;
}

/* ------------------ MAIN ENTRY ------------------ */

async function main() {
  const argv = Bun.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelpAndExit(0);
  }

  const opts = parseArgs(argv);
  const { url, mode, outDir, contentTypes } = opts;

  try {
    const { html, assets } = await scrapePage(url, contentTypes);

    if (mode === "json") {
      // Print HTML and asset URLs as JSON to stdout
      const result = { html, assets };
      console.log(JSON.stringify(result, null, 2));
    } else {
      // mode === "dir"
      const resolvedOutputDir = path.resolve(__dirname, outDir);
      await mkdir(resolvedOutputDir, { recursive: true });

      const savedAssets = await downloadAssets(assets, outDir);

      const indexPath = path.join(resolvedOutputDir, "index.html");
      await writeFile(indexPath, html, "utf-8");

      const result = {
        html,
        assets: savedAssets,
        htmlPath: path.relative(process.cwd(), indexPath),
      };
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err: any) {
    console.error(
      JSON.stringify(
        {
          error: "Failed to crawl page",
          details: err?.message ?? String(err),
        },
        null,
        2
      )
    );
    process.exit(1);
  } finally {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }
  }
}

main();
