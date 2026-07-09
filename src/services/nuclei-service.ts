import FormData from 'form-data';
import { serializeRepeatedParams } from '../utils/query-params.js';
import { assertValidNucleiTemplatePath } from '../utils/nuclei-template.js';
import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Nuclei template operations.
 */
export class NucleiService {
  constructor(private client: ApiClient) {}

  /**
   * Upload a nuclei template YAML file to NightVision
   * @param templateId ID of the nuclei template to upload to
   * @param filePath Path to the YAML file containing the nuclei template
   * @param format Output format
   * @returns Result of the upload operation
   */
  async uploadNucleiTemplate(
    templateId: string,
    filePath: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Uploading nuclei template from ${filePath} to template ID ${templateId}...`);

      // Import required modules
      const fs = await import('fs');
      const path = await import('path');

      // Reject a NUL byte and require a .yaml/.yml extension so a non-template
      // file is not read and uploaded by mistake.
      assertValidNucleiTemplatePath(filePath);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`Nuclei template file not found at: ${filePath}`);
      }

      // Read the file content
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');

      // Validate that it's a YAML file with basic nuclei template structure
      if (!fileContent.includes('id:') || !fileContent.includes('info:')) {
        throw new Error(`The file does not appear to be a valid nuclei template. It should contain 'id:' and 'info:' sections.`);
      }

      console.error(`File validated as nuclei template, uploading...`);

      // Create FormData using the form-data package
      const formData = new FormData();
      formData.append('file', Buffer.from(fileContent), {
        filename: path.basename(filePath),
        contentType: 'application/x-yaml'
      });

      // Make API request to upload the template
      const response = await this.client.apiRequest<any>(
        `nuclei-templates/${encodeURIComponent(templateId)}/upload/`,
        'POST',
        {},
        formData,
        true // Indicate this is form data
      );

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple text representation
        return `Template successfully uploaded to ID: ${templateId}\nName: ${response.name || 'N/A'}\nType: ${response.type || 'N/A'}\nUpdated: ${response.updated || 'N/A'}`;
      }

      // Default to returning raw JSON
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error uploading nuclei template: ${error.message}`);

      // Check for common errors
      if (error.message.includes('404')) {
        throw new Error(`Template ID ${templateId} not found. Please check that the ID exists and you have access to it.`);
      }

      if (error.message.includes('401') || error.message.includes('403')) {
        throw new Error(`Authentication or permission error. Please ensure you're authenticated and have permission to upload templates.`);
      }

      if (error.message.includes('400')) {
        throw new Error(`Bad request when uploading template. The template may have invalid format or syntax.`);
      }

      throw new Error(`Failed to upload nuclei template: ${error.message}`);
    }
  }

  /**
   * Create a new nuclei template in NightVision
   * @param name Name of the nuclei template
   * @param description Optional description of the nuclei template
   * @param projectId UUID of the project to associate the template with
   * @param format Output format
   * @returns Result of the create operation with the template ID
   */
  async createNucleiTemplate(
    name: string,
    description: string | undefined,
    projectId: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Validate required parameters
      if (!name || name.trim() === '') {
        throw new Error("Template name is required");
      }

      if (!projectId || projectId.trim() === '') {
        throw new Error("Project ID is required");
      }

      console.error(`Creating a new nuclei template with name ${name} using project UUID ${projectId}...`);

      // Prepare data for the API request
      const data: Record<string, any> = {
        name,
        project: projectId // Using project parameter with UUID value
      };

      // Add description if provided
      if (description && description.trim() !== '') {
        data.description = description;
      }

      // Make API request to create the template
      const response = await this.client.apiRequest<any>(
        'nuclei-templates/',
        'POST',
        {},
        data
      );

      console.error(`Successfully created nuclei template with ID: ${response.id}`);

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple text representation
        return `Template successfully created:
ID: ${response.id}
Name: ${response.name}
${description ? `Description: ${description}` : ''}
Project UUID: ${projectId}
Created: ${response.created || 'N/A'}`;
      }

      // Default to returning raw JSON
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error creating nuclei template: ${error.message}`);

      // Check for common errors
      if (error.message.includes('401') || error.message.includes('403')) {
        throw new Error(`Authentication or permission error. Please ensure you're authenticated and have permission to create templates.`);
      }

      if (error.message.includes('400')) {
        // Try to extract more specific error information from the response
        let errorDetail = error.message;
        try {
          // Try to extract more detailed information about the field issues
          const match = error.message.match(/\(400\): (.+)/);
          if (match && match[1]) {
            errorDetail = match[1];
          }
        } catch (parseError) {
          // If we can't parse the error, keep the original message
        }

        throw new Error(`Bad request when creating template: ${errorDetail}. Make sure all required fields are valid.`);
      }

      // Just pass through our custom validation errors directly
      if (error.message.includes("is required") || error.message.includes("not found")) {
        throw error;
      }

      throw new Error(`Failed to create nuclei template: ${error.message}`);
    }
  }

  /**
   * List all nuclei templates
   * @param options Optional parameters for filtering templates
   * @param format Output format
   * @returns List of nuclei templates
   */
  async listNucleiTemplates(
    options: {
      project_id?: string;
      filter?: string;
      page?: number;
      page_size?: number;
      severity?: Array<'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown' | 'unspecified'>;
      target?: string;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Listing nuclei templates...`);

      // Build query parameters
      const params: Record<string, any> = {};

      if (options.project_id) {
        params.project = options.project_id;
      }

      if (options.filter) {
        params.search = options.filter; // API still uses 'search' parameter
      }

      if (options.page) {
        params.page = options.page;
      }

      // Set page_size with default of 100 if not specified
      params.page_size = options.page_size || 100;

      // Add severity array if provided. The API's severity choices are
      // uppercase, so normalize the tool's lowercase enum values before sending.
      if (options.severity && options.severity.length > 0) {
        params.severity = options.severity.map((s) => s.toUpperCase());
      }

      // Add target UUID if provided
      if (options.target) {
        params.target = options.target;
      }

      // Make API request to list templates. The severity array must reach the
      // API as repeated keys, so use the repeated-key serializer.
      const response = await this.client.apiRequest<any>(
        'nuclei-templates/',
        'GET',
        params,
        null,
        false,
        serializeRepeatedParams
      );

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple table with the key information
        if (!response.results || response.results.length === 0) {
          return "No nuclei templates found.";
        }

        // Define table headers
        const headers = ['ID', 'Name', 'Severity', 'Description', 'Project', 'Created'];

        // Extract rows from the results
        const rows = response.results.map((template: any) => [
          template.id || 'N/A',
          template.name || 'N/A',
          template.severity || 'N/A',
          (template.description || '').substring(0, 30) + (template.description && template.description.length > 30 ? '...' : '') || 'N/A',
          template.project?.name || 'N/A',
          template.created || 'N/A'
        ]);

        // Build a simple table format
        const table = [
          headers.join('\t'),
          headers.map(() => '-----').join('\t'),
          ...rows.map((row: string[]) => row.join('\t'))
        ].join('\n');

        // Add summary information
        const summary = `\nTotal Templates: ${response.count || 0}`;

        return table + summary;
      } else {
        // Text format
        if (!response.results || response.results.length === 0) {
          return "No nuclei templates found.";
        }

        const text = response.results.map((template: any) =>
          `${template.name} (ID: ${template.id})\n` +
          `  Project: ${template.project?.name || 'N/A'}\n` +
          `  Severity: ${template.severity || 'N/A'}\n` +
          `  Description: ${template.description || 'N/A'}\n` +
          `  Created: ${template.created || 'N/A'}`
        ).join('\n\n');

        return text + `\n\nTotal Templates: ${response.count || 0}`;
      }
    } catch (error: any) {
      console.error(`Error listing nuclei templates: ${error.message}`);
      throw new Error(`Failed to list nuclei templates: ${error.message}`);
    }
  }

  /**
   * Assign a nuclei template to a target
   * @param targetId ID of the target to assign the template to
   * @param templateId ID of the nuclei template to assign
   * @param format Output format
   * @returns Result of the assignment operation
   */
  async assignNucleiTemplate(
    targetId: string,
    templateId: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Assigning nuclei template ${templateId} to target ${targetId}...`);

      // Validate required parameters
      if (!targetId || targetId.trim() === '') {
        throw new Error("Target ID is required");
      }

      if (!templateId || templateId.trim() === '') {
        throw new Error("Template ID is required");
      }

      // Prepare data for the API request
      const data = {
        nuclei_templates: [templateId]
      };

      // Make API request to assign the template to the target
      // Using endpoint: /api/v1/targets/{id}/nuclei-templates/assign/
      const response = await this.client.apiRequest<any>(
        `targets/${encodeURIComponent(targetId)}/nuclei-templates/assign/`,
        'POST',
        {},
        data
      );

      console.error(`Successfully assigned nuclei template to target`);

      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple text representation
        return `Template ${templateId} successfully assigned to target ${targetId}`;
      } else if (format === 'text') {
        return `Successfully assigned nuclei template ${templateId} to target ${targetId}`;
      }

      // Default to returning raw JSON
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error assigning nuclei template to target: ${error.message}`);

      // Check for common errors
      if (error.message.includes('404')) {
        throw new Error(`Target ID or Template ID not found. Please check that both exist and you have access to them.`);
      }

      if (error.message.includes('401') || error.message.includes('403')) {
        throw new Error(`Authentication or permission error. Please ensure you're authenticated and have permission to assign templates.`);
      }

      if (error.message.includes('400')) {
        throw new Error(`Bad request when assigning template. The template may not be compatible with this target.`);
      }

      throw new Error(`Failed to assign nuclei template to target: ${error.message}`);
    }
  }
}
