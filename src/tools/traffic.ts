import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { 
  RecordTrafficParamsSchema,
  ListTrafficParamsSchema,
  DownloadTrafficParamsSchema
} from '../types/index.js';

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
    async (args: any, _extra: any) => {
      try {
        const { 
          name,
          url,
          target,
          project,
          format = 'text'
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
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
    async (args: any, _extra: any) => {
      try {
        const { 
          target,
          project,
          format = 'json'
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
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
    async (args: any, _extra: any) => {
      try {
        const { 
          name,
          target,
          project,
          output_file,
          downloadPath: initialDownloadPath,
          format = 'text'
        } = args;
        
        // Check if authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }
        
        // Import modules for validating the path
        const path = await import('path');
        const fs = await import('fs/promises');
        const os = await import('os');
        
        // If downloadPath is provided in the initial request, validate and use it
        if (initialDownloadPath !== undefined) {
          try {
            let downloadPath = initialDownloadPath.trim().replace(/^['"]|['"]$/g, '');
            
            // If provided path is empty, use home directory
            if (!downloadPath || downloadPath.trim() === '') {
              const homeDir = os.homedir();
              console.error(`Provided downloadPath is empty. Using home directory: ${homeDir}`);
              downloadPath = homeDir;
            }
            // Check if the path is absolute
            else if (!path.isAbsolute(downloadPath)) {
              const homeDir = os.homedir();
              console.error(`Provided path '${downloadPath}' is not absolute. Using home directory instead: ${homeDir}`);
              downloadPath = homeDir;
            }
            
            // Verify the directory is writable
            try {
              await fs.access(downloadPath, fs.constants.W_OK);
            } catch (error) {
              const tempDir = os.tmpdir();
              console.error(`Provided path '${downloadPath}' is not writable. Falling back to temp directory: ${tempDir}`);
              downloadPath = tempDir;
            }
            
            // Determine final output path
            let finalOutputPath = output_file 
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
            console.error(`Error processing download with provided downloadPath: ${error.message}`);
            return {
              content: [{ 
                type: "text" as const, 
                text: `Failed to download traffic file: ${error.message}` 
              }],
              isError: true
            };
          }
        }
        
        // If downloadPath not provided in the initial request, ask for it
        const downloadPathPrompt = `I'll download the traffic file "${name}" for target "${target}" in project "${project}".
        
Please provide the 'downloadPath' parameter as an absolute directory path (e.g., /Users/username/Downloads) where I should download the file. This directory must exist and be writable:`;
        
        // Return initial question about download path
        return {
          content: [{ 
            type: "text" as const, 
            text: downloadPathPrompt 
          }],
          continueInNewTurn: true,
          turnAction: {
            name: "prompt-for-info",
            onResponse: async (downloadPath: string) => {
              try {
                // Import modules
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                
                // Trim any quotes the user might have included
                downloadPath = downloadPath.trim().replace(/^['"]|['"]$/g, '');
                
                // If no path provided, use home directory as a safe default
                if (!downloadPath || downloadPath.trim() === '') {
                  const homeDir = os.homedir();
                  console.error(`No download path provided. Using home directory: ${homeDir}`);
                  downloadPath = homeDir;
                }
                // Validate that downloadPath is absolute
                else if (!path.isAbsolute(downloadPath)) {
                  // If not absolute, use home directory as fallback and inform the user
                  const homeDir = os.homedir();
                  console.error(`Provided path '${downloadPath}' is not absolute. Using home directory instead: ${homeDir}`);
                  downloadPath = homeDir;
                } else {
                  console.error(`Using download path: ${downloadPath}`);
                }
                
                // Ensure the download directory exists and is writable
                try {
                  await fs.access(downloadPath, fs.constants.W_OK);
                } catch (error) {
                  // If directory doesn't exist or isn't writable, fall back to temp directory
                  const tempDir = os.tmpdir();
                  console.error(`Provided path '${downloadPath}' is not writable. Falling back to temp directory: ${tempDir}`);
                  downloadPath = tempDir;
                }
                
                // Determine final output path
                let finalOutputPath = output_file 
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
                console.error(`Error in download-traffic callback: ${error.message}`);
                
                // Return error message
                return {
                  content: [{ 
                    type: "text" as const, 
                    text: `Failed to download traffic file: ${error.message}` 
                  }],
                  isError: true
                };
              }
            }
          }
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