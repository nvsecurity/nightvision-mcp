import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  baselineProblem,
  collectSourceLinks,
  fetchAllIssues,
  findBaselineScan,
  isReportable,
  latestScansPerTarget,
  liveDataSource,
  MAX_ISSUES,
  MAX_PROJECT_TARGETS,
  type ReportDataSource,
} from '../report/collect.js';
import {
  buildProjectReport,
  buildScanReport,
  type MinSeverity,
  type Report,
  type ReportOptions,
} from '../report/model.js';
import { findChromeBinary, printHtmlToPdf } from '../report/pdf.js';
import { renderReportHtml } from '../report/render-html.js';
import { ExportReportParamsSchema } from '../types/index.js';
import { requireAuthenticatedUser } from '../utils/auth-guard.js';
import { findDiscoveredSpec } from '../utils/discovered-spec.js';
import { jsonText } from '../utils/tool-response.js';
import { UNTRUSTED_NOTICE, neutralizeFenceMarkers } from '../utils/untrusted.js';
import { registerNightVisionTool } from './metadata.js';

export type ReportMode = 'scan' | 'compare' | 'project';

export interface ReportRequest {
  mode: ReportMode;
  scan_id?: string;
  baseline_scan_id?: string;
  project?: string;
  project_id?: string;
  preview: boolean;
  executive_summary?: string;
  remediation_notes?: Array<{ issue_type: string; note: string }>;
  include_evidence: boolean;
  min_severity: MinSeverity;
  max_occurrences_per_type: number;
  title?: string;
  format: 'pdf' | 'html';
  project_path?: string;
  swagger_file?: string;
  output?: string;
}

class ReportBlocked extends Error {
  constructor(readonly code: string, message: string, readonly blocker: string) {
    super(message);
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}

export function defaultReportPath(baseDir: string, report: Report, format: 'pdf' | 'html'): string {
  const stem = report.kind === 'project'
    ? `nightvision-report-project-${slug(report.project_name)}`
    : `nightvision-report-${report.scan.scan_id}${report.comparison ? '-compare' : ''}`;
  return path.resolve(baseDir, '.nightvision', `${stem}.${format}`);
}

function withExtension(filePath: string, ext: '.pdf' | '.html'): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${ext}`);
}

/** Build the report model from live (or injected) data. Throws ReportBlocked for user-fixable states. */
export async function buildReport(
  req: ReportRequest,
  ds: ReportDataSource,
  baseDir: string,
  now: Date,
): Promise<{ report: Report; warnings: string[] }> {
  const warnings: string[] = [];
  const options: ReportOptions = {
    minSeverity: req.min_severity,
    includeEvidence: req.include_evidence,
    maxOccurrencesPerType: req.max_occurrences_per_type,
    executiveSummary: req.executive_summary ?? null,
    remediationNotes: req.remediation_notes ?? [],
    title: req.title ?? null,
    generatedAt: now,
  };

  if (req.mode === 'project') {
    let projectId = req.project_id;
    let projectName = req.project;
    if (!projectId && req.project) {
      const project = await ds.getProjectByName(req.project);
      projectId = project.id;
      projectName = project.name ?? req.project;
    }
    if (!projectId && req.scan_id) {
      const scan = await ds.getScan(req.scan_id);
      projectId = scan?.project?.id || scan?.target?.project;
      projectName = scan?.project_name || scan?.project?.name;
    }
    if (!projectId) {
      throw new ReportBlocked('PROJECT_REQUIRED', 'project mode needs project, project_id, or a scan_id from the project.', 'nightvision_project_required');
    }
    const { scans, truncated } = await latestScansPerTarget(ds, projectId);
    if (truncated) warnings.push(`The project has more targets or scan history than one report covers; the ${Math.min(scans.length, MAX_PROJECT_TARGETS)} most recently scanned targets are included.`);
    const kindStats = new Map<string, any[]>();
    for (const scan of scans) kindStats.set(String(scan.id), await ds.getIssueKindStats(String(scan.id)));
    const name = projectName || scans[0]?.project_name || projectId;
    return { report: buildProjectReport({ projectName: String(name), scans, kindStats, options }), warnings };
  }

  if (!req.scan_id) {
    throw new ReportBlocked('SCAN_ID_REQUIRED', `${req.mode} mode needs scan_id.`, 'scan_id_required');
  }
  const scan = await ds.getScan(req.scan_id);
  if (!isReportable(scan)) {
    const running = String(scan?.status_value ?? '').toUpperCase() === 'RUNNING' || scan?.status === 2 || scan?.status === 6;
    throw new ReportBlocked(
      running ? 'SCAN_NOT_TERMINAL' : 'SCAN_NO_FINDINGS',
      running
        ? `NightVision scan ${req.scan_id} is still running. Wait for it to finish before building a report.`
        : `NightVision scan ${req.scan_id} ended with status ${scan?.status_value ?? 'unknown'} and no findings to report.`,
      running ? 'scan_not_terminal' : 'scan_no_findings',
    );
  }

  const { issues, truncated } = await fetchAllIssues(ds, req.scan_id);
  if (truncated) warnings.push(`This scan has more than ${MAX_ISSUES} findings; the report covers the first ${MAX_ISSUES}.`);

  const discovered = req.swagger_file ? null : findDiscoveredSpec(baseDir);
  const specFile = req.swagger_file || discovered?.path || null;
  const { links, warning } = await collectSourceLinks(ds, req.scan_id, specFile);
  if (warning) warnings.push(warning);
  if (discovered?.ambiguous) warnings.push(`Multiple OpenAPI specs were found under .nightvision; ${path.basename(discovered.path!)} was used for source linking. Pass swagger_file to choose.`);

  let baseline: { scan: any; issues: any[] } | null = null;
  if (req.mode === 'compare') {
    const baselineScan = req.baseline_scan_id ? await ds.getScan(req.baseline_scan_id) : await findBaselineScan(ds, scan);
    if (req.baseline_scan_id) {
      const problem = baselineProblem(scan, baselineScan);
      if (problem) {
        throw new ReportBlocked('BASELINE_INVALID', `Cannot compare against ${req.baseline_scan_id}: ${problem}. Omit baseline_scan_id to use the previous completed scan of the same target.`, 'baseline_invalid');
      }
    }
    if (!baselineScan) {
      warnings.push('No earlier completed scan of this target was found, so the report has no comparison section.');
    } else {
      const fetched = await fetchAllIssues(ds, String(baselineScan.id));
      if (fetched.truncated) warnings.push(`The baseline scan has more than ${MAX_ISSUES} findings; the comparison uses the first ${MAX_ISSUES}.`);
      baseline = { scan: baselineScan, issues: fetched.issues };
    }
  }

  const pathsTested = await ds.countScanPaths(req.scan_id);
  const report = buildScanReport({
    scan,
    issues,
    pathsTested,
    specFile: specFile ? path.basename(specFile) : null,
    sourceLinks: links,
    baseline,
    options,
  });
  return { report, warnings };
}

/**
 * What an agent needs to write the summary and fix notes: numbers, issue
 * types, a few endpoints with source locations. Kept compact on purpose.
 */
export function previewData(report: Report) {
  if (report.kind === 'project') {
    return {
      mode: 'project',
      title: report.title,
      project: report.project_name,
      counts: report.counts,
      total_open: report.total_open,
      targets: report.targets.map((t) => ({ target: t.target_name, scan_id: t.scan_id, scanned_at: t.scanned_at, counts: t.counts })),
      top_issue_types: report.top_types,
    };
  }
  return {
    mode: report.comparison ? 'compare' : 'scan',
    title: report.title,
    scan: report.scan,
    counts: report.counts,
    total_open: report.total_open,
    distinct_types: report.distinct_types,
    excluded: report.exclusions,
    comparison: report.comparison,
    issue_types: report.findings.map((f) => ({
      issue_type: f.name,
      kind_id: f.kind_id,
      severity: f.severity,
      categories: f.taxonomy.map((t) => `${t.standard} ${t.code}`),
      affected_endpoints: f.affected_paths,
      occurrences: f.occurrence_total,
      source_linked: f.source_linked,
      explanation: f.explanation ? f.explanation.slice(0, 400) : null,
      examples: f.occurrences.slice(0, 3).map((o) => ({
        method: o.method,
        path: o.path,
        parameter: o.parameter,
        source: o.source ? `${o.source.file}${o.source.line !== null ? `:${o.source.line}` : ''}` : null,
      })),
    })),
  };
}

function headline(report: Report) {
  if (report.kind === 'project') {
    return { mode: 'project', project: report.project_name, targets: report.targets.length, counts: report.counts, total_open: report.total_open };
  }
  return {
    mode: report.comparison ? 'compare' : 'scan',
    scan_id: report.scan.scan_id,
    target: report.scan.target_name,
    counts: report.counts,
    total_open: report.total_open,
    distinct_types: report.distinct_types,
    source_linked: report.scan.source_linked,
    comparison: report.comparison
      ? { new: report.comparison.new_count, fixed: report.comparison.fixed_count, still_open: report.comparison.still_open_count }
      : null,
    top_issue_types: report.top_findings.map((f) => ({ issue_type: f.name, severity: f.severity, endpoints: f.affected_paths })),
  };
}

/** Write HTML, and PDF when requested and a browser is available. */
export async function writeReport(
  report: Report,
  requestedFormat: 'pdf' | 'html',
  outputPath: string,
  findChrome: () => string | null = findChromeBinary,
  print: typeof printHtmlToPdf = printHtmlToPdf,
): Promise<{ path: string; format: 'pdf' | 'html'; fallbackReason: string | null }> {
  const html = renderReportHtml(report);
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (requestedFormat === 'html') {
    const htmlPath = withExtension(outputPath, '.html');
    await writeFile(htmlPath, html, 'utf8');
    return { path: htmlPath, format: 'html', fallbackReason: null };
  }

  const pdfPath = withExtension(outputPath, '.pdf');
  const chrome = findChrome();
  let reason: string;
  if (chrome) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nightvision-report-'));
    try {
      const tempHtml = path.join(dir, 'report.html');
      await writeFile(tempHtml, html, 'utf8');
      await print(tempHtml, pdfPath, chrome);
      return { path: pdfPath, format: 'pdf', fallbackReason: null };
    } catch (error: any) {
      reason = `PDF printing failed (${error?.message ?? error}).`;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  } else {
    reason = 'No Chrome, Chromium, Edge, or Brave browser was found (set NIGHTVISION_CHROME_PATH to point at one).';
  }
  const htmlPath = withExtension(outputPath, '.html');
  await writeFile(htmlPath, html, 'utf8');
  return { path: htmlPath, format: 'html', fallbackReason: reason };
}

export function registerReportTools(server: McpServer): void {
  registerNightVisionTool(server,
    'export-report',
    ExportReportParamsSchema,
    async (args, _extra) => {
      try {
        const auth = await requireAuthenticatedUser();
        if (!auth.ok) return auth.response;

        const req = args as ReportRequest;
        const baseDir = req.project_path ? path.resolve(req.project_path) : process.cwd();
        const { report, warnings } = await buildReport(req, liveDataSource, baseDir, new Date());

        if (req.preview) {
          return jsonText({
            ok: true,
            status: 'success',
            data: {
              // Issue names, paths, parameters and explanations come from the
              // scanned target and are attacker-influenced.
              security_notice: UNTRUSTED_NOTICE,
              preview: JSON.parse(neutralizeFenceMarkers(JSON.stringify(previewData(report)))),
              next_step: 'Write executive_summary (3-5 sentences, only what this data supports) and optional remediation_notes per issue_type, then call export-report again with the same arguments and preview:false.',
            },
            warnings,
          });
        }

        const target = req.output
          ? path.resolve(baseDir, req.output)
          : defaultReportPath(baseDir, report, req.format);
        const written = await writeReport(report, req.format, target);
        if (written.fallbackReason) {
          warnings.push(`${written.fallbackReason} The report was saved as HTML; open it in a browser and print to PDF.`);
        }
        if (!report.executive_summary) {
          warnings.push('No executive_summary was provided, so the report has no summary section. Run with preview:true first to write one.');
        }

        return jsonText({
          ok: true,
          status: written.fallbackReason ? 'partial' : 'success',
          data: {
            security_notice: UNTRUSTED_NOTICE,
            report_path: written.path,
            format: written.format,
            evidence_included: req.include_evidence,
            summary: JSON.parse(neutralizeFenceMarkers(JSON.stringify(headline(report)))),
          },
          warnings,
        });
      } catch (error: any) {
        if (error instanceof ReportBlocked) {
          return jsonText({
            ok: false,
            status: 'blocked',
            error: { code: error.code, message: error.message },
            blockers: [error.blocker],
          });
        }
        return jsonText({
          ok: false,
          status: 'error',
          error: { code: 'EXPORT_REPORT_FAILED', message: `Failed to build NightVision report: ${error?.message ?? error}` },
        });
      }
    }
  );
}
