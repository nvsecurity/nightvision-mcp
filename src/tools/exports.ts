import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { nightvisionService } from '../services/index.js';
import { ExportCsvParamsSchema, ExportSarifParamsSchema } from '../types/index.js';
import { requireAuthenticatedUser } from '../utils/auth-guard.js';
import { classifyScanStatus, scanHasFindings } from '../utils/scan-status.js';
import { findDiscoveredSpec } from '../utils/discovered-spec.js';
import { extractSourceFindings, countSourceLinked } from '../utils/sarif-findings.js';
import { jsonText } from '../utils/tool-response.js';

function defaultSarifPath(scanId: string): string {
  return path.resolve(process.cwd(), '.nightvision', `nightvision-${scanId}.sarif`);
}

function defaultCsvPath(scanId: string): string {
  return path.resolve(process.cwd(), '.nightvision', `nightvision-${scanId}.csv`);
}

/**
 * Decide whether a scan is in an exportable state. A scan is worth exporting when
 * it succeeded, OR when it failed/aborted but still produced findings (NightVision
 * often yields valid findings on a terminal FAILED scan). A still-running scan, or
 * a failed scan with no findings, is not exportable and returns a clear blocker
 * instead of an empty/misleading SARIF or CSV.
 */
export function evaluateExportability(statusRaw: string): {
  exportable: boolean;
  state: string;
  hasFindings: boolean;
  parsed: unknown;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(statusRaw);
  } catch {
    // Non-JSON status; treat as unknown but do not block export outright.
    return { exportable: true, state: 'unknown', hasFindings: false, parsed: null };
  }
  const state = classifyScanStatus(parsed);
  const hasFindings = scanHasFindings(parsed);
  const exportable = state === 'succeeded' || state === 'unknown' || hasFindings;
  return { exportable, state, hasFindings, parsed };
}

function notExportableResponse(scanId: string, format: 'sarif' | 'csv', state: string, parsed: unknown) {
  return jsonText({
    ok: false,
    status: 'blocked',
    error: {
      code: state === 'running' ? 'SCAN_NOT_TERMINAL' : 'SCAN_NO_FINDINGS',
      message: state === 'running'
        ? `NightVision scan ${scanId} is still running. Wait for a terminal status before exporting ${format.toUpperCase()}.`
        : `NightVision scan ${scanId} reached terminal status "${state}" with no findings to export.`,
      details: { last_status: parsed }
    },
    blockers: [state === 'running' ? 'scan_not_terminal' : 'scan_no_findings']
  });
}

/**
 * Register result export tools with the MCP server.
 */
export function registerExportTools(server: McpServer): void {
  server.tool(
    'export-sarif',
    ExportSarifParamsSchema,
    async (args, _extra) => {
      try {
        const {
          scan_id: scanId,
          output,
          output_file: outputFile,
          swagger_file,
          randomize_issue_ids = false
        } = args;

        const auth = await requireAuthenticatedUser();
        if (!auth.ok) return auth.response;

        const statusRaw = await nightvisionService.getScanStatus(scanId, 'json');
        const exportability = evaluateExportability(statusRaw);
        if (!exportability.exportable) {
          return notExportableResponse(scanId, 'sarif', exportability.state, exportability.parsed);
        }

        const outputPath = path.resolve(process.cwd(), output || outputFile || defaultSarifPath(scanId));
        await mkdir(path.dirname(outputPath), { recursive: true });

        // Attach the discovered OpenAPI spec by default so findings trace back to
        // an endpoint and a source file:line (Code Traceback). Without this, a
        // caller on the common wait:false path would export SARIF with no spec and
        // silently lose the source linkage that is the whole point.
        const specFile = swagger_file || findDiscoveredSpec(process.cwd()) || undefined;

        const raw = await nightvisionService.exportSarif(
          scanId,
          outputPath,
          { swagger_file: specFile, randomize_issue_ids },
          'json'
        );

        // Read back the SARIF we just wrote and surface the source-linked findings
        // (rule + file:line) directly in the tool output, so the moat is visible in
        // the response instead of only inside a file a viewer has to open.
        let allFindings: ReturnType<typeof extractSourceFindings> = [];
        try {
          allFindings = extractSourceFindings(JSON.parse(await readFile(outputPath, 'utf8')));
        } catch {
          // A missing/unreadable SARIF is already reflected by the export result;
          // do not fail the tool over the convenience read-back.
        }
        // Counts are over ALL findings; the returned list is bounded for size, with
        // source-linked findings first, so the totals never lie about a truncated set.
        const DISPLAY_LIMIT = 50;
        const findings = allFindings.slice(0, DISPLAY_LIMIT);

        return jsonText({
          ok: true,
          status: 'success',
          data: {
            scan_id: scanId,
            sarif_path: outputPath,
            spec_attached: specFile ?? null,
            source_linked: !!specFile,
            total_findings: allFindings.length,
            source_linked_count: countSourceLinked(allFindings),
            findings,
            findings_truncated: allFindings.length > findings.length,
            raw_output: raw
          }
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'EXPORT_SARIF_FAILED',
            message: `Failed to export NightVision SARIF: ${error.message}`
          }
        });
      }
    }
  );

  server.tool(
    'export-csv',
    ExportCsvParamsSchema,
    async (args, _extra) => {
      try {
        const {
          scan_id: scanId,
          output,
          output_file: outputFile
        } = args;

        const auth = await requireAuthenticatedUser();
        if (!auth.ok) return auth.response;

        const statusRaw = await nightvisionService.getScanStatus(scanId, 'json');
        const exportability = evaluateExportability(statusRaw);
        if (!exportability.exportable) {
          return notExportableResponse(scanId, 'csv', exportability.state, exportability.parsed);
        }

        const outputPath = path.resolve(process.cwd(), output || outputFile || defaultCsvPath(scanId));
        await mkdir(path.dirname(outputPath), { recursive: true });

        const raw = await nightvisionService.exportCsv(scanId, outputPath, 'json');

        return jsonText({
          ok: true,
          status: 'success',
          data: {
            scan_id: scanId,
            csv_path: outputPath,
            raw_output: raw
          }
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'EXPORT_CSV_FAILED',
            message: `Failed to export NightVision CSV: ${error.message}`
          }
        });
      }
    }
  );
}
