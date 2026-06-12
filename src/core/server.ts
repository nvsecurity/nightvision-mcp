import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Read the server version from package.json so the version advertised in the
 * MCP handshake stays in sync with the package and never drifts. From the
 * compiled location (build/core/server.js) package.json sits two levels up.
 * @returns The package version, or "0.0.0" if it cannot be read
 */
function packageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Create and configure a new MCP server instance
 * @returns Configured MCP server
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "NightVision Scanner",
    version: packageVersion(),
  }, {
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