import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import { UploadNucleiTemplateParamsSchema, CreateNucleiTemplateParamsSchema, ListNucleiTemplatesParamsSchema } from '../types/index.js';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Register nuclei-related tools with the MCP server
 * @param server The MCP server instance
 */
export function registerNucleiTools(server: McpServer): void {
  /**
   * Create Nuclei Template Tool
   * 
   * Provides a tool to create new nuclei templates in NightVision
   */
  server.tool(
    "create-nuclei-template",
    CreateNucleiTemplateParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const {
          name,
          description,
          project_id,
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
        
        // Validate required parameters before sending to service
        if (!name || name.trim() === '') {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Template name is required. Please provide a name for your nuclei template."
            }],
            isError: true
          };
        }
        
        if (!project_id || project_id.trim() === '') {
          return {
            content: [{ 
              type: "text" as const, 
              text: "Project ID is required. Please specify the project UUID to associate with this template."
            }],
            isError: true
          };
        }
        
        try {
          // Create the nuclei template
          const result = await nightvisionService.createNucleiTemplate(
            name,
            description,
            project_id,
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: `Successfully created nuclei template "${name}" with project ID "${project_id}".\n\n${result}\n\nYou can now use the template ID shown above with the upload-nuclei-template tool to upload your YAML template file.` 
            }]
          };
        } catch (error: any) {
          console.error(`Error creating nuclei template: ${error.message}`);
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to create nuclei template: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to create nuclei template: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * Upload Nuclei Template Tool
   * 
   * Provides a tool to upload custom nuclei templates to NightVision
   */
  server.tool(
    "upload-nuclei-template",
    UploadNucleiTemplateParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          template_id: templateId,
          file_path: filePath,
          project_path: projectPath,
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
          // Resolve the file path (relative or absolute)
          let resolvedFilePath = filePath;
          
          // If the path is relative and a project path is provided, resolve it
          if (!filePath.startsWith('/') && projectPath) {
            resolvedFilePath = path.resolve(projectPath, filePath);
            console.error(`Resolved relative path '${filePath}' to absolute path '${resolvedFilePath}'`);
          } else if (!filePath.startsWith('/')) {
            // If relative path without project path, use current working directory
            resolvedFilePath = path.resolve(process.cwd(), filePath);
            console.error(`Resolved relative path '${filePath}' using CWD to '${resolvedFilePath}'`);
          }
          
          // Check if file exists before proceeding
          if (!fs.existsSync(resolvedFilePath)) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `File not found: ${resolvedFilePath}\n\nPlease check that the file path is correct and the file exists. If using a relative path, consider providing the 'project_path' parameter for accurate resolution.`
              }],
              isError: true
            };
          }
          
          // Upload the nuclei template
          const result = await nightvisionService.uploadNucleiTemplate(
            templateId,
            resolvedFilePath,
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: `Successfully uploaded nuclei template from ${filePath} to template ID ${templateId}.\n\n${result}`
            }]
          };
        } catch (error: any) {
          console.error(`Error uploading nuclei template: ${error.message}`);
          
          // Check for specific errors and provide helpful messages
          if (error.message.includes('not found')) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `${error.message}\n\nMake sure you've created the nuclei template first before trying to upload a file to it. You can list available templates using NightVision CLI:\n\n$ nightvision nuclei-template list`
              }],
              isError: true
            };
          }
          
          if (error.message.includes('valid nuclei template')) {
            return {
              content: [{ 
                type: "text" as const, 
                text: `${error.message}\n\nNuclei templates are YAML files with a specific structure. They should include 'id:' and 'info:' sections. Please check the template format.`
              }],
              isError: true
            };
          }
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to upload nuclei template: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to upload nuclei template: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );

  /**
   * List Nuclei Templates Tool
   * 
   * Provides a tool to list all nuclei templates in NightVision
   */
  server.tool(
    "list-nuclei-templates",
    ListNucleiTemplatesParamsSchema,
    async (args: any, _extra: any) => {
      try {
        const { 
          project_id,
          search,
          limit,
          offset,
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
          // List nuclei templates
          const result = await nightvisionService.listNucleiTemplates(
            {
              project_id,
              search,
              limit,
              offset
            },
            format
          );
          
          // Return the formatted output
          return {
            content: [{ 
              type: "text" as const, 
              text: `Nuclei Templates:\n\n${result}` 
            }]
          };
        } catch (error: any) {
          console.error(`Error listing nuclei templates: ${error.message}`);
          
          // Return a helpful error message
          return {
            content: [{ 
              type: "text" as const, 
              text: `Failed to list nuclei templates: ${error.message}` 
            }],
            isError: true
          };
        }
      } catch (error: any) {
        return {
          content: [{ 
            type: "text" as const, 
            text: `Failed to list nuclei templates: ${error.message}` 
          }],
          isError: true
        };
      }
    }
  );
} 