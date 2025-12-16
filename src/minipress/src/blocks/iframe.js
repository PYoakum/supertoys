/**
 * Iframe Block Generator
 * Creates embedded iframe elements for external content
 */

import { escapeAttr, generateId } from "../utils/template.js";

/**
 * Generate HTML iframe from block configuration
 * @param {Object} block - Block configuration
 * @param {string} block.src - Iframe source URL
 * @param {string} [block.id] - Optional element ID
 * @param {string} [block.class] - Additional CSS classes
 * @param {number|string} [block.width] - Iframe width (default: 100%)
 * @param {number|string} [block.height] - Iframe height (default: 400)
 * @param {string} [block.title] - Accessibility title
 * @param {string} [block.sandbox] - Sandbox permissions
 * @param {string} [block.allow] - Feature policy
 * @param {boolean} [block.allowfullscreen] - Allow fullscreen
 * @param {string} [block.loading] - Loading strategy (lazy, eager)
 * @param {string} [block.referrerpolicy] - Referrer policy
 * @param {string} [block.aspectRatio] - Aspect ratio (e.g., "16:9")
 * @returns {string} HTML string
 * 
 * @example
 * {
 *   type: "iframe",
 *   src: "https://example.com/embed",
 *   title: "Example Widget",
 *   width: "100%",
 *   height: 500,
 *   sandbox: "allow-scripts allow-same-origin"
 * }
 * 
 * @example
 * // With aspect ratio (responsive)
 * {
 *   type: "iframe",
 *   src: "https://example.com/map",
 *   aspectRatio: "4:3",
 *   title: "Map embed"
 * }
 */
export function generateIframe(block) {
  const {
    src,
    id,
    class: className,
    width = "100%",
    height = 400,
    title = "Embedded content",
    sandbox,
    allow,
    allowfullscreen = true,
    loading = "lazy",
    referrerpolicy = "no-referrer-when-downgrade",
    aspectRatio,
    srcdoc,
  } = block;

  if (!src && !srcdoc) {
    throw new Error("Iframe block requires 'src' or 'srcdoc' property");
  }

  const blockId = id || generateId("iframe");
  const classes = [
    "block",
    "iframe-block",
    aspectRatio && "iframe-responsive",
    className,
  ].filter(Boolean).join(" ");

  // Build iframe attributes
  const iframeAttrs = [
    src && `src="${escapeAttr(src)}"`,
    srcdoc && `srcdoc="${escapeAttr(srcdoc)}"`,
    `title="${escapeAttr(title)}"`,
    !aspectRatio && `width="${width}"`,
    !aspectRatio && `height="${height}"`,
    sandbox && `sandbox="${escapeAttr(sandbox)}"`,
    allow && `allow="${escapeAttr(allow)}"`,
    allowfullscreen && "allowfullscreen",
    `loading="${loading}"`,
    referrerpolicy && `referrerpolicy="${referrerpolicy}"`,
  ].filter(Boolean).join(" ");

  // If aspect ratio is specified, create responsive wrapper
  if (aspectRatio) {
    const [w, h] = aspectRatio.split(":").map(Number);
    const paddingBottom = `${(h / w) * 100}%`;

    return `<div id="${blockId}" class="${classes}">
  <div style="position: relative; padding-bottom: ${paddingBottom}; height: 0; overflow: hidden;">
    <iframe ${iframeAttrs} style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"></iframe>
  </div>
</div>`;
  }

  return `<div id="${blockId}" class="${classes}">
  <iframe ${iframeAttrs}></iframe>
</div>`;
}

/**
 * Common iframe presets for popular services
 */
export const iframePresets = {
  /**
   * Google Maps embed
   */
  googleMaps: (params) => ({
    type: "iframe",
    src: `https://www.google.com/maps/embed/v1/place?key=${params.apiKey}&q=${encodeURIComponent(params.query)}`,
    title: params.title || "Google Maps",
    aspectRatio: params.aspectRatio || "16:9",
    allow: "fullscreen",
    loading: "lazy",
    ...params,
  }),

  /**
   * Google Forms embed
   */
  googleForms: (params) => ({
    type: "iframe",
    src: params.formUrl.replace("/viewform", "/viewform?embedded=true"),
    title: params.title || "Google Form",
    width: params.width || "100%",
    height: params.height || 800,
    ...params,
  }),

  /**
   * CodePen embed
   */
  codepen: (params) => {
    const { user, pen, theme = "dark", defaultTab = "result" } = params;
    return {
      type: "iframe",
      src: `https://codepen.io/${user}/embed/${pen}?default-tab=${defaultTab}&theme-id=${theme}`,
      title: params.title || "CodePen Embed",
      height: params.height || 400,
      width: "100%",
      allowfullscreen: true,
      ...params,
    };
  },

  /**
   * Twitter/X embed (requires widget.js loaded separately)
   */
  twitter: (params) => ({
    type: "iframe",
    src: `https://platform.twitter.com/embed/Tweet.html?id=${params.tweetId}`,
    title: params.title || "Tweet",
    width: params.width || 550,
    height: params.height || 300,
    ...params,
  }),

  /**
   * Spotify embed
   */
  spotify: (params) => {
    const { type, id, theme = "0" } = params;
    return {
      type: "iframe",
      src: `https://open.spotify.com/embed/${type}/${id}?theme=${theme}`,
      title: params.title || "Spotify Player",
      width: "100%",
      height: type === "track" ? 152 : 380,
      allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
      loading: "lazy",
      ...params,
    };
  },

  /**
   * SoundCloud embed
   */
  soundcloud: (params) => ({
    type: "iframe",
    src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(params.url)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true`,
    title: params.title || "SoundCloud Player",
    width: "100%",
    height: params.visual ? 300 : 166,
    allow: "autoplay",
    ...params,
  }),

  /**
   * Figma embed
   */
  figma: (params) => ({
    type: "iframe",
    src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(params.url)}`,
    title: params.title || "Figma Design",
    aspectRatio: params.aspectRatio || "16:9",
    allowfullscreen: true,
    ...params,
  }),
};

/**
 * Generate iframe from preset
 * @param {string} presetName - Name of the preset
 * @param {Object} params - Preset parameters
 * @returns {string} HTML string
 */
export function generateFromPreset(presetName, params) {
  const preset = iframePresets[presetName];
  if (!preset) {
    throw new Error(`Unknown iframe preset: '${presetName}'. Available: ${Object.keys(iframePresets).join(", ")}`);
  }
  const config = preset(params);
  return generateIframe(config);
}
