import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { 
  ListTargetsParamsSchema, 
  GetTargetDetailsParamsSchema,
  Target,
  FormattedTargetList,
  CreateTargetParamsSchema,
  DeleteTargetParamsSchema
} from '../types/index.js';
import { matchTargetByName } from './target-matching.js';

/**
 * Register target-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerTargetTools(server: McpServer): void {
  /**
   * List Targets Tool
   * 
   * Provides a tool to list NightVision targets with optional filtering
   */
  server.tool(
    "list-targets",
    ListTargetsParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { all, projects, format } = args;
        
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
        
        // Execute the command with specified format
        const output = await nightvisionService.listTargets(all, projects, format || "json");
        
        // For JSON format, try to parse and format the output for better readability
        if (format === "json") {
          try {
            const targets = JSON.parse(output) as Target[];
            // Create a formatted summary of targets
            const formattedOutput: FormattedTargetList = {
              totalTargets: targets.length,
              targets: targets.map((target) => ({
                name: target.name,
                id: target.id,
                location: target.location,
                project: target.project_name,
                type: target.type,
                isReadyToScan: target.is_ready_to_scan
              }))
            };
            
            return {
              content: [{ 
                type: "text" as const, 
                text: JSON.stringify(formattedOutput, null, 2)
              }]
            };
          } catch (parseError) {
            // If parsing fails, return raw output
            console.error(`Failed to parse JSON output: ${parseError}`);
            return {
              content: [{ type: "text" as const, text: output }]
            };
          }
        }
        
        // Return raw output for non-JSON formats
        return {
          content: [{ type: "text" as const, text: output }]
        };
      } catch (error: any) {
        // Return error information
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error listing targets: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Get detailed information about a specific target
   */
  server.tool(
    "get-target-details",
    GetTargetDetailsParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { name, format } = args;
        
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
        
        // First list all targets to find the one with matching name
        const allTargets = await nightvisionService.listTargets(true, undefined, "json");
        
        try {
          // Check if allTargets is not empty or null before parsing
          if (!allTargets) {
            return {
              content: [{ 
                type: "text" as const, 
                text: "No target data received. Please try again later."
              }],
              isError: true
            };
          }
          
          // Try to parse the JSON
          let targets;
          try {
            targets = JSON.parse(allTargets) as Target[];
          } catch (jsonError) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Error parsing target data: ${jsonError}`
              }],
              isError: true
            };
          }
          
          const targetMatch = targets.find((t) => t.name === name);
          
          if (!targetMatch) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `No target found with name: ${name}`
              }],
              isError: true
            };
          }
          
          // Return detailed information about the found target
          return {
            content: [{ 
              type: "text" as const, 
              text: JSON.stringify(targetMatch, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: "text" as const, 
              text: `Error getting target details: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error getting target details: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Create a new target
   */
  server.tool(
    "create-target",
    CreateTargetParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          name, 
          url, 
          project, 
          project_id, 
          type, 
          spec_file, 
          spec_url, 
          exclude_url, 
          exclude_xpath, 
          format 
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
        
        // Verify that project name is provided (now required)
        if (!project) {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Project name is required. Please provide a 'project' parameter with the name of the project." 
            }],
            isError: true
          };
        }
        
        // Create target with provided options
        const output = await nightvisionService.createTarget(
          name, 
          url, 
          {
            project,
            project_id,
            type,
            spec_file,
            spec_url,
            exclude_url,
            exclude_xpath
          }, 
          format || "json"
        );
        
        // For JSON format, try to parse and format the output for better readability
        if (format === "json") {
          try {
            const target = JSON.parse(output);
            return {
              content: [{ 
                type: "text" as const, 
                text: `Successfully created target "${name}" with ID: ${target.id}\n\n${JSON.stringify(target, null, 2)}` 
              }]
            };
          } catch (parseError) {
            // If parsing fails, return raw output
            console.error(`Failed to parse JSON output: ${parseError}`);
            return {
              content: [{ type: "text" as const, text: output }]
            };
          }
        }
        
        // Return raw output for non-JSON formats
        return {
          content: [{ 
            type: "text" as const, 
            text: `Successfully created target "${name}"\n\n${output}` 
          }]
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error creating target: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Delete an existing target
   */
  server.tool(
    "delete-target",
    DeleteTargetParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { name, format } = args;
        
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
        
        // Confirm target exists before deleting and get project info
        let project = args.project, project_id = args.project_id;
        try {
          const allTargets = await nightvisionService.listTargets(true, undefined, "json");
          
          // Check if allTargets is not empty or null before parsing
          if (!allTargets) {
            return {
              content: [{ 
                type: "text" as const, 
                text: "No target data received. Please try again later."
              }],
              isError: true
            };
          }
          
          // Try to parse the JSON
          let targets;
          try {
            targets = JSON.parse(allTargets) as Target[];
          } catch (jsonError) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `Error parsing target data: ${jsonError}`
              }],
              isError: true
            };
          }
          
          // Names are unique only within a project, so refuse to guess when the
          // name is ambiguous across projects.
          const match = matchTargetByName(targets, name, args.project, args.project_id);

          if (match.status === "ambiguous") {
            return {
              content: [{
                type: "text" as const,
                text: `Multiple targets named "${name}" exist (in projects: ${match.projects.join(", ")}). Specify 'project' or 'project_id' to identify which one to delete.`
              }],
              isError: true
            };
          }

          if (match.status === "not-found") {
            return {
              content: [{
                type: "text" as const,
                text: `Target "${name}" not found. Please check the name and try again.`
              }],
              isError: true
            };
          }

          // Use the resolved target's project info
          project = match.target.project_name;
          project_id = match.target.project_id;
          
        } catch (error) {
          console.error(`Error checking if target exists: ${error}`);
          // The existence/ambiguity pre-check could not run. If the caller did
          // not supply a project or project_id, refuse rather than guess which
          // target to delete; when one was supplied the delete is already
          // unambiguous, so let it proceed.
          if (!args.project && !args.project_id) {
            return {
              content: [{
                type: "text" as const,
                text: `Could not verify the target "${name}" before deleting (failed to list targets). Please try again, or pass 'project' or 'project_id' to delete it directly.`
              }],
              isError: true
            };
          }
        }
        
        // Delete the target
        const output = await nightvisionService.deleteTarget(
          name, 
          {
            project,
            project_id
          }, 
          format || "json"
        );
        
        // For JSON format, try to parse and format the output for better readability
        if (format === "json") {
          try {
            const result = JSON.parse(output);
            return {
              content: [{ 
                type: "text" as const, 
                text: `Successfully deleted target "${name}"\n\n${JSON.stringify(result, null, 2)}` 
              }]
            };
          } catch (parseError) {
            // If parsing fails, return raw output
            console.error(`Failed to parse JSON output: ${parseError}`);
            return {
              content: [{ type: "text" as const, text: output }]
            };
          }
        }
        
        // Return raw output for non-JSON formats
        return {
          content: [{ 
            type: "text" as const, 
            text: `Successfully deleted target "${name}"\n\n${output}` 
          }]
        };
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Error deleting target: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
} 