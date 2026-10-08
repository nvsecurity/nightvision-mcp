import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { ApiDiscoveryParamsSchema } from '../types/index.js';
import { normalizeLanguages } from '../utils/extract-languages.js';
import { requireAuthenticatedUser, requireProjectAccess } from '../utils/auth-guard.js';
import { extractUploadMode } from '../utils/extract-target-args.js';
import { registerNightVisionTool } from './metadata.js';

/**
 * Register API-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerApiTools(server: McpServer): void {
  /**
   * Source Intelligence tool, registered as run-source-intelligence and as
   * discover-api
   * 
   * Provides a tool to discover API endpoints by analyzing source code using the openapi extract feature.
   * All source_paths must be absolute paths.
   * If source_paths is not specified by the user, use the project root path.
   * The langs parameter is optional. Without it the CLI detects project roots and languages on
   * its own. A single language or an array (e.g. 'python' or ['python', 'js']) restricts the
   * analysis; the CLI's aliases (dotnet, typescript, ...) are accepted and normalized.
   * 
   * When discovering APIs for multiple languages, the tool writes one specification file per
   * language, appending the language to the output base name while keeping the extension
   * (e.g. 'api-spec_python.yml'), and reports the resulting paths.
   */
  const runSourceIntelligence: ToolCallback<typeof ApiDiscoveryParamsSchema> =
    async (params, _extra) => {
      try {
        const auth = await requireAuthenticatedUser();
        if (!auth.ok) return auth.response;

        // Extract params from request
        const { source_paths, langs, output, exclude, target, target_id, project, project_id, version, no_target, no_upload, dump_code } = params;

        // project/project_id name the UPLOAD DESTINATION. Unless the caller
        // asks to upload to a target, the CLI never touches the project,
        // leaving the label inert. Authorizing an inert label would make a run
        // without a target depend on the API being reachable (a transient
        // outage would then block it) and would surface a confusing "project
        // access denied" for an operation that leaves the project alone. Gate
        // the guard on the effective upload mode instead.
        if (extractUploadMode(params) === 'target' && (project || project_id)) {
          const projectAccess = await requireProjectAccess({
            project,
            project_id,
            action: 'running API Discovery with NightVision project upload'
          });
          if (!projectAccess.ok) return projectAccess.response;
        }
        
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
        
        // Normalize the optional language restriction to the CLI's canonical
        // names; an empty list leaves language detection to the CLI.
        let languages;
        try {
          languages = normalizeLanguages(langs);
        } catch (langError: any) {
          return {
            content: [{ 
              type: "text" as const, 
              text: langError.message 
            }],
            isError: true
          };
        }

        // Get project path for resolving relative paths
        const projectPath = process.cwd();

        try {
          // Discover API endpoints using service
          const result = await nightvisionService.discoverApi(
            effectiveSourcePaths,
            {
              lang: languages.length === 0 ? undefined : languages.length === 1 ? languages[0] : languages,
              output,
              exclude,
              target,
              target_id,
              project,
              project_id,
              version,
              no_target,
              no_upload,
              dump_code
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
        console.error(`Error in run-source-intelligence tool:`, error);
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error discovering API endpoints: ${error.message}`
          }],
          isError: true
        };
      }
    };

  // discover-api is the tool's former name, kept for existing callers.
  for (const name of ['run-source-intelligence', 'discover-api'] as const) {
    registerNightVisionTool(server, name, ApiDiscoveryParamsSchema, runSourceIntelligence);
  }
}
