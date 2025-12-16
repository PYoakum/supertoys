/**
 * HTML Sanitization utilities to prevent XSS attacks
 */

/**
 * List of allowed HTML tags for sanitization
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre',
  'a', 'img', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr'
]);

/**
 * List of allowed URL protocols
 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Escape HTML special characters to prevent XSS
 * @param text - The text to escape
 * @returns Escaped text safe for HTML output
 */
export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  
  return text.replace(/[&<>"']/g, (char) => escapeMap[char]);
}

/**
 * Validate if a URL uses a safe protocol
 * @param url - The URL to validate
 * @returns True if the URL is safe, false otherwise
 */
export function isSafeUrl(url: string): boolean {
  if (!url) return false;
  
  try {
    // Handle relative URLs
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
      return true;
    }
    
    // Handle fragment identifiers
    if (url.startsWith('#')) {
      return true;
    }
    
    const urlObj = new URL(url, 'https://example.com');
    return ALLOWED_PROTOCOLS.has(urlObj.protocol);
  } catch {
    // If URL parsing fails, it's not a valid URL
    return false;
  }
}

/**
 * Sanitize HTML output by removing dangerous tags and attributes
 * @param html - The HTML to sanitize
 * @returns Sanitized HTML
 */
export function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove event handler attributes (onclick, onerror, etc.)
  html = html.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/\son\w+\s*=\s*[^\s>]*/gi, '');
  
  // Remove javascript: protocol from href and src
  html = html.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '');
  html = html.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, '');
  
  // Remove data: URIs that could contain scripts (except images)
  html = html.replace(/href\s*=\s*["']data:[^"']*["']/gi, '');
  
  // Remove style tags
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  return html;
}

/**
 * Generate a slug from text for use as an ID
 * @param text - The text to convert to a slug
 * @returns A URL-safe slug
 */
export function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
