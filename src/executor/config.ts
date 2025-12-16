export interface Config {
  output?: string;
  endpoint?: string;
  method?: string;
  headers?: string[] | Record<string, string>;
  timeout?: number;
  format?: "text" | "json";
  includeStderr?: boolean;
  trim?: boolean;
}

export async function loadConfig(filepath: string): Promise<Config> {
  try {
    const file = Bun.file(filepath);
    
    if (!(await file.exists())) {
      throw new Error(`Config file not found: ${filepath}`);
    }

    const content = await file.text();
    const config = JSON.parse(content);

    // Validate config structure
    validateConfig(config);

    console.log(`✓ Loaded config from: ${filepath}`);
    
    return config;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file "${filepath}": ${error.message}`);
    }
    throw error;
  }
}

function validateConfig(config: any): void {
  if (typeof config !== "object" || config === null) {
    throw new Error("Config must be a JSON object");
  }

  const validKeys = [
    "output",
    "endpoint",
    "method",
    "headers",
    "timeout",
    "format",
    "includeStderr",
    "trim",
  ];

  // Warn about unknown keys
  for (const key of Object.keys(config)) {
    if (!validKeys.includes(key)) {
      console.warn(`Warning: Unknown config key "${key}", ignoring`);
    }
  }

  // Validate types
  if (config.output !== undefined && typeof config.output !== "string") {
    throw new Error("Config 'output' must be a string");
  }

  if (config.endpoint !== undefined && typeof config.endpoint !== "string") {
    throw new Error("Config 'endpoint' must be a string");
  }

  if (config.method !== undefined && typeof config.method !== "string") {
    throw new Error("Config 'method' must be a string");
  }

  if (config.headers !== undefined) {
    if (!Array.isArray(config.headers) && typeof config.headers !== "object") {
      throw new Error("Config 'headers' must be an array or object");
    }
  }

  if (config.timeout !== undefined && typeof config.timeout !== "number") {
    throw new Error("Config 'timeout' must be a number");
  }

  if (config.format !== undefined) {
    if (config.format !== "text" && config.format !== "json") {
      throw new Error("Config 'format' must be 'text' or 'json'");
    }
  }

  if (config.includeStderr !== undefined && typeof config.includeStderr !== "boolean") {
    throw new Error("Config 'includeStderr' must be a boolean");
  }

  if (config.trim !== undefined && typeof config.trim !== "boolean") {
    throw new Error("Config 'trim' must be a boolean");
  }
}