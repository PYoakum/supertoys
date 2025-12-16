/**
 * Bun mTLS HTTP Client Library
 * Provides helper functions for making HTTP requests with mutual TLS authentication
 */

import { readFileSync } from "fs";

export interface CertificateConfig {
  /** Client certificate (PEM string or file path) */
  cert: string;
  /** Client private key (PEM string or file path) */
  key: string;
  /** CA certificate for server verification (PEM string or file path) */
  ca?: string;
  /** Passphrase for encrypted private key */
  passphrase?: string;
}

export interface RequestOptions {
  /** HTTP method */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | "PURGE";
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (string, object, or file path) */
  body?: string | object | ArrayBuffer | Blob;
  /** If true, treat body as file path and read it */
  bodyFromFile?: boolean;
  /** Certificate configuration */
  cert?: CertificateConfig;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Follow redirects */
  redirect?: "follow" | "error" | "manual";
  /** Reject unauthorized (invalid) certificates */
  rejectUnauthorized?: boolean;
}

export interface MTLSResponse {
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body as text */
  text: string;
  /** Response body as JSON (if applicable) */
  json?: any;
  /** Response body as ArrayBuffer */
  arrayBuffer: ArrayBuffer;
  /** Indicates if request was successful */
  ok: boolean;
  /** URL of the response */
  url: string;
}

/**
 * Load certificate from string or file path
 */
function loadCertificate(certInput: string): string {
  // Check if it looks like a file path
  if (certInput.includes("/") || certInput.includes("\\") || certInput.endsWith(".pem") || certInput.endsWith(".crt") || certInput.endsWith(".key")) {
    try {
      return readFileSync(certInput, "utf-8");
    } catch (error) {
      throw new Error(`Failed to read certificate file: ${certInput} - ${error}`);
    }
  }
  
  // Assume it's already a PEM string
  return certInput;
}

/**
 * Prepare TLS options for fetch
 */
function prepareTLSOptions(cert?: CertificateConfig) {
  if (!cert) {
    return undefined;
  }

  return {
    cert: loadCertificate(cert.cert),
    key: loadCertificate(cert.key),
    ca: cert.ca ? loadCertificate(cert.ca) : undefined,
    passphrase: cert.passphrase,
  };
}

/**
 * Prepare request body
 */
async function prepareBody(body: any, bodyFromFile: boolean = false): Promise<any> {
  if (!body) {
    return undefined;
  }

  // Read from file if requested
  if (bodyFromFile && typeof body === "string") {
    try {
      const file = Bun.file(body);
      return await file.arrayBuffer();
    } catch (error) {
      throw new Error(`Failed to read body file: ${body} - ${error}`);
    }
  }

  // Handle objects (convert to JSON)
  if (typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
    return JSON.stringify(body);
  }

  return body;
}

/**
 * Make an HTTP request with optional mTLS
 */
export async function request(url: string, options: RequestOptions = {}): Promise<MTLSResponse> {
  const {
    method = "GET",
    headers = {},
    body,
    bodyFromFile = false,
    cert,
    timeout = 30000,
    redirect = "follow",
    rejectUnauthorized = true,
  } = options;

  // Prepare body
  const preparedBody = await prepareBody(body, bodyFromFile);

  // Prepare headers
  const finalHeaders: Record<string, string> = { ...headers };
  
  // Auto-set Content-Type for JSON objects
  if (typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Blob) && !finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }

  // Prepare TLS options
  const tlsOptions = prepareTLSOptions(cert);

  // Make the request
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: preparedBody,
      redirect,
      signal: controller.signal,
      tls: tlsOptions ? {
        ...tlsOptions,
        rejectUnauthorized,
      } : undefined,
    });

    clearTimeout(timeoutId);

    // Get response body
    const arrayBuffer = await response.arrayBuffer();
    const text = new TextDecoder().decode(arrayBuffer);
    
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON, that's fine
    }

    // Convert headers to object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      text,
      json,
      arrayBuffer,
      ok: response.ok,
      url: response.url,
    };
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw new Error(`Request failed: ${error.message}`);
  }
}

/**
 * Convenience methods for common HTTP verbs
 */

export async function get(url: string, options: Omit<RequestOptions, "method"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "GET" });
}

export async function post(url: string, body?: any, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "POST", body });
}

export async function put(url: string, body?: any, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "PUT", body });
}

export async function del(url: string, options: Omit<RequestOptions, "method"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "DELETE" });
}

export async function patch(url: string, body?: any, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "PATCH", body });
}

export async function head(url: string, options: Omit<RequestOptions, "method"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "HEAD" });
}

export async function options(url: string, options: Omit<RequestOptions, "method"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "OPTIONS" });
}

export async function purge(url: string, options: Omit<RequestOptions, "method"> = {}): Promise<MTLSResponse> {
  return request(url, { ...options, method: "PURGE" });
}

/**
 * Create a client with pre-configured certificate
 */
export function createClient(cert: CertificateConfig) {
  return {
    request: (url: string, options: RequestOptions = {}) => 
      request(url, { ...options, cert: options.cert || cert }),
    
    get: (url: string, options: Omit<RequestOptions, "method"> = {}) => 
      get(url, { ...options, cert: options.cert || cert }),
    
    post: (url: string, body?: any, options: Omit<RequestOptions, "method" | "body"> = {}) => 
      post(url, body, { ...options, cert: options.cert || cert }),
    
    put: (url: string, body?: any, options: Omit<RequestOptions, "method" | "body"> = {}) => 
      put(url, body, { ...options, cert: options.cert || cert }),
    
    delete: (url: string, options: Omit<RequestOptions, "method"> = {}) => 
      del(url, { ...options, cert: options.cert || cert }),
    
    patch: (url: string, body?: any, options: Omit<RequestOptions, "method" | "body"> = {}) => 
      patch(url, body, { ...options, cert: options.cert || cert }),
    
    head: (url: string, options: Omit<RequestOptions, "method"> = {}) => 
      head(url, { ...options, cert: options.cert || cert }),
    
    options: (url: string, options: Omit<RequestOptions, "method"> = {}) => 
      options(url, { ...options, cert: options.cert || cert }),
    
    purge: (url: string, options: Omit<RequestOptions, "method"> = {}) => 
      purge(url, { ...options, cert: options.cert || cert }),
  };
}

export default {
  request,
  get,
  post,
  put,
  delete: del,
  patch,
  head,
  options,
  purge,
  createClient,
};