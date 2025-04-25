import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { ApiDiscoveryParamsSchema } from '../types/index.js';
import * as path from 'path';
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
   * The langs parameter must be an array of languages (e.g. ['python', 'js']) for the source code analysis.
   * 
   * Note on language detection: Some languages may be difficult to recognize in recursive directories.
   * Before running API discovery, perform a recursive file scan of the target directory tree to identify
   * source files and their languages. This helps determine the correct langs value to use.
   * 
   * Important: When discovering APIs for multiple languages, the tool will generate separate output files 
   * for each language (e.g., 'openapi-crapi-discovered_python$1', 'openapi-crapi-discovered_java$1'). 
   * The NightVision tool automatically adds language identifiers and unique suffixes but does NOT add file extensions,
   * even though the content is in OpenAPI YAML format. You must manually rename these files to add the .yml extension.
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
              text: `No languages specified. You should analyze the source code to determine the appropriate language(s).\n\nSupported languages are: csharp, go, java, js, python, ruby.\n\nPlease analyze the file extensions and code patterns in the source paths to identify the language, then call this tool again with the appropriate 'langs' parameter as an array.` 
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
        const supportedLanguages = ['csharp', 'go', 'java', 'js', 'python', 'ruby'];
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
          
          // Check if multiple languages were used and add helpful guidance
          if (Array.isArray(langs) && langs.length > 1) {
            const outputDir = path.parse(output).dir || '.';
            
            const expectedFiles = langs.map(lang => 
              `${outputDir}/openapi-crapi-discovered_${lang}$1`
            );
            
            const renameInstructions = expectedFiles.map(file => 
              `mv "${file}" "${file}.yml"`
            ).join('\n');
            
            return {
              content: [{ 
                type: "text" as const, 
                text: `${result}\n\nMultiple languages detected. You'll need to manually add .yml extensions to the generated files.\nExpected files:\n${expectedFiles.join('\n')}\n\nSuggested commands to add extensions:\n${renameInstructions}` 
              }]
            };
          }
          
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