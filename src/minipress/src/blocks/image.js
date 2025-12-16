/**
 * Image Block Generator
 * Creates image elements with optional captions
 */

import { escapeHtml, escapeAttr, generateId } from "../utils/template.js";

/**
 * Generate HTML image from block configuration
 * @param {Object} block - Block configuration
 * @param {string} block.src - Image source URL
 * @param {string} [block.alt] - Alt text for accessibility
 * @param {string} [block.caption] - Image caption
 * @param {string} [block.id] - Optional element ID
 * @param {string} [block.class] - Additional CSS classes
 * @param {number|string} [block.width] - Image width
 * @param {number|string} [block.height] - Image height
 * @param {boolean} [block.lazy] - Enable lazy loading (default: true)
 * @param {string} [block.link] - Wrap image in link
 * @param {string} [block.align] - Alignment (left, center, right)
 * @returns {string} HTML string
 * 
 * @example
 * {
 *   type: "image",
 *   src: "https://example.com/photo.jpg",
 *   alt: "A beautiful sunset",
 *   caption: "Sunset over the mountains",
 *   width: 800,
 *   link: "https://example.com/photo-full.jpg"
 * }
 */
export function generateImage(block) {
  const {
    src,
    alt = "",
    caption,
    id,
    class: className,
    width,
    height,
    lazy = true,
    link,
    align = "center",
  } = block;

  if (!src) {
    throw new Error("Image block requires 'src' property");
  }

  const blockId = id || generateId("img");
  const classes = [
    "block",
    "image-block",
    `image-align-${align}`,
    className,
  ].filter(Boolean).join(" ");

  // Build img attributes
  const imgAttrs = [
    `src="${escapeAttr(src)}"`,
    `alt="${escapeAttr(alt)}"`,
    lazy && `loading="lazy"`,
    width && `width="${width}"`,
    height && `height="${height}"`,
  ].filter(Boolean).join(" ");

  // Build image element
  let imgElement = `<img ${imgAttrs}>`;

  // Wrap in link if specified
  if (link) {
    imgElement = `<a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer">${imgElement}</a>`;
  }

  // If no caption, return simple structure
  if (!caption) {
    return `<div id="${blockId}" class="${classes}">
  ${imgElement}
</div>`;
  }

  // With caption, use figure/figcaption
  return `<div id="${blockId}" class="${classes}">
  <figure>
    ${imgElement}
    <figcaption>${escapeHtml(caption)}</figcaption>
  </figure>
</div>`;
}

/**
 * Generate responsive image with srcset
 * @param {Object} block - Block configuration
 * @param {Object} block.srcset - Source set object {width: url}
 * @param {string} block.src - Fallback source
 * @param {string} [block.sizes] - Sizes attribute
 * @returns {string} HTML string
 * 
 * @example
 * {
 *   type: "image",
 *   src: "photo-800.jpg",
 *   srcset: {
 *     400: "photo-400.jpg",
 *     800: "photo-800.jpg",
 *     1200: "photo-1200.jpg"
 *   },
 *   sizes: "(max-width: 600px) 400px, (max-width: 900px) 800px, 1200px"
 * }
 */
export function generateResponsiveImage(block) {
  const {
    src,
    srcset,
    sizes,
    alt = "",
    caption,
    id,
    class: className,
    lazy = true,
  } = block;

  if (!src || !srcset) {
    throw new Error("Responsive image requires 'src' and 'srcset' properties");
  }

  const blockId = id || generateId("img");
  const classes = ["block", "image-block", className].filter(Boolean).join(" ");

  // Build srcset string
  const srcsetStr = Object.entries(srcset)
    .map(([width, url]) => `${escapeAttr(url)} ${width}w`)
    .join(", ");

  const imgAttrs = [
    `src="${escapeAttr(src)}"`,
    `srcset="${srcsetStr}"`,
    sizes && `sizes="${escapeAttr(sizes)}"`,
    `alt="${escapeAttr(alt)}"`,
    lazy && `loading="lazy"`,
  ].filter(Boolean).join(" ");

  let html = `<div id="${blockId}" class="${classes}">`;

  if (caption) {
    html += `\n  <figure>\n    <img ${imgAttrs}>\n    <figcaption>${escapeHtml(caption)}</figcaption>\n  </figure>`;
  } else {
    html += `\n  <img ${imgAttrs}>`;
  }

  html += `\n</div>`;

  return html;
}

/**
 * Generate image gallery
 * @param {Object[]} images - Array of image configurations
 * @param {Object} [options] - Gallery options
 * @returns {string} HTML string
 */
export function generateGallery(images, options = {}) {
  const { columns = 3, gap = "1rem", id, class: className } = options;

  const galleryId = id || generateId("gallery");
  const classes = ["block", "image-gallery", className].filter(Boolean).join(" ");

  let html = `<div id="${galleryId}" class="${classes}" style="display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${gap};">`;

  for (const img of images) {
    html += `\n  ${generateImage({ ...img, class: "gallery-item" })}`;
  }

  html += `\n</div>`;

  return html;
}
