import { serializeRepeatedParams } from '../utils/query-params.js';
import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Issue/finding listing, details, stats and occurrences.
 */
export class IssueService {
  constructor(private client: ApiClient) {}

  private readonly SENSITIVE_HEADERS = new Set([
    'authorization', 'cookie', 'set-cookie', 'x-csrf-token',
    'x-api-key', 'proxy-authorization', 'www-authenticate',
  ]);

  private redactHeaderValue(name: string, value: string): string {
    if (this.SENSITIVE_HEADERS.has(name.toLowerCase())) {
      return '[REDACTED]';
    }
    return value;
  }

  /**
   * Sanitize sensitive headers and cookies in raw API response data.
   * Applied so all output formats get consistent redaction.
   */
  private sanitizeResponseData(data: any): any {
    if (!data) return data;

    if (Array.isArray(data)) {
      return data.map((d) => this.sanitizeResponseData(d));
    }

    if (data.results && Array.isArray(data.results)) {
      return { ...data, results: data.results.map((d: any) => this.sanitizeResponseData(d)) };
    }

    if (data.extra_info) {
      const extraInfo = { ...data.extra_info };

      if (Array.isArray(extraInfo.http_requests)) {
        extraInfo.http_requests = extraInfo.http_requests.map((req: any) => {
          const sanitized = { ...req };
          if (Array.isArray(sanitized.headers)) {
            sanitized.headers = sanitized.headers.map((h: any) => ({
              ...h, value: this.redactHeaderValue(h.name, h.value)
            }));
          }
          if (Array.isArray(sanitized.cookies)) {
            sanitized.cookies = sanitized.cookies.map((c: any) => ({
              ...c, value: '[REDACTED]'
            }));
          }
          return sanitized;
        });
      }

      if (Array.isArray(extraInfo.http_responses)) {
        extraInfo.http_responses = extraInfo.http_responses.map((resp: any) => {
          const sanitized = { ...resp };
          if (Array.isArray(sanitized.headers)) {
            sanitized.headers = sanitized.headers.map((h: any) => ({
              ...h, value: this.redactHeaderValue(h.name, h.value)
            }));
          }
          return sanitized;
        });
      }

      return { ...data, extra_info: extraInfo };
    }

    return data;
  }

  async listIssues(
    scanId: string,
    options: {
      page?: number;
      page_size?: number;
      severity?: string[];
      resolution?: number[];
      kind?: number[];
      filter?: string;
    } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Listing issues for scan ${scanId} via API...`);

      const params: Record<string, any> = { scan: scanId };
      if (options.page) params.page = options.page;
      params.page_size = options.page_size || 50;
      if (options.severity) params.severity = options.severity;
      if (options.resolution) params.resolution = options.resolution;
      if (options.kind) params.kind = options.kind;
      if (options.filter) params.filter = options.filter;

      const response = this.sanitizeResponseData(
        await this.client.apiRequest<any>('issues/', 'GET', params, null, false, serializeRepeatedParams)
      );

      if (format === 'text') return this.formatIssuesAsText(response);
      if (format === 'table') return this.formatIssuesAsTable(response);
      return JSON.stringify(response, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to list issues: ${error.message}`);
    }
  }

  async getIssueDetails(
    issueId: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Getting issue details for ${issueId} via API...`);
      const response = this.sanitizeResponseData(
        await this.client.apiRequest<any>(`issues/${encodeURIComponent(issueId)}/`, 'GET')
      );

      if (format === 'text') return this.formatSingleIssueAsText(response);
      return JSON.stringify(response, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to get issue details: ${error.message}`);
    }
  }

  async getIssueKindStats(
    scanId: string,
    options: { filter?: string } = {},
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Getting issue kind stats for scan ${scanId}...`);
      const params: Record<string, any> = { scan: scanId };
      if (options.filter) params.filter = options.filter;

      const response = await this.client.apiRequest<any>('issues/kind/', 'GET', params);

      if (format === 'table') return this.formatIssueKindStatsAsTable(response);
      return JSON.stringify(response, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to get issue kind stats: ${error.message}`);
    }
  }

  async getVulnerablePaths(
    scanId: string,
    options: {
      kind?: number[];
      nuclei_template?: string[];
      resolution?: number[];
      filter?: string;
    } = {}
  ): Promise<string> {
    try {
      console.error(`Getting vulnerable paths for scan ${scanId}...`);
      const params: Record<string, any> = { scan: scanId };
      if (options.kind) params.kind = options.kind;
      if (options.nuclei_template) params.nuclei_template = options.nuclei_template;
      if (options.resolution) params.resolution = options.resolution;
      if (options.filter) params.filter = options.filter;

      const response = await this.client.apiRequest<any>('issues/vulnerable-paths/', 'GET', params, null, false, serializeRepeatedParams);
      return JSON.stringify(response, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to get vulnerable paths: ${error.message}`);
    }
  }

  async getIssueOccurrences(
    data: {
      scan_id: string;
      url_path: string;
      http_method: string;
      kind_id?: number;
      nuclei_template_id?: string;
      parameter_name?: string;
      resolution?: number[];
    }
  ): Promise<string> {
    try {
      console.error(`Getting issue occurrences for scan ${data.scan_id}...`);
      const body: Record<string, any> = {
        scan_id: data.scan_id,
        url_path: data.url_path,
        http_method: data.http_method,
      };
      if (data.kind_id !== undefined) body.kind_id = data.kind_id;
      if (data.nuclei_template_id) body.nuclei_template_id = data.nuclei_template_id;
      if (data.parameter_name) body.parameter_name = data.parameter_name;
      if (data.resolution) body.resolution = data.resolution;

      const response = this.sanitizeResponseData(
        await this.client.apiRequest<any>('issues/occurrences/', 'POST', {}, body)
      );
      return JSON.stringify(response, null, 2);
    } catch (error: any) {
      throw new Error(`Failed to get issue occurrences: ${error.message}`);
    }
  }

  private formatIssuesAsText(data: any): string {
    const results = data?.results || [];
    if (results.length === 0) return 'No findings found.';

    let output = `Findings (${results.length} of ${data.count || results.length}):\n\n`;
    for (let i = 0; i < results.length; i++) {
      output += this.formatSingleIssueAsText(results[i]);
      if (i < results.length - 1) output += '\n---\n\n';
    }
    return output;
  }

  private formatSingleIssueAsText(issue: any): string {
    let output = '';
    output += `Finding: ${issue.kind?.name || issue.nuclei_template?.name || 'Unknown'}\n`;
    output += `ID: ${issue.id}\n`;
    output += `Severity: ${issue.severity || 'N/A'}\n`;
    output += `Resolution: ${issue.resolution ?? 'N/A'}\n`;
    output += `Path: ${issue.url_path || 'N/A'}\n`;
    output += `Method: ${issue.http_method || 'N/A'}\n`;
    output += `Parameter: ${issue.parameter_name || 'N/A'} (${issue.parameter_type || 'N/A'})\n`;
    output += `Payload: ${issue.payload || 'N/A'}\n`;
    output += `Evidence: ${issue.evidence || 'N/A'}\n`;

    if (issue.ai_explanation) {
      output += `\nAI Explanation:\n${issue.ai_explanation}\n`;
    }

    const extraInfo = issue.extra_info || {};

    const requests = extraInfo.http_requests || [];
    if (requests.length > 0) {
      output += `\n--- HTTP Requests (${requests.length}) ---\n`;
      for (let j = 0; j < requests.length; j++) {
        const req = requests[j];
        output += `\nRequest ${j + 1}:\n`;
        output += `  URL: ${req.url || 'N/A'}\n`;
        output += `  Method: ${req.method || 'N/A'}\n`;
        if (req.headers && req.headers.length > 0) {
          output += `  Headers:\n`;
          for (const h of req.headers) {
            output += `    ${h.name}: ${this.redactHeaderValue(h.name, h.value)}\n`;
          }
        }
        if (req.postData) {
          output += `  Body: ${typeof req.postData === 'object' ? JSON.stringify(req.postData) : req.postData}\n`;
        }
        if (req.cookies && req.cookies.length > 0) {
          output += `  Cookies:\n`;
          for (const c of req.cookies) {
            output += `    ${c.name}=[REDACTED]\n`;
          }
        }
      }
    }

    const responses = extraInfo.http_responses || [];
    if (responses.length > 0) {
      output += `\n--- HTTP Responses (${responses.length}) ---\n`;
      for (let j = 0; j < responses.length; j++) {
        const resp = responses[j];
        output += `\nResponse ${j + 1}:\n`;
        output += `  Status: ${resp.status || 'N/A'} ${resp.statusText || ''}\n`;
        if (resp.headers && resp.headers.length > 0) {
          output += `  Headers:\n`;
          for (const h of resp.headers) {
            output += `    ${h.name}: ${this.redactHeaderValue(h.name, h.value)}\n`;
          }
        }
        if (resp.content) {
          const body = typeof resp.content === 'object'
            ? (resp.content.text || JSON.stringify(resp.content))
            : resp.content;
          const truncated = body.length > 2000 ? body.substring(0, 2000) + '... [truncated]' : body;
          output += `  Body: ${truncated}\n`;
        }
      }
    }

    return output;
  }

  private formatIssuesAsTable(data: any): string {
    const results = data?.results || [];
    if (results.length === 0) return 'No findings found.';

    const headers = ['#', 'Finding', 'Severity', 'Path', 'Method', 'Parameter', 'Resolution'];
    const rows: string[][] = [];

    for (let i = 0; i < results.length; i++) {
      const issue = results[i];
      rows.push([
        (i + 1).toString(),
        (issue.kind?.name || issue.nuclei_template?.name || 'Unknown').substring(0, 35),
        issue.severity || 'N/A',
        (issue.url_path || 'N/A').substring(0, 30),
        issue.http_method || 'N/A',
        (issue.parameter_name || 'N/A').substring(0, 20),
        (issue.resolution ?? 'N/A').toString(),
      ]);
    }

    let output = this.client.formatAsTable(headers, rows);
    if (data.count > results.length) {
      output += `\nShowing ${results.length} of ${data.count} findings. Use page/page_size for more.\n`;
    }
    return output;
  }

  private formatIssueKindStatsAsTable(data: any): string {
    const results = data?.results || data || [];
    if (!Array.isArray(results) || results.length === 0) return 'No issue kinds found.';

    const headers = ['Kind', 'Severity', 'Issues', 'Open', 'False Positive', 'Resolved'];
    const rows: string[][] = [];

    for (const kind of results) {
      rows.push([
        (kind.kind_name || kind.name || 'Unknown').substring(0, 35),
        kind.severity || 'N/A',
        (kind.issues || 0).toString(),
        (kind.open || 0).toString(),
        (kind.false_positive || 0).toString(),
        (kind.resolved || 0).toString(),
      ]);
    }
    return this.client.formatAsTable(headers, rows);
  }
}
