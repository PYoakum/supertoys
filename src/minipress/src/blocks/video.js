/**
 * Video Block Generator
 * Creates embedded video players for various sources
 */

import { escapeAttr, generateId } from "../utils/template.js";

/**
 * Generate HTML video from block configuration
 * @param {Object} block - Block configuration
 * @param {string} block.src - Video source URL or embed URL
 * @param {string} [block.provider] - Video provider (youtube, vimeo, native)
 * @param {string} [block.id] - Optional element ID
 * @param {string} [block.class] - Additional CSS classes
 * @param {boolean} [block.autoplay] - Enable autoplay
 * @param {boolean} [block.muted] - Mute video (required for autoplay in most browsers)
 * @param {boolean} [block.loop] - Loop video
 * @param {boolean} [block.controls] - Show controls (default: true)
 * @param {string} [block.poster] - Poster image URL (native video only)
 * @param {string} [block.aspectRatio] - Aspect ratio (default: 16:9)
 * @param {number|string} [block.width] - Video width
 * @param {number|string} [block.height] - Video height
 * @returns {string} HTML string
 * 
 * @example
 * // YouTube video
 * {
 *   type: "video",
 *   provider: "youtube",
 *   src: "dQw4w9WgXcQ" // or full URL
 * }
 * 
 * @example
 * // Native video
 * {
 *   type: "video",
 *   provider: "native",
 *   src: "video.mp4",
 *   poster: "poster.jpg",
 *   controls: true,
 *   autoplay: false
 * }
 */
export function generateVideo(block) {
  const {
    src,
    provider,
    id,
    class: className,
    autoplay = false,
    muted = false,
    loop = false,
    controls = true,
    poster,
    aspectRatio = "16:9",
    width,
    height,
    title = "Embedded video",
  } = block;

  if (!src) {
    throw new Error("Video block requires 'src' property");
  }

  const blockId = id || generateId("video");

  // Auto-detect provider from URL
  const detectedProvider = provider || detectProvider(src);

  if (detectedProvider === "native") {
    return generateNativeVideo(block, blockId);
  }

  // Generate embed for YouTube, Vimeo, etc.
  const embedUrl = getEmbedUrl(src, detectedProvider, { autoplay, muted, loop, controls });
  
  const classes = [
    "block",
    "video-block",
    `video-${detectedProvider}`,
    className,
  ].filter(Boolean).join(" ");

  // Calculate padding for aspect ratio
  const [w, h] = aspectRatio.split(":").map(Number);
  const paddingBottom = `${(h / w) * 100}%`;

  const iframeAttrs = [
    `src="${escapeAttr(embedUrl)}"`,
    `title="${escapeAttr(title)}"`,
    `frameborder="0"`,
    `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"`,
    `allowfullscreen`,
    width && `width="${width}"`,
    height && `height="${height}"`,
  ].filter(Boolean).join(" ");

  return `<div id="${blockId}" class="${classes}" style="padding-bottom: ${paddingBottom}">
  <iframe ${iframeAttrs}></iframe>
</div>`;
}

/**
 * Generate native HTML5 video element
 */
function generateNativeVideo(block, blockId) {
  const {
    src,
    sources = [],
    class: className,
    autoplay = false,
    muted = false,
    loop = false,
    controls = true,
    poster,
    preload = "metadata",
    playsinline = true,
    width,
    height,
  } = block;

  const classes = [
    "block",
    "video-block",
    "native",
    className,
  ].filter(Boolean).join(" ");

  const videoAttrs = [
    controls && "controls",
    autoplay && "autoplay",
    muted && "muted",
    loop && "loop",
    playsinline && "playsinline",
    poster && `poster="${escapeAttr(poster)}"`,
    `preload="${preload}"`,
    width && `width="${width}"`,
    height && `height="${height}"`,
  ].filter(Boolean).join(" ");

  // Build source elements
  let sourcesHtml = "";
  
  if (sources.length > 0) {
    // Multiple sources provided
    sourcesHtml = sources
      .map((s) => {
        const type = s.type || getMimeType(s.src);
        return `\n    <source src="${escapeAttr(s.src)}" type="${type}">`;
      })
      .join("");
  } else if (src) {
    // Single source
    const type = getMimeType(src);
    sourcesHtml = `\n    <source src="${escapeAttr(src)}" type="${type}">`;
  }

  return `<div id="${blockId}" class="${classes}">
  <video ${videoAttrs}>${sourcesHtml}
    Your browser does not support the video tag.
  </video>
</div>`;
}

/**
 * Detect video provider from URL
 */
function detectProvider(src) {
  if (src.includes("youtube.com") || src.includes("youtu.be")) {
    return "youtube";
  }
  if (src.includes("vimeo.com")) {
    return "vimeo";
  }
  if (src.includes("dailymotion.com") || src.includes("dai.ly")) {
    return "dailymotion";
  }
  if (src.match(/\.(mp4|webm|ogg|mov)(\?|$)/i)) {
    return "native";
  }
  // Assume YouTube video ID if it's just an alphanumeric string
  if (/^[a-zA-Z0-9_-]{11}$/.test(src)) {
    return "youtube";
  }
  return "native";
}

/**
 * Get embed URL for video providers
 */
function getEmbedUrl(src, provider, options) {
  const { autoplay, muted, loop, controls } = options;

  switch (provider) {
    case "youtube": {
      const videoId = extractYouTubeId(src);
      const params = new URLSearchParams();
      if (autoplay) params.set("autoplay", "1");
      if (muted) params.set("mute", "1");
      if (loop) {
        params.set("loop", "1");
        params.set("playlist", videoId);
      }
      if (!controls) params.set("controls", "0");
      params.set("rel", "0");
      const query = params.toString();
      return `https://www.youtube.com/embed/${videoId}${query ? "?" + query : ""}`;
    }

    case "vimeo": {
      const videoId = extractVimeoId(src);
      const params = new URLSearchParams();
      if (autoplay) params.set("autoplay", "1");
      if (muted) params.set("muted", "1");
      if (loop) params.set("loop", "1");
      const query = params.toString();
      return `https://player.vimeo.com/video/${videoId}${query ? "?" + query : ""}`;
    }

    case "dailymotion": {
      const videoId = extractDailymotionId(src);
      const params = new URLSearchParams();
      if (autoplay) params.set("autoplay", "1");
      if (muted) params.set("mute", "1");
      const query = params.toString();
      return `https://www.dailymotion.com/embed/video/${videoId}${query ? "?" + query : ""}`;
    }

    default:
      return src;
  }
}

/**
 * Extract YouTube video ID from various URL formats
 */
function extractYouTubeId(src) {
  if (/^[a-zA-Z0-9_-]{11}$/.test(src)) return src;
  
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = src.match(pattern);
    if (match) return match[1];
  }

  return src;
}

/**
 * Extract Vimeo video ID
 */
function extractVimeoId(src) {
  const match = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : src;
}

/**
 * Extract Dailymotion video ID
 */
function extractDailymotionId(src) {
  const match = src.match(/(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/);
  return match ? match[1] : src;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(src) {
  const ext = src.split(".").pop().toLowerCase().split("?")[0];
  const types = {
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
  };
  return types[ext] || "video/mp4";
}
