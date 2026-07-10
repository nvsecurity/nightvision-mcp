import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { 
  RecordTrafficParamsSchema,
  ListTrafficParamsSchema,
  DownloadTrafficParamsSchema
} from '../types/index.js';
import { requireAuthenticatedUser, requireProjectAccess } from '../utils/auth-guard.js';
import { resolveDownloadDir } from '../utils/download-path.js';

/**
 * Register traffic-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerTrafficTools(server: McpServer): void {
  /**
   * Record Traffic Tool
   * 
   * Provides a tool to record traffic for a target using browser automation
   */
  server.tool(
    "record-traffic",
    RecordTrafficParamsSchema,
    async (args, _extra) => {
      try {
        const { 
          name,
          url,
          target,
          project,
          format = 'text'
        } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const projectAccess = await requireProjectAccess({
          project,
          action: 'recording traffic'
        });
        if (!projectAccess.ok) return projectAccess.response;
        
        try {
          // Provide information about the browser interaction
          const browserInfo = `
This tool will open a browser window for you to interact with the target application.
1. The browser will open automatically at ${url}
2. Navigate through the application to generate traffic
3. When finished, close the browser window
4. The traffic will be automatically recorded as a HAR file and uploaded to NightVision
`;

          // Record the traffic
          const result = await nightvisionService.recordTraffic(
            name,
            url,
            target,
            project,
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: `${browserInfo}\nTraffic recording completed:\n\n${result}` 
            }]
          };
        } catch (error: any) {
          console.error(`Error recording traffic: ${error.message}`);
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to record traffic: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to record traffic: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * List Traffic Tool
   * 
   * Provides a tool to list traffic files for a target
   */
  server.tool(
    "list-traffic",
    ListTrafficParamsSchema,
    async (args, _extra) => {
      try {
        const { 
          target,
          project,
          format = 'json'
        } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const projectAccess = await requireProjectAccess({
          project,
          action: 'listing traffic'
        });
        if (!projectAccess.ok) return projectAccess.response;
        
        try {
          // List the traffic files
          const result = await nightvisionService.listTraffic(
            target,
            project,
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: `Traffic files for target ${target} in project ${project}:\n\n${result}` 
            }]
          };
        } catch (error: any) {
          console.error(`Error listing traffic files: ${error.message}`);
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to list traffic files: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to list traffic files: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Download Traffic Tool
   * 
   * Provides a tool to download a traffic file (HAR) for a target
   */
  server.tool(
    "download-traffic",
    DownloadTrafficParamsSchema,
    async (args, _extra) => {
      try {
        const { 
          name,
          target,
          project,
          output_file,
          downloadPath: initialDownloadPath,
          format = 'text'
        } = args;
        
        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const projectAccess = await requireProjectAccess({
          project,
          action: 'downloading traffic'
        });
        if (!projectAccess.ok) return projectAccess.response;
        
        // Resolve the download directory (never prompt). A blank or non-absolute
        // request falls back to the home directory; a non-writable directory
        // falls back to the home directory and then the system temp directory.
        const path = await import('path');
        const fs = await import('fs');
        const os = await import('os');

        const isWritable = (dir: string): boolean => {
          try {
            fs.accessSync(dir, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        };
        const downloadPath = resolveDownloadDir(initialDownloadPath, os.homedir(), os.tmpdir(), isWritable);
        console.error(`Resolved download directory: ${downloadPath}`);

        // Determine final output path
        const finalOutputPath = output_file 
          ? (path.isAbsolute(output_file) ? output_file : path.join(downloadPath, output_file))
          : path.join(downloadPath, `${name}.har`);
        
        // Download the traffic file with the provided download path
        const result = await nightvisionService.downloadTraffic(
          name,
          target,
          project,
          finalOutputPath,
          downloadPath,
          format
        );
        
        const downloadMessage = `The traffic file "${name}" has been downloaded for target "${target}" in project "${project}".\n\nThe HAR file is saved at the absolute path: ${finalOutputPath}\n\nDownload directory used: ${downloadPath}`;
        
        // Return the formatted output
        return {
          content: [{ 
            type: "text" as const, 
            text: `${downloadMessage}\n\n${result}` 
          }]
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to download traffic file: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
}
