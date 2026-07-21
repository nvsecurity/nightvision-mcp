import { execFile } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { ENVIRONMENT } from '../config/environment.js';
import { extractCliVersion } from '../utils/cli-version.js';

// Promisify execFile for cleaner async/await usage
const execFileAsync = promisify(execFile);

/**
 * Supported output formats for NightVision commands
 */
export type OutputFormat = 'text' | 'json' | 'table';

/**
 * Base client for NightVision API (HTTP) and CLI interactions.
 * Holds the auth token and the low-level request/exec primitives shared by
 * every domain service. Domain services receive an instance of this class.
 */
export class ApiClient {
  private token: string | null = null;

  /**
   * Set the authentication token for NightVision commands
   */
  setToken(token: string | null): void {
    this.token = token;
  }

  /**
   * Get the current authentication token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Get HTTP headers for API requests
   */
  private getApiHeaders() {
    return {
      'Authorization': this.token ? `Token ${this.token}` : '',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get base URL for API requests
   */
  private getApiBaseUrl(): string {
    return ENVIRONMENT.CURRENT_API_URL;
  }

  /**
   * Make an API request using Axios
   */
  async apiRequest<T>(
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
        const wrapped = new Error(`API request failed (${statusCode}): ${errorMessage}`) as Error & {
          statusCode?: number;
          isNetworkError?: boolean;
        };
        // Preserve the HTTP status (undefined for a pure network/DNS failure with
        // no response) so callers can distinguish an auth rejection (401/403)
        // from a transient connectivity problem.
        wrapped.statusCode = statusCode;
        wrapped.isNetworkError = !error.response;
        throw wrapped;
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

      const cliPath = ENVIRONMENT.NIGHTVISION_CLI_PATH;
      console.error(`Executing: ${[cliPath, ...commandArgs].join(' ')}`);

      // Invoke the binary directly with an argument vector (no shell), with an
      // increased buffer size (50MB)
      const { stdout, stderr } = await execFileAsync(cliPath, commandArgs, {
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
      // Preserve the CLI's own stderr and exit code on the thrown error so
      // callers can tell a connectivity/5xx failure from a real rejection.
      // execFile truncates stderr inside error.message, so surface it directly.
      const wrapped = new Error(`NightVision command failed: ${error.message}`) as Error & {
        stderr?: string;
        cliExitCode?: unknown;
      };
      wrapped.stderr = typeof error?.stderr === 'string' ? error.stderr : undefined;
      wrapped.cliExitCode = error?.code;
      throw wrapped;
    }
  }

  /**
   * Check if NightVision CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      await execFileAsync(ENVIRONMENT.NIGHTVISION_CLI_PATH, ['version'], {
        maxBuffer: 1024 * 1024,
        env: { ...process.env }
      });
      return true;
    } catch (error: any) {
      // Distinguish "cannot run the binary at all" from "ran but exited non-zero".
      // Some CLI versions fetch remote configuration even for basic commands and
      // may exit non-zero when offline or DNS-restricted; that should surface in
      // doctor/version checks, not prevent the MCP server from starting. But a
      // missing (ENOENT), unexecutable (EACCES), or wrong-arch/corrupt (ENOEXEC)
      // binary genuinely is not usable and must report not-installed.
      const code = error?.code;
      if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOEXEC') {
        return false;
      }
      return true;
    }
  }

  /**
   * Get the installed NightVision CLI version as major.minor.patch.
   * @returns The version string, or null if it cannot be determined (for
   *   example a dev build that reports no version number)
   */
  async getCliVersion(): Promise<string | null> {
    try {
      const output = await this.executeCommand(['version']);
      return extractCliVersion(output);
    } catch {
      return null;
    }
  }

  /**
   * Look up a project by name.
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
   * Generic ASCII table formatter used by domain services
   */
  formatAsTable(headers: string[], rows: string[][]): string {
    if (headers.length === 0 || rows.length === 0) {
      return 'No data to display';
    }

    const colWidths = headers.map((h, i) => {
      const maxDataLength = Math.max(...rows.map(r => r[i]?.toString().length || 0));
      return Math.max(h.length, maxDataLength);
    });

    const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ');
    const separatorRow = colWidths.map(w => '-'.repeat(w)).join('-+-');
    const dataRows = rows.map(row =>
      row.map((cell, i) => (cell || '').toString().padEnd(colWidths[i])).join(' | ')
    );

    return [headerRow, separatorRow, ...dataRows].join('\n');
  }
}
