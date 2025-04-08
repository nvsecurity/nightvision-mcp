import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Create and configure a new MCP server instance
 * @returns Configured MCP server
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "NightVision Scanner",
    version: "1.0.0",
    capabilities: {
      tools: {},
    }
  });
  
  return server;
}

/**
 * Connect the MCP server to stdio transport
 * @param server MCP server instance
 * @returns Promise resolving when connected
 */
export async function connectServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("NightVision MCP Server running...");
} 