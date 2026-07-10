import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Export scan result artifacts.
 */
export class ExportService {
  constructor(private client: ApiClient) {}

  /**
   * Export scan results as SARIF.
   */
  async exportSarif(
    scanId: string,
    outputPath: string,
    options: {
      swagger_file?: string;
      randomize_issue_ids?: boolean;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    const args = ['export', 'sarif', '--scan-id', scanId, '--output', outputPath];

    if (options.swagger_file) {
      args.push('--swagger-file', options.swagger_file);
    }

    if (options.randomize_issue_ids) {
      args.push('--randomize-issue-ids');
    }

    return this.client.executeCommand(args, format);
  }

  /**
   * Export scan results as CSV.
   */
  async exportCsv(
    scanId: string,
    outputPath: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    return this.client.executeCommand(['export', 'csv', '--scan-id', scanId, '--output', outputPath], format);
  }
}
