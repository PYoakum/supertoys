const path = __dirname+'/style.css';
const file = Bun.file(path);

const DEFAULT_STYLES = await file.text();

/**
 * HTML Template Wrapper
 * Wraps content in a complete HTML document
 */

/**
 * Wrap HTML content in a complete document
 * @param {string} content - HTML content to wrap
 * @param {Object} options - Document options
 * @returns {string} Complete HTML document
 */
export function wrapInDocument(content, options = {}) {
  const {
    title = "Generated Content",
    customStyles = "",
    lang = "en",
    charset = "UTF-8",
    viewport = "width=device-width, initial-scale=1.0",
    meta = [],
  } = options;

  const metaTags = meta
    .map((m) => `<meta ${Object.entries(m).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(" ")}>`)
    .join("\n    ");

  return `
  <!doctype html>\r
  <html lang="${lang}">\r
  \t<head>\r
  \t\t<meta charset="${charset}" />\r
  \t\t<meta name="viewport" content="${viewport}" />\r
  \t\t${metaTags}\r
  \t\t<title>${escapeHtml(title)}</title>\r
  \t\t<style>${DEFAULT_STYLES}</style>
  \t\t${customStyles ? `<style>${customStyles}</style>` : ""}
  \t</head>\r
  \t<body>\r
  \t\t<div class="app theme-mac" data-cmp="app-root">\r
  \t\t\t<header role="banner">\r
  \t\t\t\t<div class="c-header">\r
  \t\t\t\t\t<div class="c-header__bar c-window" role="navigation" aria-label="Primary">\r
  \t\t\t\t\t\t<strong class="c-header__brand">${title}</strong>\r
  \t\t\t\t\t</div>\r
  \t\t\t\t</div>\r
  \t\t\t</header>\r
  \t\t\t<section id="window-content">\r
  \t\t\t\t<div class="c-window c-window__content" id="window-content">\r
  ${content}
  \t\t\t\t</div>\r
  \t\t\t</section>\r
  \t\t</div>\r
  \t</body>\r
  </html>`;

}



/**
 * Escape HTML entities
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escape attribute value
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeAttr(str) {
  if (typeof str !== "string") return str;
  return str.replace(/"/g, "&quot;");
}

/**
 * Generate a unique ID
 * @param {string} prefix - ID prefix
 * @returns {string} Unique ID
 */
export function generateId(prefix = "block") {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
