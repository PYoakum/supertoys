/**
 * Canvas Block Generator
 * Creates canvas elements with associated client-side scripts
 */

import { escapeHtml, escapeAttr, generateId } from "../utils/template.js";

/**
 * Generate HTML canvas from block configuration
 * @param {Object} block - Block configuration
 * @param {number} [block.width] - Canvas width (default: 800)
 * @param {number} [block.height] - Canvas height (default: 600)
 * @param {string} [block.id] - Optional element ID
 * @param {string} [block.class] - Additional CSS classes
 * @param {string} [block.caption] - Canvas caption
 * @param {string} [block.script] - Client-side JavaScript code
 * @param {string} [block.scriptSrc] - External script URL
 * @param {Object} [block.data] - Data to pass to the script
 * @param {string} [block.init] - Initialization function name (default: 'init')
 * @param {boolean} [block.responsive] - Make canvas responsive
 * @param {string} [block.background] - Canvas background color
 * @returns {Object} Object with html and script properties
 * 
 * @example
 * {
 *   type: "canvas",
 *   width: 600,
 *   height: 400,
 *   caption: "Interactive Chart",
 *   script: `
 *     function init(canvas, ctx, data) {
 *       ctx.fillStyle = '#3b82f6';
 *       ctx.fillRect(50, 50, 200, 100);
 *     }
 *   `,
 *   data: { values: [10, 20, 30] }
 * }
 */
export function generateCanvas(block) {
  const {
    width = 800,
    height = 600,
    id,
    class: className,
    caption,
    script,
    scriptSrc,
    data = {},
    init = "init",
    responsive = false,
    background,
    contextType = "2d",
  } = block;

  if (!script && !scriptSrc) {
    // Return canvas without script
    return generateCanvasHtml(block);
  }

  const canvasId = id || generateId("canvas");
  const classes = [
    "block",
    "canvas-block",
    responsive && "canvas-responsive",
    className,
  ].filter(Boolean).join(" ");

  // Build canvas attributes
  const canvasAttrs = [
    `id="${canvasId}"`,
    `width="${width}"`,
    `height="${height}"`,
    background && `style="background: ${escapeAttr(background)}"`,
  ].filter(Boolean).join(" ");

  let html = `<div class="${classes}">
  <canvas ${canvasAttrs}></canvas>`;

  if (caption) {
    html += `\n  <div class="canvas-caption">${escapeHtml(caption)}</div>`;
  }

  html += `\n</div>`;

  // Generate client-side script
  const clientScript = generateCanvasScript({
    canvasId,
    script,
    scriptSrc,
    data,
    init,
    contextType,
    width,
    height,
    responsive,
  });

  return {
    html,
    script: clientScript,
  };
}

/**
 * Generate canvas HTML without script
 */
function generateCanvasHtml(block) {
  const {
    width = 800,
    height = 600,
    id,
    class: className,
    caption,
    background,
  } = block;

  const canvasId = id || generateId("canvas");
  const classes = ["block", "canvas-block", className].filter(Boolean).join(" ");

  const canvasAttrs = [
    `id="${canvasId}"`,
    `width="${width}"`,
    `height="${height}"`,
    background && `style="background: ${escapeAttr(background)}"`,
  ].filter(Boolean).join(" ");

  let html = `<div class="${classes}">
  <canvas ${canvasAttrs}></canvas>`;

  if (caption) {
    html += `\n  <div class="canvas-caption">${escapeHtml(caption)}</div>`;
  }

  html += `\n</div>`;

  return html;
}

/**
 * Generate client-side script for canvas
 */
function generateCanvasScript(config) {
  const {
    canvasId,
    script,
    scriptSrc,
    data,
    init,
    contextType,
    width,
    height,
    responsive,
  } = config;

  const dataJson = JSON.stringify(data);

  let scriptContent = `
// Canvas: ${canvasId}
(function() {
  const canvas = document.getElementById('${canvasId}');
  if (!canvas) {
    console.error('Canvas not found: ${canvasId}');
    return;
  }
  
  const ctx = canvas.getContext('${contextType}');
  const data = ${dataJson};
  const config = {
    width: ${width},
    height: ${height},
    contextType: '${contextType}'
  };`;

  if (responsive) {
    scriptContent += `
  
  // Responsive canvas handling
  function resizeCanvas() {
    const container = canvas.parentElement;
    const aspectRatio = ${width} / ${height};
    const containerWidth = container.clientWidth;
    const newWidth = Math.min(containerWidth, ${width});
    const newHeight = newWidth / aspectRatio;
    
    canvas.style.width = newWidth + 'px';
    canvas.style.height = newHeight + 'px';
  }
  
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();`;
  }

  if (script) {
    scriptContent += `
  
  // User-defined script
  ${script}
  
  // Initialize
  if (typeof ${init} === 'function') {
    ${init}(canvas, ctx, data, config);
  }`;
  }

  if (scriptSrc) {
    scriptContent += `
  
  // Load external script
  const scriptEl = document.createElement('script');
  scriptEl.src = '${escapeAttr(scriptSrc)}';
  scriptEl.onload = function() {
    if (typeof ${init} === 'function') {
      ${init}(canvas, ctx, data, config);
    }
  };
  document.body.appendChild(scriptEl);`;
  }

  scriptContent += `
})();`;

  return scriptContent;
}

/**
 * Predefined canvas templates
 */
export const canvasTemplates = {
  /**
   * Simple bar chart
   */
  barChart: (params) => ({
    type: "canvas",
    width: params.width || 600,
    height: params.height || 400,
    caption: params.caption || "Bar Chart",
    data: {
      labels: params.labels || [],
      values: params.values || [],
      colors: params.colors || ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"],
    },
    script: `
function init(canvas, ctx, data, config) {
  const { labels, values, colors } = data;
  const padding = 50;
  const chartWidth = config.width - padding * 2;
  const chartHeight = config.height - padding * 2;
  const barWidth = chartWidth / values.length - 10;
  const maxValue = Math.max(...values);
  
  // Clear canvas
  ctx.clearRect(0, 0, config.width, config.height);
  
  // Draw bars
  values.forEach((value, i) => {
    const barHeight = (value / maxValue) * chartHeight;
    const x = padding + i * (barWidth + 10);
    const y = config.height - padding - barHeight;
    
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Draw label
    ctx.fillStyle = '#666';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i] || '', x + barWidth / 2, config.height - padding + 20);
    
    // Draw value
    ctx.fillText(value, x + barWidth / 2, y - 10);
  });
}`,
    ...params,
  }),

  /**
   * Animated particles
   */
  particles: (params) => ({
    type: "canvas",
    width: params.width || 800,
    height: params.height || 400,
    caption: params.caption,
    background: params.background || "#0f172a",
    data: {
      count: params.count || 100,
      color: params.color || "#3b82f6",
      maxSpeed: params.maxSpeed || 2,
    },
    script: `
function init(canvas, ctx, data, config) {
  const particles = [];
  
  // Create particles
  for (let i = 0; i < data.count; i++) {
    particles.push({
      x: Math.random() * config.width,
      y: Math.random() * config.height,
      vx: (Math.random() - 0.5) * data.maxSpeed,
      vy: (Math.random() - 0.5) * data.maxSpeed,
      radius: Math.random() * 3 + 1
    });
  }
  
  function animate() {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
    ctx.fillRect(0, 0, config.width, config.height);
    
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      
      if (p.x < 0 || p.x > config.width) p.vx *= -1;
      if (p.y < 0 || p.y > config.height) p.vy *= -1;
      
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = data.color;
      ctx.fill();
    });
    
    requestAnimationFrame(animate);
  }
  
  animate();
}`,
    ...params,
  }),

  /**
   * Drawing canvas with mouse support
   */
  drawing: (params) => ({
    type: "canvas",
    width: params.width || 600,
    height: params.height || 400,
    caption: params.caption || "Draw something!",
    background: params.background || "#fff",
    data: {
      strokeColor: params.strokeColor || "#000",
      lineWidth: params.lineWidth || 3,
    },
    script: `
function init(canvas, ctx, data, config) {
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  
  ctx.strokeStyle = data.strokeColor;
  ctx.lineWidth = data.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }
  
  function startDraw(e) {
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
  }
  
  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    
    lastX = pos.x;
    lastY = pos.y;
  }
  
  function stopDraw() {
    isDrawing = false;
  }
  
  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('mouseout', stopDraw);
  
  canvas.addEventListener('touchstart', startDraw);
  canvas.addEventListener('touchmove', draw);
  canvas.addEventListener('touchend', stopDraw);
}`,
    ...params,
  }),
};

/**
 * Generate canvas from template
 * @param {string} templateName - Template name
 * @param {Object} params - Template parameters
 * @returns {Object} Canvas block result
 */
export function generateFromTemplate(templateName, params = {}) {
  const template = canvasTemplates[templateName];
  if (!template) {
    throw new Error(`Unknown canvas template: '${templateName}'. Available: ${Object.keys(canvasTemplates).join(", ")}`);
  }
  const config = template(params);
  return generateCanvas(config);
}
