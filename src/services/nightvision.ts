import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import FormData from 'form-data';
import { ENVIRONMENT } from '../config/environment.js';

// Promisify exec for cleaner async/await usage
const execAsync = promisify(exec);

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
    isFormData: boolean = false
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
        data
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
   * @param skipToken Whether to skip adding the current token to the command
   * @returns Command output
   */
  async executeCommand(
    args: string[],
    format: OutputFormat = 'text',
    skipToken: boolean = false
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
      
      // Add token if available and not skipped
      if (this.token && !skipToken) {
        commandArgs.push('--token', this.token);
      }
      
      // Create the full command
      const command = ['nightvision', ...commandArgs]
        .map(arg => arg.includes(' ') ? `"${arg}"` : arg)
        .join(' ');
      
      console.error(`Executing: ${command}`);
      
      // Execute the command directly with increased buffer size (50MB)
      const { stdout, stderr } = await execAsync(command, { 
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer size (default is 1MB)
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
        await execAsync(`nightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
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
      
      // Build query parameters
      const params: Record<string, any> = {};
      
      if (options.target) {
        params.target_name = options.target;
      }
      
      if (options.project) {
        params.project_name = options.project;
      }
      
      if (options.project_id) {
        params.project_id = options.project_id;
      }
      
      if (options.limit) {
        params.limit = options.limit;
      }
      
      if (options.status && options.status !== 'all') {
        params.status = options.status;
      }
      
      // Make API request to list scans
      const response = await this.apiRequest<any>(
        'scans/',
        'GET',
        params
      );
      
      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'table') {
        // Create a simple table format for text output
        // This is a basic implementation - could be improved
        const headers = ['ID', 'Target', 'Status', 'Created', 'Project'];
        const rows = response.results.map((scan: any) => [
          scan.id,
          scan.target?.name || 'N/A',
          scan.status || 'N/A',
          scan.created || 'N/A',
          scan.project?.name || 'N/A'
        ]);
        
        // Simple table formatting
        const table = [
          headers.join('\t'),
          headers.map(() => '----').join('\t'),
          ...rows.map((row: string[]) => row.join('\t'))
        ].join('\n');
        
        return table;
      }
      
      // Default to just returning the raw data as string
      return JSON.stringify(response);
    } catch (error: any) {
      console.error(`Error listing scans: ${error.message}`);
      throw new Error(`Failed to list scans: ${error.message}`);
    }
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
        `scans/${scanId}/`,
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
      
      // Add each severity as a separate query parameter
      // This will be serialized as &severity=critical&severity=high etc.
      params.severity = options.severity;
      
      // Add each status as a separate query parameter
      // This will be serialized as &status=0&status=1 etc.
      params.status = options.status;
      
      // Make API request to get checks
      const response = await this.apiRequest<any>(
        `scans/${scanId}/checks/`,
        'GET',
        params
      );
      
      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'text') {
        return this.formatChecksAsText(response);
      } else if (format === 'table') {
        return this.formatChecksAsTable(response);
      }
      
      return JSON.stringify(response);
    } catch (error) {
      console.error(`Error getting scan checks: ${error}`);
      throw new Error(`Failed to get scan checks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Format scan checks as plain text
   * @param checks Check data from API
   * @returns Formatted text output
   */
  private formatChecksAsText(checks: any): string {
    if (!checks || !Array.isArray(checks.results)) {
      return 'No vulnerabilities found or invalid response format.';
    }
    
    const results = checks.results;
    let output = `Scan Vulnerabilities (${results.length}):\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const check = results[i];
      output += `Vulnerability ${i + 1}: ${check.check_kind || 'Unknown'}\n`;
      output += `ID: ${check.id || 'N/A'}\n`;
      output += `Severity: ${check.severity || 'N/A'}\n`;
      output += `Status: ${check.status || 'N/A'}\n`;
      output += `Path: ${check.path || 'N/A'}\n`;
      output += `Created: ${check.created || 'N/A'}\n\n`;
    }
    
    if (checks.count > results.length) {
      output += `Note: Showing ${results.length} of ${checks.count} total vulnerabilities. Use 'limit' and 'offset' to see more.\n`;
    }
    
    return output;
  }

  /**
   * Format scan checks as a table
   * @param checks Check data from API
   * @returns Formatted table output
   */
  private formatChecksAsTable(checks: any): string {
    if (!checks || !Array.isArray(checks.results)) {
      return 'No vulnerabilities found or invalid response format.';
    }
    
    const results = checks.results;
    
    // Create table headers
    const headers = ['#', 'Kind', 'Severity', 'Status', 'Path', 'Created'];
    const rows: string[][] = [];
    
    // Add data rows
    for (let i = 0; i < results.length; i++) {
      const check = results[i];
      rows.push([
        (i + 1).toString(),
        check.check_kind || 'N/A',
        check.severity || 'N/A',
        check.status || 'N/A',
        check.path || 'N/A',
        check.created || 'N/A'
      ]);
    }
    
    // Format as ASCII table
    const table = this.formatAsTable(headers, rows);
    
    // Add pagination info if applicable
    let output = table;
    if (checks.count > results.length) {
      output += `\nNote: Showing ${results.length} of ${checks.count} total vulnerabilities. Use 'limit' and 'offset' to see more.\n`;
    }
    
    return output;
  }

  /**
   * Format data as an ASCII table
   * @param headers Table headers
   * @param rows Table data rows
   * @returns Formatted table string
   */
  private formatAsTable(headers: string[], rows: string[][]): string {
    if (headers.length === 0 || rows.length === 0) {
      return 'No data to display';
    }
    
    // Calculate column widths
    const colWidths = headers.map((h, i) => {
      const maxDataLength = Math.max(...rows.map(r => r[i]?.toString().length || 0));
      return Math.max(h.length, maxDataLength);
    });
    
    // Generate header row
    const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ');
    
    // Generate separator row
    const separatorRow = colWidths.map(w => '-'.repeat(w)).join('-+-');
    
    // Generate data rows
    const dataRows = rows.map(row => 
      row.map((cell, i) => (cell || '').toString().padEnd(colWidths[i])).join(' | ')
    );
    
    // Combine all rows
    return [headerRow, separatorRow, ...dataRows].join('\n');
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
        `scans/${scanId}/paths/`,
        'GET',
        params
      );
      
      // Format the response according to the requested format
      if (format === 'json') {
        return JSON.stringify(response, null, 2);
      } else if (format === 'text') {
        return this.formatPathsAsText(response);
      } else if (format === 'table') {
        return this.formatPathsAsTable(response);
      }
      
      return JSON.stringify(response);
    } catch (error) {
      console.error(`Error getting scan paths: ${error}`);
      throw new Error(`Failed to get scan paths: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Format scan paths as plain text
   * @param paths Paths data from API
   * @returns Formatted text output
   */
  private formatPathsAsText(paths: any): string {
    if (!paths || !Array.isArray(paths.results)) {
      return 'No paths found or invalid response format.';
    }
    
    const results = paths.results;
    let output = `Scan Checked Paths (${results.length}):\n\n`;
    
    for (let i = 0; i < results.length; i++) {
      const path = results[i];
      output += `Path ${i + 1}: ${path.request_url || 'N/A'}\n`;
      output += `Method: ${path.request_method || 'N/A'}\n`;
      output += `Status Code: ${path.response_status_code || 'N/A'}\n`;
      output += `Date: ${path.added_date || 'N/A'}\n`;
      output += `Completed: ${path.completed ? 'Yes' : 'No'}\n\n`;
    }
    
    if (paths.count > results.length) {
      output += `Note: Showing ${results.length} of ${paths.count} total paths. Use 'page' and 'page_size' parameters for pagination.\n`;
    }
    
    return output;
  }

  /**
   * Format scan paths as a table
   * @param paths Paths data from API
   * @returns Formatted table output
   */
  private formatPathsAsTable(paths: any): string {
    if (!paths || !Array.isArray(paths.results)) {
      return 'No paths found or invalid response format.';
    }
    
    const results = paths.results;
    
    // Create table headers
    const headers = ['#', 'Method', 'URL', 'Status', 'Completed', 'Date'];
    const rows: string[][] = [];
    
    // Add data rows
    for (let i = 0; i < results.length; i++) {
      const path = results[i];
      rows.push([
        (i + 1).toString(),
        path.request_method || 'N/A',
        path.request_url || 'N/A',
        (path.response_status_code || 'N/A').toString(),
        path.completed ? 'Yes' : 'No',
        path.added_date || 'N/A'
      ]);
    }
    
    // Format as ASCII table
    const table = this.formatAsTable(headers, rows);
    
    // Add pagination info if applicable
    let output = table;
    if (paths.count > results.length) {
      output += `\nNote: Showing ${results.length} of ${paths.count} total paths. Use 'page' and 'page_size' parameters for pagination.\n`;
    }
    
    return output;
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
        `nuclei-templates/${templateId}/upload/`,
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
      lang: 'csharp' | 'go' | 'java' | 'js' | 'python' | 'ruby';
      target?: string;
      target_id?: string;
      project?: string;
      project_id?: string;
      output: string;
      exclude?: string;
      version?: string;
      no_upload?: boolean;
      dump_code?: boolean;
      verbose?: boolean;
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
      
      // Build the CLI command arguments based on the NightVision CLI
      const args = ['swagger', 'extract', ...absoluteSourcePaths];
      
      // Add mandatory language option
      if (options.lang) {
        args.push('--lang', options.lang);
      } else {
        throw new Error("Language is required for API discovery");
      }
      
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
      
      // Add output file name with absolute path to a writable directory
      // Use Node's os.tmpdir() to get system temp directory that should be writable
      const tempDir = os.tmpdir();
      let outputFile: string;
      
      // Handle absolute or relative output paths
      if (options.output.startsWith('/')) {
        // If it's trying to write to root directory, redirect to tmp
        const dirname = path.dirname(options.output);
        const basename = path.basename(options.output);
        
        if (dirname === '/' || !fs.existsSync(dirname)) {
          outputFile = path.join(tempDir, basename);
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
        outputFile = path.join(tempDir, path.basename(outputFile));
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

      // Remove verbose flag completely - always keep verbosity off to prevent large outputs
      // Ignoring the options.verbose parameter input
      // if (options.verbose) {
      //   args.push('--verbose');
      // }
      
      try {
        // Execute the CLI command
        const result = await this.executeCommand(args, format);
        
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
          throw new Error(`No API endpoints found in [${sourcePaths.join(', ')}] using ${options.lang}. Try more specific directories.`);
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
        `projects/name/${projectName}/`,
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
      search?: string;
      limit?: number;
      offset?: number;
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
      
      if (options.search) {
        params.search = options.search;
      }
      
      if (options.limit) {
        params.limit = options.limit;
      }
      
      if (options.offset) {
        params.offset = options.offset;
      }
      
      // Make API request to list templates
      const response = await this.apiRequest<any>(
        'nuclei-templates/',
        'GET',
        params
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
        const headers = ['ID', 'Name', 'Description', 'Project', 'Created'];
        
        // Extract rows from the results
        const rows = response.results.map((template: any) => [
          template.id || 'N/A',
          template.name || 'N/A',
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
        `targets/${targetId}/nuclei-templates/assign/`,
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

// Export a singleton instance
export default new NightVisionService(); 