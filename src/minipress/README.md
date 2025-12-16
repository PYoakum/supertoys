# HTML Blocks CLI

A powerful CLI tool for the Bun runtime that converts JSON/JS configurations into HTML documents with predefined content blocks.

## Installation

```bash
# Clone or download the project
cd html-blocks-cli

# Install dependencies
bun install

# Make CLI executable globally (optional)
bun link
```

## Quick Start

```bash
# Basic usage - output to stdout
bun run src/cli.js config.json

# Output to file
bun run src/cli.js config.json -o output.html

# Use JavaScript configuration
bun run src/cli.js config.js -o output.html

# Fragment only (no HTML wrapper)
bun run src/cli.js config.json -f

# Custom title and styles
bun run src/cli.js config.json -t "My Page" -s custom.css -o page.html
```

## Configuration Format

### JSON Format

```json
{
  "blocks": [
    {
      "type": "markdown",
      "content": "# Hello World\n\nThis is **bold** text."
    },
    {
      "type": "table",
      "headers": ["Name", "Value"],
      "rows": [["Item 1", "100"], ["Item 2", "200"]]
    }
  ]
}
```

### JavaScript Format

```javascript
export default {
  blocks: [
    {
      type: "markdown",
      content: `# Generated at ${new Date().toISOString()}`
    }
  ]
};
```

## Block Types

### Markdown

Renders GitHub Flavored Markdown content.

```json
{
  "type": "markdown",
  "content": "# Heading\n\nParagraph with **bold** and *italic*.",
  "class": "intro-section"
}
```

### Table

Creates data tables from arrays or objects.

```json
{
  "type": "table",
  "caption": "Sales Data",
  "headers": ["Product", "Q1", "Q2"],
  "rows": [
    ["Widget A", 100, 150],
    ["Widget B", 80, 90]
  ],
  "columnAlign": { "1": "right", "2": "right" }
}
```

Or use objects (headers auto-detected):

```json
{
  "type": "table",
  "rows": [
    { "name": "Alice", "age": 30 },
    { "name": "Bob", "age": 25 }
  ]
}
```

### Image

Displays images with optional captions.

```json
{
  "type": "image",
  "src": "https://example.com/photo.jpg",
  "alt": "Description",
  "caption": "Photo caption",
  "width": 800,
  "lazy": true,
  "link": "https://example.com/full-size.jpg"
}
```

### Video

Embeds videos from YouTube, Vimeo, or native sources.

```json
{
  "type": "video",
  "provider": "youtube",
  "src": "dQw4w9WgXcQ",
  "autoplay": false,
  "controls": true
}
```

Native video:

```json
{
  "type": "video",
  "provider": "native",
  "src": "video.mp4",
  "poster": "poster.jpg",
  "controls": true
}
```

### Iframe

Embeds external content via iframes.

```json
{
  "type": "iframe",
  "src": "https://example.com/embed",
  "title": "Embedded Widget",
  "width": "100%",
  "height": 500,
  "aspectRatio": "16:9",
  "sandbox": "allow-scripts allow-same-origin"
}
```

### Canvas

Creates canvas elements with custom client-side scripts.

```json
{
  "type": "canvas",
  "width": 600,
  "height": 400,
  "caption": "Interactive Chart",
  "responsive": true,
  "data": {
    "values": [10, 20, 30, 40]
  },
  "script": "function init(canvas, ctx, data, config) { /* drawing code */ }"
}
```

The `init` function receives:
- `canvas` - The canvas DOM element
- `ctx` - The 2D rendering context
- `data` - Your custom data object
- `config` - Block configuration (width, height, etc.)

## CLI Options

| Option | Short | Description |
|--------|-------|-------------|
| `--output` | `-o` | Output file path |
| `--title` | `-t` | Document title |
| `--fragment` | `-f` | Output HTML fragment only |
| `--pretty` | `-p` | Pretty print output |
| `--style` | `-s` | Custom CSS file path |
| `--help` | `-h` | Show help |
| `--version` | `-v` | Show version |

## Examples

Run the included examples:

```bash
# JSON example
bun run src/cli.js examples/sample.json -o demo.html

# JavaScript example
bun run src/cli.js examples/sample.js -o report.html -t "Sales Report"
```

## Project Structure

```
html-blocks-cli/
├── src/
│   ├── cli.js              # Main CLI entry point
│   ├── blocks/
│   │   ├── markdown.js     # Markdown block generator
│   │   ├── table.js        # Table block generator
│   │   ├── image.js        # Image block generator
│   │   ├── video.js        # Video block generator
│   │   ├── iframe.js       # Iframe block generator
│   │   └── canvas.js       # Canvas block generator
│   └── utils/
│       ├── processor.js    # Input processor
│       └── template.js     # HTML template wrapper
├── examples/
│   ├── sample.json         # JSON configuration example
│   └── sample.js           # JavaScript configuration example
├── package.json
└── README.md
```

## Extending

### Custom Block Types

You can register custom block generators:

```javascript
import { registerBlockType } from "./src/utils/processor.js";

registerBlockType("custom", (block) => {
  return `<div class="custom">${block.content}</div>`;
});
```

### Canvas Templates

The canvas block includes predefined templates:

```javascript
import { canvasTemplates, generateFromTemplate } from "./src/blocks/canvas.js";

// Available templates: barChart, particles, drawing
const chart = generateFromTemplate("barChart", {
  labels: ["A", "B", "C"],
  values: [10, 20, 30]
});
```

### Iframe Presets

Common iframe configurations:

```javascript
import { iframePresets, generateFromPreset } from "./src/blocks/iframe.js";

// Available: googleMaps, googleForms, codepen, spotify, soundcloud, figma
const embed = generateFromPreset("spotify", {
  type: "track",
  id: "4uLU6hMCjMI75M1A2tKUQC"
});
```

## License

MIT
