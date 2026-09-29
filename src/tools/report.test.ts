import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReportDataSource } from '../report/collect.js';
import { fetchAllIssues, findBaselineScan, latestScansPerTarget, MAX_ISSUES } from '../report/collect.js';
import { buildReport, defaultReportPath, previewData, writeReport, type ReportRequest } from './report.js';

function request(overrides: Partial<ReportRequest> = {}): ReportRequest {
  return {
    mode: 'scan',
    preview: false,
    include_evidence: false,
    min_severity: 'low',
    max_occurrences_per_type: 10,
    format: 'pdf',
    ...overrides,
  };
}

const ok = (id: string, created: string, extra: Record<string, any> = {}) => ({
  id, target_id: 't-1', target_name: 'api', status: 1, status_value: 'SUCCEEDED', created_at: created, started_at: created, ...extra,
});

function fakeSource(overrides: Partial<ReportDataSource> = {}): ReportDataSource & { sarifCalls: string[] } {
  const sarifCalls: string[] = [];
  return {
    sarifCalls,
    getScan: async (id) => ok(id, '2026-09-29T10:00:00Z'),
    listIssues: async () => ({
      results: [{ id: 'i-1', kind_id: 114, kind: { id: 114, name: 'SQL Injection' }, severity: 'CRITICAL', resolution: 0, http_method: 'GET', url_path: '/a', extra_info: {} }],
      next: null,
    }),
    countScanPaths: async () => 5,
    listScans: async () => ({ results: [], next: null }),
    getIssueKindStats: async () => [],
    getProjectByName: async (name) => ({ id: 'p-1', name }),
    exportSarif: async (_scanId, out, spec) => {
      sarifCalls.push(spec);
      await writeFile(out, JSON.stringify({ runs: [{ results: [{
        partialFingerprints: { 'nightvisionIssueID/v1': 'i-1' },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/routes.ts' }, region: { startLine: 7 } } }],
      }] }] }));
    },
    ...overrides,
  };
}

test('a running scan is blocked with a clear code instead of an empty report', async () => {
  const ds = fakeSource({ getScan: async (id) => ({ id, status: 2, status_value: 'RUNNING' }) });
  await assert.rejects(buildReport(request({ scan_id: 's' }), ds, '/nowhere', new Date()), (err: any) => err.code === 'SCAN_NOT_TERMINAL');
});

test('scan and compare modes require scan_id; project mode requires a project reference', async () => {
  await assert.rejects(buildReport(request(), fakeSource(), '/nowhere', new Date()), (err: any) => err.code === 'SCAN_ID_REQUIRED');
  await assert.rejects(buildReport(request({ mode: 'project' }), fakeSource(), '/nowhere', new Date()), (err: any) => err.code === 'PROJECT_REQUIRED');
});

test('source links come from a SARIF export with the discovered spec', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nv-report-test-'));
  try {
    await writeFile(path.join(dir, 'placeholder'), '');
    const nv = path.join(dir, '.nightvision');
    await (await import('node:fs/promises')).mkdir(nv);
    await writeFile(path.join(nv, 'openapi.yml'), 'openapi: 3.0.0');
    const ds = fakeSource();
    const { report } = await buildReport(request({ scan_id: 's' }), ds, dir, new Date());
    assert.deepEqual(ds.sarifCalls, [path.join(nv, 'openapi.yml')]);
    assert.equal(report.kind, 'scan');
    if (report.kind === 'scan') {
      assert.deepEqual(report.findings[0].occurrences[0].source, { file: 'src/routes.ts', line: 7 });
      assert.equal(report.scan.spec_file, 'openapi.yml');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without a spec no SARIF export is attempted and nothing is source-linked', async () => {
  const ds = fakeSource();
  const { report } = await buildReport(request({ scan_id: 's' }), ds, '/definitely/not/a/dir', new Date());
  assert.equal(ds.sarifCalls.length, 0);
  if (report.kind === 'scan') assert.equal(report.scan.source_linked, false);
});

test('compare mode warns and omits the section when there is no earlier scan', async () => {
  const { report, warnings } = await buildReport(request({ mode: 'compare', scan_id: 's' }), fakeSource(), '/nowhere', new Date());
  assert.equal(report.kind === 'scan' && report.comparison, null);
  assert.match(warnings.join(' '), /No earlier completed scan/);
});

test('findBaselineScan picks the newest older reportable scan of the same target', async () => {
  const ds = fakeSource({
    listScans: async () => ({
      results: [
        ok('newer', '2026-09-30T00:00:00Z'),
        ok('current', '2026-09-29T10:00:00Z'),
        { ...ok('running', '2026-09-29T09:00:00Z'), status: 2, status_value: 'RUNNING' },
        { ...ok('failed-empty', '2026-09-29T08:00:00Z'), status: 4, status_value: 'FAILED', issues_count: 0 },
        ok('baseline', '2026-09-28T00:00:00Z'),
      ],
      next: null,
    }),
  });
  const baseline = await findBaselineScan(ds, ok('current', '2026-09-29T10:00:00Z'));
  assert.equal(baseline?.id, 'baseline');
});

test('latestScansPerTarget keeps the first reportable scan per target', async () => {
  const ds = fakeSource({
    listScans: async () => ({
      results: [
        { ...ok('a-run', '2026-09-30T00:00:00Z', { target_id: 'a' }), status: 2, status_value: 'RUNNING' },
        ok('a-new', '2026-09-29T00:00:00Z', { target_id: 'a' }),
        ok('a-old', '2026-09-28T00:00:00Z', { target_id: 'a' }),
        ok('b-new', '2026-09-27T00:00:00Z', { target_id: 'b' }),
      ],
      next: null,
    }),
  });
  const { scans, truncated } = await latestScansPerTarget(ds, 'p-1');
  assert.deepEqual(scans.map((s) => s.id), ['a-new', 'b-new']);
  assert.equal(truncated, false);
});

test('fetchAllIssues follows pages and stops at the cap', async () => {
  let calls = 0;
  const ds = fakeSource({
    listIssues: async (_s, _page, size) => {
      calls += 1;
      return { results: Array.from({ length: size }, (_, i) => ({ id: `${calls}-${i}` })), next: 'more' };
    },
  });
  const { issues, truncated } = await fetchAllIssues(ds, 's');
  assert.equal(issues.length, MAX_ISSUES);
  assert.equal(truncated, true);
});

test('project mode resolves a project by name and builds a roll-up', async () => {
  const ds = fakeSource({
    listScans: async () => ({ results: [ok('s-a', '2026-09-29T00:00:00Z', { target_id: 'a', target_name: 'api', project_name: 'Payments' })], next: null }),
    getIssueKindStats: async () => [{ kind_id: 1, kind_name: 'SQL Injection', severity: 'CRITICAL', open: 3, vulnerable_paths_count: 2 }],
  });
  const { report } = await buildReport(request({ mode: 'project', project: 'Payments' }), ds, '/nowhere', new Date());
  assert.equal(report.kind, 'project');
  if (report.kind === 'project') {
    assert.equal(report.project_name, 'Payments');
    assert.equal(report.total_open, 3);
  }
  assert.equal(previewData(report).mode, 'project');
});

test('writeReport falls back to HTML when no browser is available', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nv-report-test-'));
  try {
    const { report } = await buildReport(request({ scan_id: 's' }), fakeSource(), '/nowhere', new Date('2026-09-29T00:00:00Z'));
    const target = defaultReportPath(dir, report, 'pdf');
    assert.equal(path.basename(target), 'nightvision-report-s.pdf');
    const written = await writeReport(report, 'pdf', target, () => null);
    assert.equal(written.format, 'html');
    assert.match(written.fallbackReason ?? '', /No Chrome/);
    assert.equal(path.extname(written.path), '.html');
    assert.match(await readFile(written.path, 'utf8'), /<!DOCTYPE html>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeReport prints through the browser when one is found', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nv-report-test-'));
  try {
    const { report } = await buildReport(request({ scan_id: 's' }), fakeSource(), '/nowhere', new Date());
    let printedFrom = '';
    const written = await writeReport(report, 'pdf', path.join(dir, 'out', 'r.pdf'), () => '/fake/chrome', async (html, pdf) => {
      printedFrom = html;
      await writeFile(pdf, '%PDF-1.7\n');
    });
    assert.equal(written.format, 'pdf');
    assert.equal(written.fallbackReason, null);
    assert.ok((await stat(written.path)).size > 0);
    // The intermediate HTML lives in a temp dir that is cleaned up.
    await assert.rejects(stat(printedFrom));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a caller-chosen baseline must be an older completed scan of the same target', async () => {
  const scans: Record<string, any> = {
    cur: ok('cur', '2026-09-29T10:00:00Z'),
    newer: ok('newer', '2026-09-30T10:00:00Z'),
    other: ok('other', '2026-09-28T10:00:00Z', { target_id: 't-2' }),
    good: ok('good', '2026-09-28T10:00:00Z'),
  };
  const ds = fakeSource({ getScan: async (id) => scans[id] });
  for (const bad of ['cur', 'newer', 'other']) {
    await assert.rejects(
      buildReport(request({ mode: 'compare', scan_id: 'cur', baseline_scan_id: bad }), ds, '/nowhere', new Date()),
      (err: any) => err.code === 'BASELINE_INVALID',
    );
  }
  const { report } = await buildReport(request({ mode: 'compare', scan_id: 'cur', baseline_scan_id: 'good' }), ds, '/nowhere', new Date());
  assert.equal(report.kind === 'scan' && report.comparison?.baseline_scan_id, 'good');
});

test('scan selection does not depend on the API returning newest first', async () => {
  const ascending = [
    ok('old', '2026-09-26T00:00:00Z'),
    ok('mid', '2026-09-27T00:00:00Z'),
    ok('cur', '2026-09-29T00:00:00Z'),
  ];
  const ds = fakeSource({ listScans: async () => ({ results: ascending, next: null }) });
  assert.equal((await findBaselineScan(ds, ascending[2]))?.id, 'mid');
  const { scans } = await latestScansPerTarget(ds, 'p-1');
  assert.deepEqual(scans.map((s) => s.id), ['cur']);
});
