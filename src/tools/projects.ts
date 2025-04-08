import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { z } from 'zod';

/**
 * Project list parameters schema
 */
const ListProjectsParamsSchema = {
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get project details parameters schema
 */
const GetProjectDetailsParamsSchema = {
  name: z.string().describe("Name of the project to get details for"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

// Define interface for the project response structure
interface ProjectResponse {
  count?: number;
  results?: ProjectData[];
}

// Define interface for project data
interface ProjectData {
  id: string;
  name: string;
  targets_count?: number;
  created_at?: string;
  last_updated_at?: string;
  is_default?: boolean;
}

/**
 * Register project-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerProjectTools(server: McpServer): void {
  /**
   * List Projects Tool
   * 
   * Provides a tool to list all NightVision projects
   */
  server.tool(
    "list-projects",
    ListProjectsParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { format = 'json' } = args;
        
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
          // List projects using the CLI command
          const commandOutput = await nightvisionService.executeCommand(
            ['project', 'list'], 
            'json'
          );
          
          // Parse the JSON output
          const response = JSON.parse(commandOutput) as ProjectResponse;
          
          let formattedResponse: string;
          
          if (format === 'json') {
            formattedResponse = JSON.stringify(response, null, 2);
          } else if (format === 'table') {
            // Create a simple table with the key information
            if (!response?.results || response.results.length === 0) {
              formattedResponse = "No projects found.";
            } else {
              const headers = ['ID', 'Name', 'Targets', 'Created'];
              
              const rows = response.results.map((project: ProjectData) => [
                project.id || 'N/A',
                project.name || 'N/A',
                project.targets_count?.toString() || '0',
                project.created_at || 'N/A'
              ]);
              
              // Simple table formatting
              formattedResponse = [
                headers.join('\t'),
                headers.map(() => '-----').join('\t'),
                ...rows.map((row: string[]) => row.join('\t'))
              ].join('\n');
              
              formattedResponse += `\n\nTotal Projects: ${response.count || 0}`;
            }
          } else {
            // Text format - simpler output
            if (!response?.results || response.results.length === 0) {
              formattedResponse = "No projects found.";
            } else {
              formattedResponse = response.results.map((project: ProjectData) => 
                `${project.name} (ID: ${project.id}) - ${project.targets_count || 0} targets`
              ).join('\n');
              
              formattedResponse += `\n\nTotal Projects: ${response.count || 0}`;
            }
          }
          
          return {
            content: [{ 
              type: "text" as const, 
              text: `Projects in NightVision:\n\n${formattedResponse}` 
            }]
          };
        } catch (error: any) {
          console.error(`Error listing projects: ${error.message}`);
          
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to list projects: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to list projects: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Project Details Tool
   * 
   * Provides a tool to get details about a specific NightVision project
   */
  server.tool(
    "get-project-details",
    GetProjectDetailsParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          name,
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
        
        // Validate required parameters
        if (!name || name.trim() === '') {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Project name is required."
            }],
            isError: true
          };
        }
        
        try {
          // Use the public method to get project details from API
          const projectData = await nightvisionService.getProjectByName(name);
          
          let formattedResponse: string;
          
          if (format === 'json') {
            formattedResponse = JSON.stringify(projectData, null, 2);
          } else if (format === 'table') {
            // Create a simple table with the key information
            const details = [
              ['ID', projectData.id || 'N/A'],
              ['Name', projectData.name || 'N/A'],
              ['Targets', projectData.targets_count?.toString() || '0'],
              ['Created', projectData.created_at || 'N/A'],
              ['Last Updated', projectData.last_updated_at || 'N/A'],
              ['Is Default', projectData.is_default ? 'Yes' : 'No']
            ];
            
            // Format as a table
            formattedResponse = details.map(([key, value]) => `${key}: ${value}`).join('\n');
          } else {
            // Text format
            formattedResponse = `Project: ${projectData.name}\nID: ${projectData.id}\nTargets: ${projectData.targets_count || 0}\nCreated: ${projectData.created_at || 'N/A'}\nLast Updated: ${projectData.last_updated_at || 'N/A'}\nIs Default: ${projectData.is_default ? 'Yes' : 'No'}`;
          }
          
          return {
            content: [{ 
              type: "text" as const, 
              text: `Project Details for "${name}":\n\n${formattedResponse}` 
            }]
          };
        } catch (error: any) {
          console.error(`Error getting project details: ${error.message}`);
          
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to get project details: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to get project details: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
} 