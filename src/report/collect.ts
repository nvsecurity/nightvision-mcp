/**
 * Gathers the NightVision data a report needs. All I/O sits behind
 * ReportDataSource so the selection logic (which baseline, which scan per
 * target, pagination caps) is unit-testable without the API.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nightvisionService } from '../services/index.js';
import { classifyScanStatus, scanHasFindings } from '../utils/scan-status.js';
import { sourceLinksByIssueId } from '../utils/sarif-findings.js';
import type { SourceLocation } from './model.js';

export interface ScanPage {
  results: any[];
  next?: string | null;
}

export interface ReportDataSource {
  getScan(scanId: string): Promise<any>;
  listIssues(scanId: string, page: number, pageSize: number): Promise<ScanPage & { count?: number }>;
  countScanPaths(scanId: string): Promise<number | null>;
  listScans(options: { target_ids?: string[]; project_ids?: string[]; page?: number; page_size?: number }): Promise<ScanPage>;
  getIssueKindStats(scanId: string): Promise<any[]>;
  getProjectByName(name: string): Promise<{ id: string; name?: string }>;
  exportSarif(scanId: string, outputPath: string, specFile: string): Promise<void>;
}

export const MAX_ISSUES = 2000;
const ISSUE_PAGE_SIZE = 100;
const SCAN_PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 5;
export const MAX_PROJECT_TARGETS = 50;

export const liveDataSource: ReportDataSource = {
  async getScan(scanId) {
    return JSON.parse(await nightvisionService.getScanStatus(scanId, 'json'));
  },
  async listIssues(scanId, page, pageSize) {
    const parsed = JSON.parse(await nightvisionService.listIssues(scanId, { page, page_size: pageSize }, 'json'));
    return { results: Array.isArray(parsed?.results) ? parsed.results : [], next: parsed?.next ?? null, count: parsed?.count };
  },
  async countScanPaths(scanId) {
    try {
      const parsed = JSON.parse(await nightvisionService.getScanPaths(scanId, { page_size: 1 }, 'json'));
      return typeof parsed?.count === 'number' ? parsed.count : null;
    } catch {
      return null;
    }
  },
  async listScans(options) {
    return nightvisionService.listScansByIds(options);
  },
  async getIssueKindStats(scanId) {
    const parsed = JSON.parse(await nightvisionService.getIssueKindStats(scanId, {}, 'json'));
    return Array.isArray(parsed?.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
  },
  async getProjectByName(name) {
    return nightvisionService.getProjectByName(name);
  },
  async exportSarif(scanId, outputPath, specFile) {
    await nightvisionService.exportSarif(scanId, outputPath, { swagger_file: specFile }, 'json');
  },
};

/** A scan is reportable when it succeeded, or ended otherwise but still produced findings. */
export function isReportable(scan: any): boolean {
  const state = classifyScanStatus(scan);
  if (state === 'succeeded') return true;
  return state === 'failed' && scanHasFindings(scan);
}

export async function fetchAllIssues(ds: ReportDataSource, scanId: string): Promise<{ issues: any[]; truncated: boolean }> {
  const issues: any[] = [];
  for (let page = 1; issues.length < MAX_ISSUES; page += 1) {
    const { results, next } = await ds.listIssues(scanId, page, ISSUE_PAGE_SIZE);
    issues.push(...results);
    if (!next || results.length === 0) return { issues, truncated: false };
  }
  return { issues: issues.slice(0, MAX_ISSUES), truncated: true };
}

function createdAt(scan: any): number {
  const t = Date.parse(scan?.started_at || scan?.created_at || '');
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The newest reportable scan of the same target that is strictly older than
 * `scan`. Candidates are compared by timestamp rather than trusting the API's
 * list order.
 */
export async function findBaselineScan(ds: ReportDataSource, scan: any): Promise<any | null> {
  const targetId = scan?.target_id || scan?.target?.id;
  if (!targetId) return null;
  const current = createdAt(scan);
  let best: any | null = null;
  for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
    const { results, next } = await ds.listScans({ target_ids: [String(targetId)], page, page_size: SCAN_PAGE_SIZE });
    for (const s of results) {
      if (s?.id === scan?.id || createdAt(s) >= current || !isReportable(s)) continue;
      if (!best || createdAt(s) > createdAt(best)) best = s;
    }
    if (!next || results.length === 0) break;
  }
  return best;
}

/** Why a caller-chosen baseline cannot be compared against `scan`, or null when it can. */
export function baselineProblem(scan: any, baseline: any): string | null {
  if (!baseline) return 'the baseline scan was not found';
  if (baseline?.id === scan?.id) return 'the baseline is the same scan';
  const targetOf = (s: any) => String(s?.target_id || s?.target?.id || '');
  if (targetOf(scan) && targetOf(baseline) && targetOf(scan) !== targetOf(baseline)) return 'the baseline scanned a different target';
  if (createdAt(baseline) >= createdAt(scan)) return 'the baseline is not older than the scan';
  if (!isReportable(baseline)) return `the baseline scan did not complete (status ${baseline?.status_value ?? 'unknown'})`;
  return null;
}

/** Latest reportable scan per target in a project, chosen by timestamp. */
export async function latestScansPerTarget(ds: ReportDataSource, projectId: string): Promise<{ scans: any[]; truncated: boolean }> {
  const byTarget = new Map<string, any>();
  let truncated = false;
  for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
    const { results, next } = await ds.listScans({ project_ids: [projectId], page, page_size: SCAN_PAGE_SIZE });
    for (const s of results) {
      const targetId = String(s?.target_id || s?.target?.id || '');
      if (!targetId || !isReportable(s)) continue;
      const seen = byTarget.get(targetId);
      if (!seen || createdAt(s) > createdAt(seen)) byTarget.set(targetId, s);
    }
    if (!next || results.length === 0) break;
    if (page === MAX_SCAN_PAGES) truncated = true;
  }
  const scans = [...byTarget.values()].sort((a, b) => createdAt(b) - createdAt(a));
  if (scans.length > MAX_PROJECT_TARGETS) return { scans: scans.slice(0, MAX_PROJECT_TARGETS), truncated: true };
  return { scans, truncated };
}

/**
 * Source file:line per issue id, from a SARIF export with the OpenAPI spec
 * attached. Returns an empty map (never throws) when linking is not possible;
 * the report then says "not linked" rather than failing.
 */
export async function collectSourceLinks(
  ds: ReportDataSource,
  scanId: string,
  specFile: string | null,
): Promise<{ links: Map<string, SourceLocation>; warning: string | null }> {
  if (!specFile) return { links: new Map(), warning: null };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nightvision-report-sarif-'));
  try {
    const out = path.join(dir, 'scan.sarif');
    await ds.exportSarif(scanId, out, specFile);
    return { links: sourceLinksByIssueId(JSON.parse(await readFile(out, 'utf8'))), warning: null };
  } catch (error: any) {
    return {
      links: new Map(),
      warning: `Source linking was skipped: the SARIF export with ${path.basename(specFile)} failed (${error?.message ?? error}).`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
