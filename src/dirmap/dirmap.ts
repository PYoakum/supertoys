import { readdir, stat, writeFile, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { stringify } from "yaml";

// For Node.js compatibility when Bun is not available
const writeOutput = async (path: string, content: string) => {
  if (typeof Bun !== "undefined") {
    await Bun.write(path, content);
  } else {
    await writeFile(path, content, "utf-8");
  }
};

interface FileEntry {
  name: string;
  type: "file";
  size: number;
  modified: string;
  preview: string[];
}

interface DirectoryEntry {
  name: string;
  type: "directory";
  children: (FileEntry | DirectoryEntry)[];
}

interface Manifest {
  generated: string;
  rootPath: string;
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  tree: DirectoryEntry;
}

interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
}

interface WebhookResponse {
  success: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  error?: string;
}

async function getFilePreview(filePath: string, maxLines: number = 5): Promise<string[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    
    if (lines.length <= maxLines) {
      return lines;
    }
    
    const preview = lines.slice(0, maxLines);
    preview.push("[…]");
    return preview;
  } catch {
    // If we can't read the file (binary, permissions, etc.), return empty preview
    return ["[binary or unreadable file]"];
  }
}

async function walkDirectory(dirPath: string): Promise<DirectoryEntry> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const children: (FileEntry | DirectoryEntry)[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const subDir = await walkDirectory(fullPath);
      children.push(subDir);
    } else if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      const preview = await getFilePreview(fullPath);
      children.push({
        name: entry.name,
        type: "file",
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
        preview,
      });
    }
  }

  // Sort: directories first, then files, both alphabetically
  children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    name: basename(dirPath),
    type: "directory",
    children,
  };
}

function countStats(entry: DirectoryEntry | FileEntry): {
  files: number;
  directories: number;
  size: number;
} {
  if (entry.type === "file") {
    return { files: 1, directories: 0, size: entry.size };
  }

  let files = 0;
  let directories = 1;
  let size = 0;

  for (const child of entry.children) {
    const childStats = countStats(child);
    files += childStats.files;
    directories += childStats.directories;
    size += childStats.size;
  }

  return { files, directories, size };
}

export async function postToWebhook(
  manifest: Manifest,
  config: WebhookConfig
): Promise<WebhookResponse> {
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify(manifest),
    });

    let body: unknown;
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function generateDirectoryManifest(
  inputDir: string,
  options?: {
    outputPath?: string;
    webhook?: WebhookConfig;
  }
): Promise<{ yaml: string; manifest: Manifest; webhookResponse?: WebhookResponse }> {
  // Resolve to absolute path
  const absolutePath = inputDir.startsWith("/")
    ? inputDir
    : join(process.cwd(), inputDir);

  // Walk the directory tree
  const tree = await walkDirectory(absolutePath);

  // Calculate statistics
  const stats = countStats(tree);

  // Build the manifest
  const manifest: Manifest = {
    generated: new Date().toISOString(),
    rootPath: absolutePath,
    totalFiles: stats.files,
    totalDirectories: stats.directories,
    totalSize: stats.size,
    tree,
  };

  // Convert to YAML
  const yamlContent = stringify(manifest, {
    indent: 2,
    lineWidth: 120,
  });

  // Write to file if output path is provided
  if (options?.outputPath) {
    const resolvedOutput = options.outputPath.startsWith("/")
      ? options.outputPath
      : join(process.cwd(), options.outputPath);
    await writeOutput(resolvedOutput, yamlContent);
  }

  // Post to webhook if configured
  let webhookResponse: WebhookResponse | undefined;
  if (options?.webhook) {
    webhookResponse = await postToWebhook(manifest, options.webhook);
  }

  return {
    yaml: yamlContent,
    manifest,
    webhookResponse,
  };
}

// CLI usage
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("Usage: bun directory-manifest-v2.ts <directory> [options]");
    console.log("\nOptions:");
    console.log("  --output, -o <file>     Output YAML file path");
    console.log("  --webhook, -w <url>     Webhook URL to POST manifest as JSON");
    console.log("  --header, -H <k:v>      Add header to webhook request (can be repeated)");
    console.log("\nExamples:");
    console.log("  bun fmapper.ts ../thesis -o manifest.yaml");
    console.log("  bun fmapper.ts ../thesis -w https://localhost:3004/webhook");
    console.log('  bun fmapper.ts ../thesis -w https://api.example.com -H "Authorization:Bearer token"');
    process.exit(1);
  }

  // Parse arguments
  const inputDir = args[0];
  let outputPath: string | undefined;
  let webhookUrl: string | undefined;
  const headers: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--output" || arg === "-o") && args[i + 1]) {
      outputPath = args[++i];
    } else if ((arg === "--webhook" || arg === "-w") && args[i + 1]) {
      webhookUrl = args[++i];
    } else if ((arg === "--header" || arg === "-H") && args[i + 1]) {
      const header = args[++i];
      const colonIndex = header.indexOf(":");
      if (colonIndex > 0) {
        const key = header.substring(0, colonIndex).trim();
        const value = header.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
  }

  try {
    const result = await generateDirectoryManifest(inputDir, {
      outputPath,
      webhook: webhookUrl
        ? {
            url: webhookUrl,
            headers: Object.keys(headers).length > 0 ? headers : undefined,
          }
        : undefined,
    });

    if (outputPath) {
      console.log(`Manifest generated: ${outputPath}`);
    }

    if (result.webhookResponse) {
      console.log("\n--- Webhook Response ---");
      if (result.webhookResponse.success) {
        console.log(`Status: ${result.webhookResponse.status} ${result.webhookResponse.statusText}`);
        console.log("Body:", JSON.stringify(result.webhookResponse.body, null, 2));
      } else {
        console.error("Webhook failed:", result.webhookResponse.error);
      }
    }

    console.log("\n--- YAML Preview ---\n");
    console.log(result.yaml);
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
