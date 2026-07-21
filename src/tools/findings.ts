import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nightvisionService } from '../services/index.js';
import {
  ListIssuesParamsSchema,
  GetIssueDetailsParamsSchema,
  GetIssueKindStatsParamsSchema,
  GetVulnerablePathsParamsSchema,
  GetIssueOccurrencesParamsSchema,
} from '../types/index.js';
import { requireAuthenticatedUser } from '../utils/auth-guard.js';
import { wrapUntrusted } from '../utils/untrusted.js';

/**
 * Register finding/issue detail tools with the MCP server
 * @param server The MCP server instance
 */
export function registerFindingTools(server: McpServer): void {
  /**
   * List Issues Tool
   *
   * Lists security findings for a scan, including HTTP request/response pairs,
   * evidence, payloads, and AI explanations.
   */
  server.tool(
    "list-issues",
    ListIssuesParamsSchema,
    async (args, _extra) => {
      try {
        const { scan_id, page, page_size, severity, resolution, kind, filter, format = 'json' } = args;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const result = await nightvisionService.listIssues(
          scan_id,
          { page, page_size, severity, resolution, kind, filter },
          format
        );

        return { content: [{ type: "text" as const, text: wrapUntrusted(result) }] };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to list issues: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Issue Details Tool
   *
   * Gets full details for a single finding, including all HTTP request/response
   * pairs (headers, body, cookies), evidence, payload, and AI explanation.
   */
  server.tool(
    "get-issue-details",
    GetIssueDetailsParamsSchema,
    async (args, _extra) => {
      try {
        const { issue_id, format = 'json' } = args;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const result = await nightvisionService.getIssueDetails(issue_id, format);

        return { content: [{ type: "text" as const, text: wrapUntrusted(result) }] };
      } catch (error: any) {
        if (error.message.includes('404') || error.message.includes('not found')) {
          return {
            content: [{
              type: "text" as const,
              text: `Issue not found: '${args.issue_id}'. Please check the ID is correct.`
            }],
            isError: true
          };
        }
        return {
          content: [{ type: "text" as const, text: `Failed to get issue details: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Issue Kind Stats Tool
   *
   * Summarizes findings grouped by vulnerability type (kind) for a scan, showing
   * counts of open, false positive, and resolved issues per kind.
   */
  server.tool(
    "get-issue-kind-stats",
    GetIssueKindStatsParamsSchema,
    async (args, _extra) => {
      try {
        const { scan_id, filter, format = 'json' } = args;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const result = await nightvisionService.getIssueKindStats(scan_id, { filter }, format);

        return { content: [{ type: "text" as const, text: wrapUntrusted(result) }] };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to get issue kind stats: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Vulnerable Paths Tool
   *
   * Gets all vulnerable URL paths for a scan, grouped by vulnerability kind.
   */
  server.tool(
    "get-vulnerable-paths",
    GetVulnerablePathsParamsSchema,
    async (args, _extra) => {
      try {
        const { scan_id, kind, nuclei_template, resolution, filter } = args;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        const result = await nightvisionService.getVulnerablePaths(
          scan_id,
          { kind, nuclei_template, resolution, filter }
        );

        return { content: [{ type: "text" as const, text: wrapUntrusted(result) }] };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to get vulnerable paths: ${error.message}` }],
          isError: true
        };
      }
    }
  );

  /**
   * Get Issue Occurrences Tool
   *
   * Gets individual issue occurrences for a specific URL path and vulnerability
   * kind, showing each payload, parameter, and HTTP status for the path.
   */
  server.tool(
    "get-issue-occurrences",
    GetIssueOccurrencesParamsSchema,
    async (args, _extra) => {
      try {
        const { scan_id, url_path, http_method, kind_id, nuclei_template_id, parameter_name, resolution } = args;

        const authGuard = await requireAuthenticatedUser();
        if (!authGuard.ok) return authGuard.response;

        if (!kind_id && !nuclei_template_id) {
          return {
            content: [{
              type: "text" as const,
              text: "Either kind_id or nuclei_template_id is required."
            }],
            isError: true
          };
        }

        const result = await nightvisionService.getIssueOccurrences(
          { scan_id, url_path, http_method, kind_id, nuclei_template_id, parameter_name, resolution }
        );

        return { content: [{ type: "text" as const, text: wrapUntrusted(result) }] };
      } catch (error: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to get issue occurrences: ${error.message}` }],
          isError: true
        };
      }
    }
  );
}
