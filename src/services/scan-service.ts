import { serializeRepeatedParams } from '../utils/query-params.js';
import { scanStatusFilterCodes } from '../utils/scan-status.js';
import type { ConfiguredChecks } from '../utils/check-catalog.js';
import { formatScanChecksText, formatScanChecksTable } from '../utils/scan-check-format.js';
import { formatScansTable } from '../utils/scan-list-format.js';
import { formatScanPathsText, formatScanPathsTable } from '../utils/scan-path-format.js';
import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Minimal resolution surface ScanService needs to turn target/project names
 * into ids. Supplied by the facade so name-resolution stays interceptable
 * (the facade routes these through its own public methods).
 */
export interface ScanResolver {
  resolveTargetId(name: string, project?: string, projectId?: string): Promise<string>;
  getProjectByName(projectName: string): Promise<any>;
}

/**
 * Scan lifecycle, status, checks and paths.
 */
export class ScanService {
  private cachedChecks: ConfiguredChecks | null = null;

  constructor(private client: ApiClient, private resolver: ScanResolver) {}

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
      disable_zap_active_alerts?: string[];
      disable_nuclei_folders?: string[];
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

    if (options.disable_zap_active_alerts && options.disable_zap_active_alerts.length > 0) {
      args.push('--disable-zap-active-alerts', options.disable_zap_active_alerts.join(','));
    }

    if (options.disable_nuclei_folders && options.disable_nuclei_folders.length > 0) {
      args.push('--disable-nuclei-folders', options.disable_nuclei_folders.join(','));
    }

    // Execute the command with standard parameters
    const result = await this.client.executeCommand(args, format);

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
        const targetId = await this.resolver.resolveTargetId(
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
        const project = await this.resolver.getProjectByName(options.project);
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
      const response = await this.client.apiRequest<any>(
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
      const response = await this.client.apiRequest<any>(
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
      const response = await this.client.apiRequest<any>(
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
      const response = await this.client.apiRequest<any>(
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
   * Fetch the configured check catalog from the API.
   * Cached for the lifetime of the server process.
   */
  async getConfiguredChecks(): Promise<ConfiguredChecks> {
    if (this.cachedChecks) return this.cachedChecks;
    const response = await this.client.apiRequest<ConfiguredChecks>('common/configured-checks/', 'GET');
    this.cachedChecks = response;
    return response;
  }
}
