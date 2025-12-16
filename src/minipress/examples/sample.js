/**
 * Sample JavaScript Configuration
 * 
 * Using JS files allows for dynamic content generation,
 * data fetching, and more complex logic.
 */

// Dynamic data generation
const generateSalesData = () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  return months.map(month => ({
    month,
    sales: Math.floor(Math.random() * 100) + 50,
    growth: (Math.random() * 20 - 5).toFixed(1) + '%'
  }));
};

const salesData = generateSalesData();

// Export configuration
export default {
  blocks: [
    {
      type: "markdown",
      content: `
# Monthly Sales Report

Generated on: **${new Date().toLocaleDateString()}**

This report showcases the power of using JavaScript configuration files with HTML Blocks CLI.

## Key Highlights

- Dynamic data generation
- Template literals for complex content
- Conditional rendering
- Module imports and exports
      `.trim()
    },

    {
      type: "table",
      caption: "Monthly Sales Performance",
      rows: salesData,
    },

    {
      type: "markdown",
      content: `
## Performance Analysis

The data above was dynamically generated to demonstrate the capabilities of JS configuration files. In a real scenario, you might:

1. Fetch data from an API
2. Read from a database
3. Process CSV files
4. Combine multiple data sources
      `.trim()
    },

    {
      type: "canvas",
      width: 700,
      height: 350,
      caption: "Sales Visualization",
      responsive: true,
      data: {
        labels: salesData.map(d => d.month),
        values: salesData.map(d => d.sales),
        colors: ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e']
      },
      script: `
function init(canvas, ctx, data, config) {
  const { labels, values, colors } = data;
  const padding = { top: 40, right: 30, bottom: 50, left: 50 };
  const chartWidth = config.width - padding.left - padding.right;
  const chartHeight = config.height - padding.top - padding.bottom;
  
  const maxValue = Math.max(...values);
  const barWidth = chartWidth / values.length - 15;
  
  // Background
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, config.width, config.height);
  
  // Title
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 16px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Monthly Sales', config.width / 2, 25);
  
  // Grid lines
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(config.width - padding.right, y);
    ctx.stroke();
    
    // Y-axis labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'right';
    const value = Math.round(maxValue - (maxValue / 5) * i);
    ctx.fillText(value.toString(), padding.left - 10, y + 4);
  }
  
  // Bars with animation
  let animProgress = 0;
  
  function animate() {
    animProgress = Math.min(animProgress + 0.03, 1);
    
    // Clear chart area
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);
    
    // Redraw grid
    ctx.strokeStyle = '#e5e7eb';
    for (let i = 0; i <= 5; i++) {
      const y = padding.top + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(config.width - padding.right, y);
      ctx.stroke();
    }
    
    // Draw bars
    values.forEach((value, i) => {
      const barHeight = (value / maxValue) * chartHeight * animProgress;
      const x = padding.left + i * (barWidth + 15) + 7.5;
      const y = padding.top + chartHeight - barHeight;
      
      // Bar shadow
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(x + 3, y + 3, barWidth, barHeight);
      
      // Bar
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, y, barWidth, barHeight);
      
      // Value on top
      if (animProgress > 0.9) {
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(value.toString(), x + barWidth / 2, y - 8);
      }
      
      // Label below
      ctx.fillStyle = '#4b5563';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barWidth / 2, config.height - padding.bottom + 20);
    });
    
    if (animProgress < 1) {
      requestAnimationFrame(animate);
    }
  }
  
  animate();
}
      `.trim()
    },

    {
      type: "markdown",
      content: `
## Features Demonstrated

| Feature | Description |
|---------|-------------|
| Dynamic Data | Generated at build time using JS functions |
| Template Literals | Complex markdown with embedded expressions |
| ES Modules | Clean export/import syntax |
| Animated Canvas | Smooth bar chart with entry animation |

---

*This document was generated using HTML Blocks CLI*
      `.trim()
    }
  ]
};
