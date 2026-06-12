import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatScanChecksText, formatScanChecksTable } from './scan-check-format.js';

const sample = {
  count: 6968,
  results: [
    {
      id: 'a9c270ac-45c7-4a59-918d-a9329eb52362',
      name: 'Cookie without SameSite Attribute',
      kind: 'SAMESITE_COOKIE',
      severity: 'LOW',
      status: 0,
      created_at: '2026-06-10T23:10:36Z'
    }
  ]
};

test('text formatter uses the real fields and renders status 0', () => {
  const out = formatScanChecksText(sample);
  assert.match(out, /Cookie without SameSite Attribute/);   // title from name, not "Unknown"
  assert.match(out, /Status: 0/);                            // 0 (open) is shown, not N/A
  assert.match(out, /Created: 2026-06-10T23:10:36Z/);        // created_at, not N/A
  assert.match(out, /Severity: LOW/);
  assert.ok(!out.includes('Unknown'), out);
  assert.match(out, /Use 'page' and 'page_size'/);           // corrected pagination hint
  assert.ok(!out.includes("'limit'") && !out.includes("'offset'"), out);
});

test('table formatter shows the right columns, drops Path, and renders status 0', () => {
  const out = formatScanChecksTable(sample);
  const header = out.split('\n')[0];
  assert.match(header, /Name/);
  assert.match(header, /Status/);
  assert.ok(!out.includes('Path'), `Path column should be gone: ${header}`);
  assert.match(out, /Cookie without SameSite Attribute/);
  assert.match(out, /LOW/);
  assert.match(out, /\|\s+0\s+\|/);                          // status 0 in its own cell
  assert.match(out, /Use 'page' and 'page_size'/);
  assert.ok(!out.includes('Unknown'), out);
});

test('title falls back to the kind when the name is empty', () => {
  const out = formatScanChecksText({
    count: 1,
    results: [{ id: 'x', name: '', kind: 'SAMESITE_COOKIE', severity: 'LOW', status: 0, created_at: '2026-06-10T00:00:00Z' }]
  });
  assert.match(out, /Vulnerability 1: SAMESITE_COOKIE/);    // empty name -> kind, not N/A
  assert.ok(!/Vulnerability 1: N\/A/.test(out), out);
});

test('invalid or missing results yield a friendly message', () => {
  assert.equal(formatScanChecksText({}), 'No vulnerabilities found or invalid response format.');
  assert.equal(formatScanChecksTable({ results: null as any }), 'No vulnerabilities found or invalid response format.');
});
