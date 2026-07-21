import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeScanChecks } from './scan-findings-summary.js';

test('summarizeScanChecks sorts by severity and counts returned findings', () => {
  const summary = summarizeScanChecks({
    count: 3,
    results: [
      { id: 'low-1', name: 'Low issue', severity: 'low', status: 0 },
      { id: 'critical-1', kind: 'SQL Injection', severity: 'critical', status: 0 },
      { id: 'high-1', name: 'High issue', severity: 'high', status: 0 }
    ]
  });

  assert.equal(summary.total_count, 3);
  assert.equal(summary.returned_count, 3);
  assert.deepEqual(summary.page_severity_counts, { low: 1, critical: 1, high: 1 });
  assert.deepEqual(summary.findings.map((finding) => finding.id), ['critical-1', 'high-1', 'low-1']);
});

test('summarizeScanChecks includes endpoint and evidence only when returned by the API', () => {
  const summary = summarizeScanChecks({
    results: [{
      id: 'finding-1',
      name: 'SQL Injection',
      severity: 'high',
      status: 0,
      method: 'POST',
      path: '/search',
      parameter: 'query',
      evidence: 'database error'
    }]
  });

  assert.deepEqual(summary.findings[0], {
    id: 'finding-1',
    title: 'SQL Injection',
    kind: null,
    severity: 'high',
    status: 0,
    endpoint: { method: 'POST', path: '/search', url: null },
    parameter: 'query',
    evidence: 'database error',
    ai_explanation: null
  });
});

test('summarizeScanChecks marks truncated when the server total exceeds the returned page', () => {
  // One page of 2 is returned while the server reports 500 total. The summary
  // keeps the whole page, but must not claim it has every finding.
  const summary = summarizeScanChecks({
    count: 500,
    results: [
      { id: 'one', severity: 'critical' },
      { id: 'two', severity: 'high' }
    ]
  });

  assert.equal(summary.total_count, 500);
  assert.equal(summary.returned_count, 2);
  assert.equal(summary.summarized_count, 2);
  assert.equal(summary.truncated, true);
  // page_severity_counts tallies only this page (2), never the 500 server total,
  // so its name must not be read as a full breakdown.
  assert.deepEqual(summary.page_severity_counts, { critical: 1, high: 1 });
});

test('summarizeScanChecks respects the summary limit', () => {
  const summary = summarizeScanChecks({
    count: 2,
    results: [
      { id: 'one', severity: 'high' },
      { id: 'two', severity: 'high' }
    ]
  }, 1);

  assert.equal(summary.summarized_count, 1);
  assert.equal(summary.truncated, true);
});
