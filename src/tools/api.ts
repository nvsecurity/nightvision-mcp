import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { ApiDiscoveryParamsSchema } from '../types/index.js';
import * as path from 'path';
import { z } from 'zod';

/**
 * Register API-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerApiTools(server: McpServer): void {
  /**
   * API Discovery Tool
   * 
   * Provides a tool to discover API endpoints by analyzing source code using the swagger extract feature
   */
  server.tool(
    "discover-api",
    ApiDiscoveryParamsSchema,
    async (args: any, _extra: any) => {
      try {
        // Return a prompt first to ask about the project directory
        return {
          content: [{ 
            type: "text" as const, 
            text: `Before I start the API discovery process, I need to confirm your project directory.

Please provide the absolute path to your project directory. 
For example: "/Users/username/projects/my-api-project"

This will help me correctly resolve relative paths in your codebase.`
          }],
          isError: false,
          promptResponse: {
            prompt: true,
            responseType: "discover-api-with-path",
            state: args
          }
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to start API discovery: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * API Discovery With Path Tool
   * 
   * Second part of the API discovery tool that executes after getting the project path
   */
  server.tool(
    "discover-api-with-path",
    {
      project_path: z.string().describe("Absolute path to the project directory"),
      ...ApiDiscoveryParamsSchema
    },
    async (args: any, _extra: any) => {
      try {
        const { 
          project_path,  // New parameter for the absolute project path
          source_paths, 
          lang,
          target,
          target_id,
          project, 
          project_id,
          output,
          exclude,
          version,
          no_upload,
          dump_code,
          verbose,
          format = 'text',
          state = {} // This might contain the original arguments if we're coming from a prompt
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
        
        // If this is a response to a prompt, use the state parameters
        const finalArgs = state.source_paths ? state : args;
        
        // Validate parameters
        if (!finalArgs.source_paths || finalArgs.source_paths.length === 0) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Source paths are required. Please specify at least one path to analyze (e.g., '/path/to/code')." 
            }],
            isError: true
          };
        }
        
        if (!finalArgs.lang) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Programming language is required. Please specify the 'lang' parameter with one of: csharp, go, java, js, python, ruby." 
            }],
            isError: true
          };
        }
        
        if (!finalArgs.output) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Output file path is required. Please specify where to save the OpenAPI specification (e.g., 'output': './openapi-spec.yml')." 
            }],
            isError: true
          };
        }
        
        if (!project_path) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Project path is required. Please provide the absolute path to your project directory." 
            }],
            isError: true
          };
        }
        
        // Use the provided project_path directly, no fallback
        const workspacePath = project_path;
        
        // Log paths for debugging
        console.error(`User-provided project path: ${project_path}`);
        console.error(`Current working directory: ${process.cwd()}`);
        
        try {
          console.error(`Starting API discovery with source_paths: ${JSON.stringify(finalArgs.source_paths)}`);
          
          // Discover API endpoints using the provided project path
          const result = await nightvisionService.discoverApi(
            finalArgs.source_paths,
            {
              lang: finalArgs.lang,
              target: finalArgs.target,
              target_id: finalArgs.target_id,
              project: finalArgs.project,
              project_id: finalArgs.project_id,
              output: finalArgs.output,
              exclude: finalArgs.exclude,
              version: finalArgs.version,
              no_upload: finalArgs.no_upload,
              dump_code: finalArgs.dump_code,
              verbose: false
            },
            finalArgs.format || 'text',
            workspacePath // Pass the project path as the fourth parameter
          );
          
          // The result is already compact from the service to avoid conversation length issues
          // Just return it directly
          return {
            content: [{ 
              type: "text" as const, 
              text: result 
            }]
          };
        } catch (error: any) {
          console.error(`Error discovering API endpoints: ${error.message}`);
          
          // Check for common errors and provide more helpful messages
          if (error.message.includes("lang")) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Language error: Please specify a valid language with 'lang'. Valid options are: csharp, go, java, js, python, ruby.`
              }],
              isError: true
            };
          }
          
          // Check for file system errors
          if (error.message.includes("read-only file system") || 
              error.message.includes("permission denied") || 
              error.message.includes("file system error")) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `${error.message}

This is likely due to permissions issues. The server will try to write the output file to a writable location.

Using project path: ${workspacePath}
The current working directory is: ${process.cwd()}

You can try again with:
1. A different output location where you have write permissions
2. A different project path with correct permissions
3. Using a relative path like "./output.yml" which will be converted to an absolute path`
              }],
              isError: true
            };
          }
          
          // Check specifically for "0 paths discovered" error
          if (error.message.includes("0 paths discovered") || error.message.includes("No API endpoints found")) {
            // Format provided paths for display
            const displayPaths = finalArgs.source_paths.map((p: string) => `"${p}"`).join(', ');
            
            // Create a compact error message to avoid conversation length limits
            return {
              content: [{ 
                type: "text" as const, 
                text: `No API endpoints found in ${displayPaths} using language ${finalArgs.lang}.

Using project path: ${workspacePath}
Current working directory: ${process.cwd()}

Try analyzing more specific subdirectories where API code is likely located:
- For JS: Look in "src/routes", "src/controllers", "api" 
- For Java: Look in "src/main/java/.../controllers" or "src/main/java/.../resources"
- For Python: Look in "app/routes", "api", "views"

Both relative and absolute paths are supported. 
Examples:
- Relative: "./src/controllers" (relative to ${workspacePath})
- Absolute: "${path.resolve(workspacePath, 'src/controllers')}"

Make sure the language parameter (${finalArgs.lang}) matches your codebase.`
              }],
              isError: true
            };
          }
          
          // Check for buffer exceeded errors
          if (error.message.includes("maxBuffer")) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `The API discovery output was too large to process.

Please try:
1. Analyzing smaller, more specific directories
2. Using the 'exclude' parameter to filter files (e.g., "exclude": "node_modules/*,*.test.js")
3. Turning off verbose mode
4. Analyzing one directory at a time`
              }],
              isError: true
            };
          }
          
          // Return a concise error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to discover API endpoints: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to discover API endpoints: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
} 