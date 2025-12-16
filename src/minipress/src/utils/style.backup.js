export default DEFAULT_STYLES = `
:root {
  --color-bg: #fafafa;
  --color-text: #1a1a1a;
  --color-text-muted: #666;
  --color-border: #e0e0e0;
  --color-accent: #2563eb;
  --color-accent-hover: #1d4ed8;
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  --max-width: 960px;
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 2rem;
  --spacing-xl: 4rem;
  --radius: 6px;
  --shadow: 0 1px 3px rgba(0,0,0,0.1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f0f0f;
    --color-text: #e5e5e5;
    --color-text-muted: #999;
    --color-border: #333;
  }
}

*, *::before, *::after {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

body {
  margin: 0;
  padding: var(--spacing-lg);
  font-family: var(--font-sans);
  background: var(--color-bg);
  color: var(--color-text);
}

.content-wrapper {
  max-width: var(--max-width);
  margin: 0 auto;
}

/* Block spacing */
.block {
  margin-bottom: var(--spacing-lg);
}

.block:last-child {
  margin-bottom: 0;
}

/* Markdown block styles */
.markdown-block h1 {
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0 0 var(--spacing-md);
}

.markdown-block h2 {
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.3;
  margin: var(--spacing-lg) 0 var(--spacing-md);
}

.markdown-block h3 {
  font-size: 1.35rem;
  font-weight: 600;
  margin: var(--spacing-md) 0 var(--spacing-sm);
}

.markdown-block p {
  margin: 0 0 var(--spacing-md);
}

.markdown-block a {
  color: var(--color-accent);
  text-decoration: none;
}

.markdown-block a:hover {
  text-decoration: underline;
}

.markdown-block code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--color-border);
  padding: 0.125em 0.375em;
  border-radius: 3px;
}

.markdown-block pre {
  background: var(--color-border);
  padding: var(--spacing-md);
  border-radius: var(--radius);
  overflow-x: auto;
}

.markdown-block pre code {
  background: none;
  padding: 0;
}

.markdown-block ul, .markdown-block ol {
  margin: 0 0 var(--spacing-md);
  padding-left: var(--spacing-lg);
}

.markdown-block blockquote {
  margin: var(--spacing-md) 0;
  padding-left: var(--spacing-md);
  border-left: 4px solid var(--color-accent);
  color: var(--color-text-muted);
}

/* Table styles */
.table-block {
  overflow-x: auto;
}

.table-block table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9375rem;
}

.table-block caption {
  text-align: left;
  font-weight: 600;
  margin-bottom: var(--spacing-sm);
  color: var(--color-text-muted);
}

.table-block th,
.table-block td {
  text-align: left;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}

.table-block th {
  font-weight: 600;
  background: var(--color-border);
}

.table-block tr:hover td {
  background: rgba(0,0,0,0.02);
}

@media (prefers-color-scheme: dark) {
  .table-block tr:hover td {
    background: rgba(255,255,255,0.02);
  }
}

/* Image styles */
.image-block {
  text-align: center;
}

.image-block figure {
  margin: 0;
  display: inline-block;
}

.image-block img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.image-block figcaption {
  margin-top: var(--spacing-sm);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

/* Video styles */
.video-block {
  position: relative;
  padding-bottom: 56.25%; /* 16:9 aspect ratio */
  height: 0;
  overflow: hidden;
  border-radius: var(--radius);
  background: #000;
}

.video-block video,
.video-block iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.video-block.native {
  padding-bottom: 0;
  height: auto;
}

.video-block.native video {
  position: relative;
  border-radius: var(--radius);
}

/* Iframe styles */
.iframe-block {
  border-radius: var(--radius);
  overflow: hidden;
  box-shadow: var(--shadow);
}

.iframe-block iframe {
  display: block;
  width: 100%;
  border: none;
}

/* Canvas styles */
.canvas-block {
  text-align: center;
}

.canvas-block canvas {
  max-width: 100%;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.canvas-block .canvas-caption {
  margin-top: var(--spacing-sm);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}
`;