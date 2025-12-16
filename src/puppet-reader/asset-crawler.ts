#!/usr/bin/env bun

import puppeteer from "puppeteer";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

type Mode = "json" | "dir";

interface ScrapeRequest {
  url: string;
  mode?: Mode;
  /**
   * Optional list of Content-Type prefixes to keep.
   * Examples:
   *  - "text/css"
   *  - "application/javascript"
   *  - "image/"
   * If omitted or empty, all asset content types are included.
   */
  contentTypes?: string[];
}

const argv = Bun.argv.slice(2);

function parseArg(flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  if (index !== -1 && argv[index + 1]) {
    return argv[index + 1];
  }
  return fallback;
}

const PORT = Number(parseArg("--port", "3000"));
const OUTPUT_DIR = parseArg("--out", "downloads");

// For __dirname in ESM/Bun
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolvedOutputDir = path.resolve(__dirname, OUTPUT_DIR);

let browserPromise: Promise<puppeteer.Browser> | null = null;

async function getBrowser(): Promise<puppeteer.Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true, // silent/headless
      /* headless: "new", // silent/headless */
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

function isAssetResourceType(type: string): boolean {
  // You can tweak this if you want fewer/more asset types
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

  // Give a tiny extra buffer for late requests
  await page.waitForTimeout(1000);

  const html = await page.content();

  await page.close();
  return { html, assets: Array.from(assets) };
}

async function downloadAssets(urls: string[]): Promise<string[]> {
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

      // Return relative-ish path
      savedPaths.push(path.relative(__dirname, outPath));
    } catch (err) {
      console.warn(`Error downloading ${u}:`, err);
    }
  }

  return savedPaths;
}

async function handleScrapeRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: ScrapeRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { url, mode = "json", contentTypes } = body;

  if (!url || typeof url !== "string") {
    return new Response(
      JSON.stringify({ error: '"url" is required and must be a string' }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  if (mode !== "json" && mode !== "dir") {
    return new Response(
      JSON.stringify({ error: '"mode" must be either "json" or "dir"' }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const { html, assets } = await scrapePage(url, contentTypes);

    if (mode === "json") {
      // Return HTML markup and asset URLs
      return new Response(JSON.stringify({ html, assets }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      // mode === "dir": download files and save HTML as index.html
      await mkdir(resolvedOutputDir, { recursive: true });

      const savedAssets = await downloadAssets(assets);

      const indexPath = path.join(resolvedOutputDir, "index.html");
      await writeFile(indexPath, html, "utf-8");

      return new Response(
        JSON.stringify({
          html,
          assets: savedAssets,
          htmlPath: path.relative(__dirname, indexPath),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  } catch (err: any) {
    console.error("Error scraping:", err);
    return new Response(
      JSON.stringify({
        error: "Failed to scrape page",
        details: err?.message ?? String(err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/assets") {
      return handleScrapeRequest(req);
    }

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(
  `Asset server listening on http://localhost:${PORT}\n` +
    `Output directory (for mode "dir"): ${resolvedOutputDir}\n` +
    `POST /assets with JSON: {\n` +
    `  "url": "https://example.com",\n` +
    `  "mode": "json" | "dir",\n` +
    `  "contentTypes": ["text/css", "image/", ...] // optional\n` +
    `}`
);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
  }
  server.stop();
  process.exit(0);
});
