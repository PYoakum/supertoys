/**
 * Input Processor
 * Processes configuration objects and generates HTML from blocks
 */

import { generateMarkdown } from "../blocks/markdown.js";
import { generateTable } from "../blocks/table.js";
import { generateImage } from "../blocks/image.js";
import { generateVideo } from "../blocks/video.js";
import { generateIframe } from "../blocks/iframe.js";
import { generateCanvas } from "../blocks/canvas.js";

const blockGenerators = {
  markdown: generateMarkdown,
  table: generateTable,
  image: generateImage,
  video: generateVideo,
  iframe: generateIframe,
  canvas: generateCanvas,
};

/**
 * Process input configuration and generate HTML
 * @param {Object|Array} config - Configuration object or array of blocks
 * @returns {Promise<string>} Generated HTML content
 */
export async function processInput(config) {
  // Normalize config to array of blocks
  let blocks;
  
  if (Array.isArray(config)) {
    blocks = config;
  } else if (config.blocks && Array.isArray(config.blocks)) {
    blocks = config.blocks;
  } else if (config.type) {
    // Single block object
    blocks = [config];
  } else {
    throw new Error("Invalid configuration format. Expected array of blocks or object with 'blocks' property.");
  }

  const htmlParts = [];
  const clientScripts = [];

  for (const block of blocks) {
    if (!block.type) {
      throw new Error(`Block is missing 'type' property: ${JSON.stringify(block)}`);
    }

    const generator = blockGenerators[block.type];
    
    if (!generator) {
      throw new Error(`Unknown block type: '${block.type}'. Available types: ${Object.keys(blockGenerators).join(", ")}`);
    }

    const result = await generator(block);
    
    if (typeof result === "string") {
      htmlParts.push(result);
    } else if (result && typeof result === "object") {
      // Block returned HTML and client script
      if (result.html) htmlParts.push(result.html);
      if (result.script) clientScripts.push(result.script);
    }
  }

  let html = htmlParts.join("\n\n");

  // Append client scripts if any
  if (clientScripts.length > 0) {
    html += `\n\n<script>\n(function() {\n${clientScripts.join("\n\n")}\n})();\n</script>`;
  }

  return html;
}

/**
 * Get list of available block types
 * @returns {string[]} Array of block type names
 */
export function getAvailableBlockTypes() {
  return Object.keys(blockGenerators);
}

/**
 * Register a custom block generator
 * @param {string} type - Block type name
 * @param {Function} generator - Generator function
 */
export function registerBlockType(type, generator) {
  if (typeof generator !== "function") {
    throw new Error("Generator must be a function");
  }
  blockGenerators[type] = generator;
}
