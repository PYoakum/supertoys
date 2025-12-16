import type { ExecutionResult } from "./executor";

export interface OutputOptions {
  output?: string;
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  format?: "text" | "json";
  includeStderr?: boolean;
  trim?: boolean;
}

export async function handleOutput(
  result: ExecutionResult,
  options: OutputOptions
): Promise<void> {
  const { output, endpoint, format = "text", includeStderr = false, trim = true } = options;

  // Prepare the output content
  let content = result.stdout;
  
  if (includeStderr && result.stderr) {
    content += "\n--- STDERR ---\n" + result.stderr;
  }

  if (trim) {
    content = content.trim();
  }

  // Format the content
  const formattedContent = format === "json" 
    ? formatAsJson(result, content, includeStderr)
    : content;

  // Write to file if specified
  if (output) {
    await writeToFile(output, formattedContent, format);
    console.log(`\n✓ Output written to: ${output}`);
  }

  // Send to endpoint if specified
  if (endpoint) {
    await sendToEndpoint(endpoint, formattedContent, result, options);
    console.log(`✓ Output sent to: ${endpoint}`);
  }

  // If no output destination specified, print to console
  if (!output && !endpoint) {
    console.log("\n--- Output ---");
    console.log(formattedContent);
  }
}

function formatAsJson(
  result: ExecutionResult,
  content: string,
  includeStderr: boolean
): string {
  const data: any = {
    command: result.command,
    exitCode: result.exitCode,
    executionTime: result.executionTime,
    stdout: result.stdout,
    timestamp: new Date().toISOString(),
  };

  if (includeStderr) {
    data.stderr = result.stderr;
  }

  return JSON.stringify(data, null, 2);
}

async function writeToFile(
  filepath: string,
  content: string,
  format: string
): Promise<void> {
  try {
    await Bun.write(filepath, content);
  } catch (error) {
    throw new Error(
      `Failed to write to file "${filepath}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function sendToEndpoint(
  endpoint: string,
  content: string,
  result: ExecutionResult,
  options: OutputOptions
): Promise<void> {
  const { method = "POST", headers = {} } = options;

  try {
    // Determine content type
    const contentType = options.format === "json" 
      ? "application/json" 
      : "text/plain";

    const response = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": contentType,
        ...headers,
      },
      body: content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}${errorText ? "\n" + errorText : ""}`
      );
    }

    // Log response if it has content
    const responseText = await response.text();
    if (responseText) {
      console.log("\nEndpoint response:");
      console.log(responseText);
    }
  } catch (error) {
    throw new Error(
      `Failed to send to endpoint "${endpoint}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}