import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { ApiDiscoveryParamsSchema } from '../types/index.js';
import * as fs from 'fs';
import { z } from 'zod';

/**
 * Register API-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerApiTools(server: McpServer): void {
  /**
   * API Discovery Tool
   * 
   * Provides a tool to discover API endpoints by analyzing source code using the swagger extract feature.
   * All source_paths must be absolute paths.
   * If source_paths is not specified by the user, use the project root path.
   * The langs parameter may be a single language or an array of languages (e.g. 'python' or ['python', 'js']) for the source code analysis.
   * 
   * Note on language detection: Some languages may be difficult to recognize in recursive directories.
   * Before running API discovery, perform a recursive file scan of the target directory tree to identify
   * source files and their languages. This helps determine the correct langs value to use.
   * 
   * When discovering APIs for multiple languages, the tool writes one specification file per
   * language, appending the language to the output base name while keeping the extension
   * (e.g. 'api-spec_python.yml'), and reports the resulting paths.
   */
  server.tool(
    'discover-api',
    ApiDiscoveryParamsSchema,
    async (params: any, context: any) => {
      try {
        // Make sure the user is authenticated
        if (!nightvisionService.getToken()) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Not authenticated. Please use the authenticate tool to set a token first." 
            }],
            isError: true
          };
        }

        // Extract params from request
        const { source_paths, langs, output, exclude, target, target_id, project, project_id, version, no_upload, dump_code, verbose } = params;
        
        // Check if output path is provided
        if (!output) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Output file path is required. Please specify where to save the API specification." 
            }],
            isError: true
          };
        }
        
        // Use project root if source_paths not provided
        const effectiveSourcePaths = source_paths && source_paths.length > 0 
          ? source_paths 
          : [process.cwd()];
        
        // Check if langs is provided
        if (!langs) {
          return {
            content: [{ 
              type: "text" as const, 
              text: `No languages specified. You should analyze the source code to determine the appropriate language(s).\n\nSupported languages are: csharp, go, java, js, php, python, ruby.\n\nPlease analyze the file extensions and code patterns in the source paths to identify the language, then call this tool again with the appropriate 'langs' parameter (a single language or an array).` 
            }],
            isError: true
          };
        }
        
        // Validate langs parameter
        let languages = langs;
        if (!Array.isArray(languages)) {
          languages = [languages];
        }

        // Check languages are supported
        const supportedLanguages = ['csharp', 'go', 'java', 'js', 'php', 'python', 'ruby'];
        for (const language of languages) {
          if (!supportedLanguages.includes(language)) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Unsupported language: ${language}. Supported languages are: ${supportedLanguages.join(', ')}` 
              }],
              isError: true
            };
          }
        }

        // Get project path for resolving relative paths
        const projectPath = process.cwd();

        try {
          // Discover API endpoints using service
          const result = await nightvisionService.discoverApi(
            effectiveSourcePaths,
            {
              lang: langs, // Map langs parameter to lang as expected by service
              output,
              exclude,
              target,
              target_id,
              project,
              project_id,
              version,
              no_upload,
              dump_code,
              verbose
            },
            'text',
            projectPath
          );
          
          return {
            content: [{ 
              type: "text" as const, 
              text: result 
            }]
          };
        } catch (apiError: any) {
          return {
            content: [{ 
              type: "text" as const, 
              text: `Error discovering API endpoints: ${apiError.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        // Handle any errors that occur during execution
        console.error(`Error in discover-api tool:`, error);
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error discovering API endpoints: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
} 