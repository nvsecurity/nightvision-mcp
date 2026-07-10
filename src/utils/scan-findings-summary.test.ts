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
  assert.deepEqual(summary.severity_counts, { low: 1, critical: 1, high: 1 });
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
