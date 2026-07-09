import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Target lifecycle and lookup operations.
 */
export class TargetService {
  constructor(private client: ApiClient) {}

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

    return this.client.executeCommand(args, format);
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

    return this.client.executeCommand(args, format);
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

    return this.client.executeCommand(args, format);
  }

  /**
   * List additional paths for a URL target
   */
  async listAdditionalPaths(targetId: string): Promise<any> {
    return this.client.apiRequest<any>(`targets/url/${encodeURIComponent(targetId)}/additional-paths/`, 'GET');
  }

  /**
   * Create additional paths for a URL target (bulk)
   */
  async createAdditionalPaths(targetId: string, paths: { path: string; disabled?: boolean }[]): Promise<any> {
    return this.client.apiRequest<any>(`targets/url/${encodeURIComponent(targetId)}/additional-paths/`, 'POST', {}, paths);
  }

  /**
   * Lightweight target lookup by name. Uses the API filter param to avoid
   * fetching all targets. Returns matching targets with their projects.
   */
  async findTarget(name: string): Promise<{ name: string; id: string; project_name: string; project_id: string; location: string; type: string }[]> {
    const response = await this.client.apiRequest<any>('targets/', 'GET', {
      filter: name,
      page_size: 20,
    });

    const results = response?.results || [];
    return results.map((t: any) => ({
      name: t.name,
      id: t.id,
      project_name: t.project_name || t.project?.name || 'Unknown',
      project_id: t.project || t.project_id || '',
      location: t.location || '',
      type: t.type || '',
    }));
  }
}
