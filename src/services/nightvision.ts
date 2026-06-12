import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import FormData from 'form-data';
import { ENVIRONMENT } from '../config/environment.js';
import { Semaphore } from '../utils/semaphore.js';
import { languageOutputPath } from '../utils/output-naming.js';
import { serializeRepeatedParams } from '../utils/query-params.js';
import { scanStatusFilterCodes } from '../utils/scan-status.js';
import { assertValidNucleiTemplatePath } from '../utils/nuclei-template.js';
import { formatScanChecksText, formatScanChecksTable } from '../utils/scan-check-format.js';
import { formatScansTable } from '../utils/scan-list-format.js';
import { formatScanPathsText, formatScanPathsTable } from '../utils/scan-path-format.js';
import { matchTargetByName } from '../utils/target-matching.js';
import type { Target } from '../types/index.js';

// Promisify execFile for cleaner async/await usage
const execFileAsync = promisify(execFile);

/**
 * Cap the number of simultaneous `nightvision swagger extract` subprocesses
 * (each runs the heavy api-excavator engine). Running many at once under the
 * single server process can exhaust local memory, CPU, and file descriptors.
 * Override the limit with the NIGHTVISION_EXTRACT_CONCURRENCY environment variable.
 */
const MAX_EXTRACT_CONCURRENCY = Math.max(
  1,
  Number(process.env.NIGHTVISION_EXTRACT_CONCURRENCY) || 4
);
const extractLimiter = new Semaphore(MAX_EXTRACT_CONCURRENCY);

/**
 * Supported output formats for NightVision commands
 */
export type OutputFormat = 'text' | 'json' | 'table';

/**
 * Service for interacting with the NightVision CLI
 */
export class NightVisionService {
  private token: string | null = null;
  
  /**
   * Set the authentication token for NightVision commands
   * @param token The token to use
   */
  setToken(token: string | null): void {
    this.token = token;
  }
  
  /**
   * Get the current authentication token
   * @returns The current token or null if not set
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Get HTTP headers for API requests
   * @returns Headers object with authentication and content type
   */
  private getApiHeaders() {
    return {
      'Authorization': this.token ? `Token ${this.token}` : '',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get base URL for API requests
   * @returns The base API URL
   */
  private getApiBaseUrl(): string {
    return ENVIRONMENT.CURRENT_API_URL;
  }

  /**
   * Make an API request using Axios
   * @param endpoint API endpoint path
   * @param method HTTP method
   * @param params Query parameters
   * @param data Request body
   * @param isFormData Whether the data is FormData (for file uploads)
   * @returns Response data
   */
  private async apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params: Record<string, any> = {},
    data: any = null,
    isFormData: boolean = false,
    serializeParams?: (params: Record<string, any>) => string
  ): Promise<T> {
    try {
      const url = `${this.getApiBaseUrl()}${endpoint}`;

      // Use different headers for form data vs JSON
      const headers = isFormData
        ? { 'Authorization': this.token ? `Token ${this.token}` : '' }
        : this.getApiHeaders();

      const response = await axios({
        method,
        url,
        headers,
        params,
        data,
        ...(serializeParams ? { paramsSerializer: { serialize: serializeParams } } : {})
      });
      
      return response.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const errorMessage = error.response?.data?.detail || error.message;
        throw new Error(`API request failed (${statusCode}): ${errorMessage}`);
      }
      throw error;
    }
  }
  
  /**
   * Execute a NightVision CLI command
   * @param args Command arguments to pass to the CLI
   * @param format Output format (text, json, table)
   * @param skipToken Whether to omit the current token from the command environment
   * @param cwd Optional working directory for the spawned command
   * @returns Command output
   */
  async executeCommand(
    args: string[],
    format: OutputFormat = 'text',
    skipToken: boolean = false,
    cwd?: string
  ): Promise<string> {
    try {
      // Build the command with format flag
      const commandArgs = [...args];
      
      // Add format flag if specified
      if (format) {
        commandArgs.push('-F', format);
      }
      
      // Always specify the production API URL to avoid using test environments
      commandArgs.push('--api-url', ENVIRONMENT.CURRENT_API_URL);
      
      // Pass the token to the CLI via the environment (read as NIGHTVISION_TOKEN)
      // rather than on the command line, so it stays out of argv and logs.
      const env = { ...process.env };
      if (this.token && !skipToken) {
        env.NIGHTVISION_TOKEN = this.token;
      }
      
      console.error(`Executing: ${['nightvision', ...commandArgs].join(' ')}`);

      // Invoke the binary directly with an argument vector (no shell), with an
      // increased buffer size (50MB)
      const { stdout, stderr } = await execFileAsync('nightvision', commandArgs, {
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer size (default is 1MB)
        env,
        cwd
      });
      
      // Handle warnings/errors in stderr
      if (stderr && stderr.trim() !== '') {
        console.error(`NightVision CLI warning/error: ${stderr}`);
      }
      
      // Combine stdout and stderr for 'swagger extract' commands to include info logs
      if (args[0] === 'swagger' && args[1] === 'extract' && stderr && stderr.trim()) {
        console.error('Including stderr in command output for API discovery');
        return stdout + (stdout ? '\n' : '') + stderr;
      }
      
      return stdout;
    } catch (error: any) {
      console.error(`Failed to execute NightVision command: ${error.message}`);
      throw new Error(`NightVision command failed: ${error.message}`);
    }
  }

  /**
   * Check if NightVision CLI is installed
   * @returns True if installed, false otherwise
   */
  async isInstalled(): Promise<boolean> {
    try {
      await this.executeCommand(['version']);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Create a new authentication token
   * This token can be used for both CLI commands and API requests
   * @param expiryDate Optional expiration date in format YYYY-MM-DD
   * @returns The created token
   */
  async createToken(expiryDate?: string): Promise<string> {
    try {
      // First, attempt to login to NightVision CLI (interactive process)
      try {
        console.error("Attempting to login to NightVision before creating a new token...");
        await execFileAsync('nightvision', ['login', '--api-url', ENVIRONMENT.CURRENT_API_URL]);
        console.error("Login completed successfully.");
      } catch (loginError: any) {
        console.error(`Login attempt encountered an error: ${loginError.message}`);
        // Continue anyway, as the login might have succeeded despite errors in output
      }
      
      // Now try to create the token (works for both CLI and API)
      const args = ['token', 'create'];
      
      if (expiryDate) {
        args.push('-d', expiryDate);
      }
      
      // Skip adding the current token when creating a new token
      const output = await this.executeCommand(args, 'text', true);
      const newToken = output.trim().split('\n').pop()?.trim() || '';
      
      if (!newToken) {
        throw new Error('Failed to create new token. Please manually run: nightvision login --api-url ' + ENVIRONMENT.CURRENT_API_URL);
      }
      
      // Simple validation of the token format (should be a long string)
      if (newToken.length < 20) {
        console.error(`Warning: Created token has an unexpected format: ${newToken}`);
      }
      
      console.error(`Successfully created a new authentication token: ${newToken.substring(0, 8)}...`);
      console.error(`This token can be used with both the NightVision CLI and API requests.`);
      return newToken;
    } catch (error: any) {
      // If token creation failed, provide specific instructions
      throw new Error(`${error.message}\n\nPlease manually run the following command in your terminal to authenticate:\nnightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
    }
  }
  
  /**
   * List all available targets
   * @param all Get targets from all projects
   * @param projects Project names to filter
   * @param format Output format
   * @returns List of targets
   */
  async listTargets(
    all?: boolean,
    projects?: string[],
    format: OutputFormat = 'json'
  ): Promise<string> {
    const args = ['target', 'list'];
    
    if (all) {
      args.push('-a');
    }
    
    if (projects && projects.length > 0) {
      args.push('-p', projects.join(','));
    }
    
    return this.executeCommand(args, format);
  }

  /**
   * Create a new target
   * @param name Name of the target
   * @param url URL of the target
   * @param options Additional options for target creation
   * @param format Output format
   * @returns Created target information
   */
  async createTarget(
    name: string,
    url: string,
    options: {
      project: string;
      project_id?: string;
      type?: 'API' | 'WEB';
      spec_file?: string;
      spec_url?: string;
      exclude_url?: string[];
      exclude_xpath?: string[];
    },
    format: OutputFormat = 'json'
  ): Promise<string> {
    const args = ['target', 'create', name, url];
    
    // Project is now required, so we always add it
    args.push('-p', options.project);
    
    if (options.project_id) {
      args.push('-P', options.project_id);
    }
    
    if (options.type) {
      args.push('-t', options.type);
    }
    
    if (options.spec_file) {
      args.push('-f', options.spec_file);
    }
    
    if (options.spec_url) {
      args.push('-s', options.spec_url);
    }
    
    if (options.exclude_url && options.exclude_url.length > 0) {
      for (const pattern of options.exclude_url) {
        args.push('--exclude-url', pattern);
      }
    }
    
    if (options.exclude_xpath && options.exclude_xpath.length > 0) {
      for (const xpath of options.exclude_xpath) {
        args.push('--exclude-xpath', xpath);
      }
    }
    
    return this.executeCommand(args, format);
  }

  /**
   * Delete a target
   * @param name Name of the target to delete
   * @param options Additional options for target deletion
   * @param format Output format
   * @returns Result of the delete operation
   */
  async deleteTarget(
    name: string,
    options: {
      project?: string;
      project_id?: string;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    const args = ['target', 'delete', name];
    
    // Add optional parameters
    if (options.project) {
      args.push('-p', options.project);
    }
    
    if (options.project_id) {
      args.push('-P', options.project_id);
    }
    
    return this.executeCommand(args, format);
  }

  /**
   * Start a scan against a target
   * @param targetName Name of the target to scan
   * @param options Additional options for scan
   * @param format Output format
   * @returns Scan information
   */
  async startScan(
    targetName: string,
    options: {
      auth?: string;
      auth_id?: string;
      no_auth?: boolean;
      project?: string;
      project_id?: string;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    // We won't try to auto-detect the project
    // Users should provide project info explicitly
    
    const args = ['scan', targetName];
    
    // Add optional parameters
    if (options.auth) {
      args.push('-c', options.auth);
    }
    
    if (options.auth_id) {
      args.push('-C', options.auth_id);
    }
    
    if (options.no_auth) {
      args.push('--no-auth');
    }
    
    if (options.project) {
      args.push('-p', options.project);
    }
    
    if (options.project_id) {
      args.push('-P', options.project_id);
    }
    
    // Execute the command with standard parameters
    const result = await this.executeCommand(args, format);
    
    // Try to extract the scan ID from the CLI output if it's in JSON format
    if (format === 'json') {
      try {
        const resultObj = JSON.parse(result);
        if (resultObj.id) {
          console.error(`Extracted scan ID: ${resultObj.id}`);
          // Add the scan ID explicitly to the output for better UX
          resultObj.extracted_id = resultObj.id;
          return JSON.stringify(resultObj, null, 2);
        }
      } catch (parseError) {
        console.error(`Could not parse JSON result to extract scan ID: ${parseError}`);
        // Just return the original result if we couldn't parse it
      }
    }
    
    return result;
  }

  /**
   * List all scans
   * @param options Additional options for filtering scans
   * @param format Output format
   * @returns List of scans
   */
  async listScans(
    options: {
      target?: string;
      project?: string;
      project_id?: string;
      limit?: number;
      status?: 'running' | 'finished' | 'failed' | 'all';
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Use API endpoint instead of CLI - based on https://docs.nightvision.net/reference/scans_list
      console.error(`Listing scans via API endpoint...`);
      
      // Build query parameters. The scans endpoint scopes by `target` and
      // `project`, each a repeated-key list of UUIDs (NV-4468); the by-name
      // inputs are resolved to ids before the request.
      const params: Record<string, any> = {};

      if (options.target) {
        const targetId = await this.resolveTargetId(
          options.target,
          options.project,
          options.project_id
        );
        params.target = [targetId];
      }

      // Project scoping: a project UUID maps straight through; a project name is
      // resolved to its id.
      if (options.project_id) {
        params.project = [options.project_id];
      } else if (options.project) {
        const project = await this.getProjectByName(options.project);
        params.project = [project.id];
      }

      if (options.limit) {
        params.limit = options.limit;
      }
      
      // The scans API filters on numeric status codes through a multi-valued
      // field, not these coarse names; map each name to the matching code(s).
      if (options.status && options.status !== 'all') {
        params.status = scanStatusFilterCodes(options.status);
      }

      // Make API request to list scans. Status codes must be sent as repeated
      // `status=` params, so use the repeated-key serializer for this call.
      const response = await this.apiRequest<any>(
        'scans/',
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
        return formatScansTable(response);
      }
      
      // Default to just returning the raw data as string
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error listing scans: ${error.message}`);
      throw new Error(`Failed to list scans: ${error.message}`);
    }
  }

  /**
   * Resolve a target name to its id for scan filtering. Target names are unique
   * only within a project, so a name shared across projects must be narrowed by
   * project name or id; an unresolvable or ambiguous name is an error rather
   * than a silently broadened result.
   * @param name Target name to resolve
   * @param project Optional project name to disambiguate the target
   * @param projectId Optional project UUID to disambiguate the target
   * @returns The matching target's UUID
   */
  private async resolveTargetId(
    name: string,
    project?: string,
    projectId?: string
  ): Promise<string> {
    const allTargets = await this.listTargets(true, undefined, 'json');
    let targets: Target[];
    try {
      targets = JSON.parse(allTargets);
    } catch {
      throw new Error(`Could not parse the target list while resolving target "${name}".`);
    }
    const match = matchTargetByName(targets, name, project, projectId);
    if (match.status === 'ambiguous') {
      throw new Error(
        `Multiple targets named "${name}" exist (in projects: ${match.projects.join(', ')}). ` +
        `Specify 'project' or 'project_id' to identify which one.`
      );
    }
    if (match.status === 'not-found') {
      throw new Error(`No target found with name: ${name}`);
    }
    return match.target.id;
  }

  /**
   * Get scan status and details
   * @param scanId Scan ID to retrieve
   * @param format Output format
   * @returns Scan details
   */
  async getScanStatus(
    scanId: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // API-based approach using the scan details endpoint
      console.error(`Getting scan status via API endpoint...`);
      
      // Make API request to get scan details
      const response = await this.apiRequest<any>(
        `scans/${encodeURIComponent(scanId)}/`,
        'GET'
      );
      
      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple table with the key information
        const details = [
          ['ID', response.id || 'N/A'],
          ['Target', response.target?.name || 'N/A'],
          ['Status', response.status || 'N/A'],
          ['Created', response.created || 'N/A'],
          ['Started', response.started || 'N/A'],
          ['Completed', response.completed || 'N/A'],
          ['Project', response.project?.name || 'N/A'],
          ['Progress', `${response.progress || 0}%`]
        ];
        
        // Format as a table
        return details.map(([key, value]) => `${key}: ${value}`).join('\n');
      }
      
      // Default to returning raw JSON
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error getting scan status: ${error.message}`);
      throw new Error(`Failed to get scan status: ${error.message}`);
    }
  }

  /**
   * Get vulnerability checks for a scan
   * @param scanId ID of the scan to get checks for
   * @param options Additional options for filtering checks 
   * @param format Output format
   * @returns List of vulnerability checks
   */
  async getScanChecks(
    scanId: string,
    options: {
      page?: number;
      page_size?: number;
      name?: string;
      check_kind?: string;
      severity: Array<'critical' | 'high' | 'medium' | 'low' | 'info' | 'unknown' | 'unspecified'>;
      status: Array<number>;
    },
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Use API endpoint
      console.error(`Getting scan checks for ${scanId} via API endpoint...`);
      
      // Build query parameters
      const params: Record<string, any> = {};
      
      if (options.page) {
        params.page = options.page;
      }
      
      // Set page_size with default of 100 if not specified
      params.page_size = options.page_size || 100;
      
      if (options.name) {
        params.name = options.name;
      }
      
      if (options.check_kind) {
        params.check_kind = options.check_kind;
      }
      
      // Filter by severity and status. The API reads these as repeated keys
      // (severity=CRITICAL&severity=HIGH), so the request below uses the
      // repeated-key serializer; the default bracketed form is not parsed. The
      // API's severity choices are uppercase, so the tool's lowercase enum
      // values are normalized before sending or the request is rejected (400).
      params.severity = options.severity.map((s) => s.toUpperCase());
      params.status = options.status;

      // Make API request to get checks
      const response = await this.apiRequest<any>(
        `scans/${encodeURIComponent(scanId)}/checks/`,
        'GET',
        params,
        null,
        false,
        serializeRepeatedParams
      );
      
      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'text') {
        return formatScanChecksText(response);
      } else if (format === 'table') {
        return formatScanChecksTable(response);
      }
      
      return JSON.stringify(response);
    } catch (error) {
      console.error(`Error getting scan checks: ${error}`);
      throw new Error(`Failed to get scan checks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Get checked paths for a scan
   * @param scanId ID of the scan to get paths for
   * @param options Additional options for filtering paths
   * @param format Output format
   * @returns List of checked paths
   */
  async getScanPaths(
    scanId: string,
    options: {
      page?: number;
      page_size?: number;
      filter?: string;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      // Use API endpoint from https://docs.nightvision.net/reference/scans_paths_list
      console.error(`Getting scan paths for ${scanId} via API endpoint...`);
      
      // Build query parameters
      const params: Record<string, any> = {};
      
      if (options.page) {
        params.page = options.page;
      }
      
      if (options.page_size) {
        params.page_size = options.page_size;
      }
      
      if (options.filter) {
        params.filter = options.filter;
      }
      
      // Make API request to get paths
      const response = await this.apiRequest<any>(
        `scans/${encodeURIComponent(scanId)}/paths/`,
        'GET',
        params
      );
      
      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'text') {
        return formatScanPathsText(response);
      } else if (format === 'table') {
        return formatScanPathsTable(response);
      }

      return JSON.stringify(response);
    } catch (error) {
      console.error(`Error getting scan paths: ${error}`);
      throw new Error(`Failed to get scan paths: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
      const response = await this.apiRequest<any>(
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
      const response = await this.apiRequest<any>(
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
   * Verify that the user is properly authenticated
   * @returns True if authenticated, false otherwise
   */
  async verifyProductionAuth(): Promise<boolean> {
    try {
      // Check if we have a token
      if (!this.token) {
        return false;
      }
      
      try {
        // Make an API request to check authentication
        const response = await this.apiRequest<any>('user/me/');
        
        // Check for nested user object with ID
        return !!(response.user && response.user.id);
      } catch (error) {
        console.error(`Token validation failed: ${error}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to verify authentication: ${error}`);
      return false;
    }
  }
  
  /**
   * Ensure the user is authenticated
   * If not authenticated, guide the user to login
   * @returns True if authenticated or successfully logged in, false otherwise
   */
  async ensureProductionAuth(): Promise<boolean> {
    // First check if already authenticated
    if (await this.verifyProductionAuth()) {
      return true;
    }
    
    // If not authenticated, we need to guide the user to login
    console.error('\n⚠️  Not authenticated.');
    console.error('Please run the following command to login:');
    console.error(`$ nightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}\n`);
    
    return false;
  }

  /**
   * Discover API endpoints for a target by analyzing source code
   * @param sourcePaths Array of paths to the source code to analyze
   * @param options Additional options for API discovery
   * @param format Output format
   * @param projectPath Explicit project path to use for resolving relative paths
   * @returns Discovered API endpoints information
   */
  async discoverApi(
    sourcePaths: string[],
    options: {
      lang: 'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby' | Array<'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby'>;
      target?: string;
      target_id?: string;
      project?: string;
      project_id?: string;
      output: string;
      exclude?: string;
      version?: string;
      no_upload?: boolean;
      dump_code?: boolean;
    },
    format: OutputFormat = 'text',
    projectPath: string
  ): Promise<string> {
    try {
      console.error(`Discovering API endpoints for source code using swagger extract...`);
      
      // Import required modules
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      // Use the provided project path for resolving all relative paths
      const workspacePath = projectPath;
      
      // Log the workspace paths for debugging
      console.error(`Using project path: ${workspacePath}`);
      console.error(`Current working directory: ${process.cwd()}`);
      
      // Convert any relative source paths to absolute paths
      const absoluteSourcePaths = sourcePaths.map(sourcePath => {
        if (!sourcePath.startsWith('/')) {
          const absolutePath = path.resolve(workspacePath, sourcePath);
          console.error(`Converting relative path '${sourcePath}' to absolute path '${absolutePath}'`);
          return absolutePath;
        }
        return sourcePath;
      });

      // Handle single language or multiple languages
      let languages: Array<'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby'>;
      
      if (Array.isArray(options.lang)) {
        languages = options.lang;
        console.error(`Multiple languages requested: ${languages.join(', ')}`);
      } else if (options.lang) {
        languages = [options.lang];
        console.error(`Single language requested: ${options.lang}`);
      } else {
        throw new Error("Language is required for API discovery");
      }

      // Validate languages
      if (languages.length === 0) {
        throw new Error("At least one language must be specified for API discovery");
      }

      // Build the CLI command arguments based on the NightVision CLI
      const args = ['swagger', 'extract', ...absoluteSourcePaths];
      
      // Add output file name with absolute path to a writable directory
      // Lazily create a unique per-call temp directory for output redirects, so
      // concurrent discoveries that share an output base name do not collide.
      let tempDir: string | null = null;
      const redirectDir = (): string => {
        if (tempDir === null) {
          tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightvision-discover-'));
        }
        return tempDir;
      };
      let outputFile: string;
      
      // Handle absolute or relative output paths
      if (options.output.startsWith('/')) {
        // If it's trying to write to root directory, redirect to tmp
        const dirname = path.dirname(options.output);
        const basename = path.basename(options.output);
        
        if (dirname === '/' || !fs.existsSync(dirname)) {
          outputFile = path.join(redirectDir(), basename);
          console.error(`Warning: Redirecting output from ${options.output} to ${outputFile} due to potential permissions issues`);
        } else {
          outputFile = options.output;
        }
      } else {
        // If relative path, convert to absolute using workspace path
        outputFile = path.resolve(workspacePath, options.output);
        console.error(`Converting relative output path '${options.output}' to absolute path '${outputFile}'`);
      }
      
      // Test if the output directory is writable
      try {
        const testDir = path.dirname(outputFile);
        fs.accessSync(testDir, fs.constants.W_OK);
      } catch (err) {
        console.error(`Output directory is not writable, redirecting to temp directory`);
        outputFile = path.join(redirectDir(), path.basename(outputFile));
      }
      
      // For multiple languages, we need to run the command multiple times
      // and merge the results
      if (languages.length > 1) {
        // Use a different output file for each language
        const results: string[] = [];
        const outputs: string[] = [];

        for (const lang of languages) {
          const langOutputFile = languageOutputPath(outputFile, lang);
          console.error(`Processing language: ${lang} with output: ${langOutputFile}`);
          
          // Build command arguments for this language
          const langArgs = [...args];
          
          // Add language option
          langArgs.push('--lang', lang);
          
          // Add target information if provided
          if (options.target) {
            langArgs.push('--target', options.target);
          }
          
          if (options.target_id) {
            langArgs.push('--target-id', options.target_id);
          }
          
          // Add project information if provided
          if (options.project) {
            langArgs.push('--project', options.project);
          }
          
          if (options.project_id) {
            langArgs.push('--project-id', options.project_id);
          }
          
          // Add the vetted output file to arguments
          langArgs.push('--output', langOutputFile);
          
          // Add exclude patterns if provided
          if (options.exclude) {
            langArgs.push('--exclude', options.exclude);
          }
          
          // Add version if provided
          if (options.version) {
            langArgs.push('--version', options.version);
          }
          
          // Add no-upload flag (default to true for safety)
          if (options.no_upload !== false) {
            langArgs.push('--no-upload');
          }
          
          // Add dump-code flag if requested
          if (options.dump_code) {
            langArgs.push('--dump-code');
          }

          try {
            // Execute the CLI command for this language (concurrency-limited)
            const result = await extractLimiter.run(() => this.executeCommand(langArgs, format));
            results.push(`🔍 Language: ${lang}\n${result}`);
            outputs.push(langOutputFile);
          } catch (cliError: any) {
            // Log the error but continue with other languages
            const errorMessage = cliError.message;
            console.error(`Error discovering API for language ${lang}: ${errorMessage}`);
            results.push(`❌ Language: ${lang}\n${errorMessage}`);
          }
        }

        // Combine the results
        const combinedResult = results.join('\n\n---\n\n');
        const outputInfo = `\nOpenAPI Specification Files:\n${outputs.map(o => `- ${o}`).join('\n')}`;
        
        return combinedResult + outputInfo;
      } else {
        // Single language processing (original implementation)
        // Add mandatory language option
        args.push('--lang', languages[0]);
        
        // Add target information if provided
        if (options.target) {
          args.push('--target', options.target);
        }
        
        if (options.target_id) {
          args.push('--target-id', options.target_id);
        }
        
        // Add project information if provided
        if (options.project) {
          args.push('--project', options.project);
        }
        
        if (options.project_id) {
          args.push('--project-id', options.project_id);
        }
        
        // Add the vetted output file to arguments
        args.push('--output', outputFile);
        
        // Add exclude patterns if provided
        if (options.exclude) {
          args.push('--exclude', options.exclude);
        }
        
        // Add version if provided
        if (options.version) {
          args.push('--version', options.version);
        }
        
        // Add no-upload flag (default to true for safety)
        if (options.no_upload !== false) {
          args.push('--no-upload');
        }
        
        // Add dump-code flag if requested
        if (options.dump_code) {
          args.push('--dump-code');
        }

        try {
          // Execute the CLI command (concurrency-limited)
          const result = await extractLimiter.run(() => this.executeCommand(args, format));
          
          // Log the raw command output to help with debugging
          console.error(`Command result: ${result.substring(0, 500)}${result.length > 500 ? '...' : ''}`);
          console.error(`Output file location: ${outputFile}`);
          
          // Add information about output file path to the result
          // but preserve the original command output
          const outputInfo = `\nOpenAPI Specification File: ${outputFile}`;
          
          // Make sure we're returning the full CLI output followed by our output file information
          console.error(`Returning the command output with file path information appended`);
          return result + outputInfo;
        } catch (cliError: any) {
          // Enrich error message with more context about the command
          const errorMessage = cliError.message;
          
          if (errorMessage.includes("0 paths discovered")) {
            // Provide lightweight error message
            throw new Error(`No API endpoints found in [${sourcePaths.join(', ')}] using ${languages[0]}. Try more specific directories.`);
          }
          
          // Check for file system errors and handle them explicitly
          if (errorMessage.includes("read-only file system") || 
              errorMessage.includes("permission denied") || 
              errorMessage.includes("no such file or directory")) {
            
            throw new Error(`File system error: Unable to write to ${outputFile}. 
            
This may be due to permissions issues. Try specifying a different output location where you have write permissions.`);
          }
          
          // Check for buffer exceeded errors
          if (errorMessage.includes("maxBuffer length exceeded")) {
            throw new Error(`Output too large. Try analyzing smaller directories or using the 'exclude' parameter to filter files.`);
          }
          
          throw cliError;
        }
      }
    } catch (error: any) {
      console.error(`Error discovering API endpoints: ${error.message}`);
      throw new Error(`Failed to discover API endpoints: ${error.message}`);
    }
  }

  /**
   * Get project details by name using the API
   * @param projectName Name of the project
   * @returns Project data
   * @throws Error if project not found or API error
   */
  async getProjectByName(projectName: string): Promise<any> {
    try {
      console.error(`Getting details for project: ${projectName}`);
      
      // Use the project name endpoint to get details
      const response = await this.apiRequest<any>(
        `projects/name/${encodeURIComponent(projectName)}/`,
        'GET'
      );
      
      // Check if response contains results
      if (!response || !response.results || !response.results[0]) {
        throw new Error(`Project '${projectName}' not found or has no data.`);
      }
      
      // Return the first project in results
      return response.results[0];
    } catch (error: any) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`Project '${projectName}' not found. Please check the project name and try again.`);
      }
      
      console.error(`Error getting project details: ${error.message}`);
      throw new Error(`Failed to get project details: ${error.message}`);
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
      const response = await this.apiRequest<any>(
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
      const response = await this.apiRequest<any>(
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

  /**
   * Record traffic for a target using browser automation
   * @param name Name for the traffic recording
   * @param url URL to record traffic from
   * @param target Target name
   * @param project Project name
   * @param format Output format
   * @returns Result of the recording operation
   */
  async recordTraffic(
    name: string,
    url: string,
    target: string,
    project: string,
    format: OutputFormat = 'text'
  ): Promise<string> {
    try {
      console.error(`Recording traffic from ${url} for target ${target} in project ${project} with name ${name}...`);
      
      // Validate required parameters
      if (!name || name.trim() === '') {
        throw new Error("Recording name is required");
      }
      
      if (!url || url.trim() === '') {
        throw new Error("URL is required");
      }
      
      if (!target || target.trim() === '') {
        throw new Error("Target name is required");
      }
      
      if (!project || project.trim() === '') {
        throw new Error("Project name is required");
      }
      
      // Build CLI command
      const args = ['traffic', 'record', name, url, '--target', target, '--project', project];
      
      // Execute the command
      // Note: This will open a browser window that the user will interact with and then close
      console.error(`Executing traffic record command. A browser window will open for recording...`);
      console.error(`After recording (closing the browser), the HAR file will be automatically uploaded to NightVision.`);
      
      const result = await this.executeCommand(args, format);
      
      console.error(`Traffic recording completed successfully.`);
      
      return result;
    } catch (error: any) {
      console.error(`Error recording traffic: ${error.message}`);
      
      // Check for common errors
      if (error.message.includes('browser failed')) {
        throw new Error(`Browser automation failed. Please check that you have a compatible browser installed.`);
      }
      
      if (error.message.includes('not found') && error.message.includes('target')) {
        throw new Error(`Target "${target}" not found. Please check that the target exists in the specified project.`);
      }
      
      if (error.message.includes('not found') && error.message.includes('project')) {
        throw new Error(`Project "${project}" not found. Please check that the project exists and you have access to it.`);
      }
      
      throw new Error(`Failed to record traffic: ${error.message}`);
    }
  }

  /**
   * List traffic files for a target
   * @param target Target name
   * @param project Project name
   * @param format Output format
   * @returns List of traffic files
   */
  async listTraffic(
    target: string,
    project: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Listing traffic files for target ${target} in project ${project}...`);
      
      // Validate required parameters
      if (!target || target.trim() === '') {
        throw new Error("Target name is required");
      }
      
      if (!project || project.trim() === '') {
        throw new Error("Project name is required");
      }
      
      // Build CLI command
      const args = ['traffic', 'list', target, '--project', project];
      
      // Execute the command
      const result = await this.executeCommand(args, format);
      
      return result;
    } catch (error: any) {
      console.error(`Error listing traffic files: ${error.message}`);
      
      // Check for common errors
      if (error.message.includes('not found') && error.message.includes('target')) {
        throw new Error(`Target "${target}" not found. Please check that the target exists in the specified project.`);
      }
      
      if (error.message.includes('not found') && error.message.includes('project')) {
        throw new Error(`Project "${project}" not found. Please check that the project exists and you have access to it.`);
      }
      
      throw new Error(`Failed to list traffic files: ${error.message}`);
    }
  }

  /**
   * Download a traffic file (HAR) for a target
   * @param name Name of the traffic file to download
   * @param target Target name
   * @param project Project name
   * @param outputFile Optional path where to save the downloaded HAR file
   * @param downloadPath Optional path to download the file to
   * @param format Output format
   * @returns Result of the download operation
   */
  async downloadTraffic(
    name: string,
    target: string,
    project: string,
    outputFile?: string,
    downloadPath?: string,
    format: OutputFormat = 'text'
  ): Promise<string> {
    try {
      console.error(`Downloading traffic file ${name} for target ${target} in project ${project}...`);
      
      // Validate required parameters
      if (!name || name.trim() === '') {
        throw new Error("Traffic file name is required");
      }
      
      if (!target || target.trim() === '') {
        throw new Error("Target name is required");
      }
      
      if (!project || project.trim() === '') {
        throw new Error("Project name is required");
      }
      
      // Import required modules
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      
      // Ensure we have a valid, writable download path
      if (!downloadPath || downloadPath.trim() === '') {
        downloadPath = os.tmpdir();
        console.error(`No download path provided, using temp directory: ${downloadPath}`);
      }
      
      // Create a temporary directory for the download
      const tempDownloadDir = path.join(downloadPath, 'nightvision-downloads');
      await fs.mkdir(tempDownloadDir, { recursive: true });
      
      // The CLI downloads into the temp dir, set as the child's working directory.
      
      // Build CLI command
      const args = ['traffic', 'download', name, '--target', target, '--project', project];

      // Execute the command to download the file
      const result = await this.executeCommand(args, format, false, tempDownloadDir);
        
      // Default download location will be the temp directory with the name of the file
      const tempFilePath = path.join(tempDownloadDir, `${name}.har`);
      
      // Verify the file was downloaded
      try {
        await fs.access(tempFilePath);
      } catch (err) {
        throw new Error(`Failed to download the file. The file was not found at ${tempFilePath}.`);
      }
      
      // Move the file to the final output path if specified
      let finalOutputPath = tempFilePath;
      
      if (outputFile && outputFile.trim() !== '') {
        try {
          // Create the target directory if needed
          const outputDir = path.dirname(outputFile);
          await fs.mkdir(outputDir, { recursive: true });
          
          // Copy the file to the destination
          await fs.copyFile(tempFilePath, outputFile);
          
          // Successful copy, use the outputFile as the final path
          finalOutputPath = outputFile;
          console.error(`Copied traffic file from ${tempFilePath} to ${finalOutputPath}`);
          
          // Remove the temporary file
          await fs.unlink(tempFilePath);
        } catch (err) {
          console.error(`Error copying file to final destination: ${err}`);
          console.error(`Keeping the file at temporary location: ${tempFilePath}`);
          // Keep the fallback path
        }
      }
      
      console.error(`Traffic file downloaded successfully to: ${finalOutputPath}`);

      return result;
    } catch (error: any) {
      console.error(`Error downloading traffic file: ${error.message}`);
      
      // Check for common errors
      if (error.message.includes('not found') && error.message.includes('traffic')) {
        throw new Error(`Traffic file "${name}" not found. Please check the name and use the list-traffic tool to see available files.`);
      }
      
      if (error.message.includes('not found') && error.message.includes('target')) {
        throw new Error(`Target "${target}" not found. Please check that the target exists in the specified project.`);
      }
      
      if (error.message.includes('not found') && error.message.includes('project')) {
        throw new Error(`Project "${project}" not found. Please check that the project exists and you have access to it.`);
      }
      
      throw new Error(`Failed to download traffic file: ${error.message}`);
    }
  }
}

// Export a singleton instance
export default new NightVisionService(); 