/**
 * @fileoverview MCP tools for querying available tools
 * @module mcp/tools/tool-tools
 */

/**
 * Create tool-related MCP tools
 * @param {import('../../lib/tool-router.js').ToolRouter} toolRouter
 * @returns {Object[]}
 */
export function createToolTools(toolRouter) {
  return [
    {
      schema: {
        name: 'tools_list',
        description: 'List all available tools from the Tool Router with their schemas',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      handler: async () => {
        const manifest = toolRouter.getManifest();
        return {
          content: [{ type: 'text', text: JSON.stringify(manifest, null, 2) }]
        };
      }
    },
    
    {
      schema: {
        name: 'tools_get',
        description: 'Get detailed information about a specific tool',
        inputSchema: {
          type: 'object',
          properties: {
            toolName: {
              type: 'string',
              description: 'Name of the tool to retrieve'
            }
          },
          required: ['toolName']
        }
      },
      handler: async (args) => {
        const tool = toolRouter.getTool(args.toolName);
        
        if (!tool) {
          return {
            content: [{ type: 'text', text: `Tool not found: ${args.toolName}` }],
            isError: true
          };
        }
        
        return {
          content: [{ type: 'text', text: JSON.stringify(tool.schema, null, 2) }]
        };
      }
    }
  ];
}

export default createToolTools;
