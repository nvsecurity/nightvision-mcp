import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatScanPathsText, formatScanPathsTable } from './scan-path-format.js';

const sample = {
  count: 78,
  results: [
    {
      id: '70c1bb47-f55a-4961-ae7a-c97785e8fd23',
      created_at: '2026-06-10T23:17:29.587354Z',
      scan: '3435aca3-137b-4ba4-a9ce-4f0f6119708e',
      path: 'https://javaspringvulny.nvtest.io:9000/',
      http_method: 'GET',
      extra_info: { response_codes: [200, 404] }
    }
  ]
};

test('text formatter reads the real fields and joins response codes', () => {
  const out = formatScanPathsText(sample);
  assert.match(out, /Path 1: https:\/\/javaspringvulny\.nvtest\.io:9000\//);   // path, not N/A
  assert.match(out, /Method: GET/);                                            // http_method
  assert.match(out, /Status Code: 200, 404/);                                  // joined response_codes
  assert.match(out, /Date: 2026-06-10T23:17:29\.587354Z/);                     // created_at
  assert.ok(!out.includes('Completed'), out);                                  // dropped column
  assert.ok(!out.includes('N/A'), out);
  assert.match(out, /Showing 1 of 78 total paths/);
});

test('table formatter shows the real columns, drops Completed, and keeps N/A only for genuinely missing data', () => {
  const out = formatScanPathsTable(sample);
  const header = out.split('\n')[0];
  assert.match(header, /Method/);
  assert.match(header, /URL/);
  assert.match(header, /Status/);
  assert.match(header, /Date/);
  assert.ok(!/Completed/.test(header), `Completed column should be gone: ${header}`);
  assert.match(out, /GET/);
  assert.match(out, /https:\/\/javaspringvulny\.nvtest\.io:9000\//);
  assert.match(out, /200, 404/);
  assert.match(out, /Showing 1 of 78 total paths/);
});

test('missing response codes render as N/A, not an empty cell', () => {
  const out = formatScanPathsText({
    count: 1,
    results: [{ id: 'x', path: '/a', http_method: 'POST', created_at: '2026-06-12T00:00:00Z', extra_info: {} }]
  });
  assert.match(out, /Status Code: N\/A/);
  assert.match(out, /Method: POST/);
});

test('invalid or missing results yield a friendly message', () => {
  assert.equal(formatScanPathsText({}), 'No paths found or invalid response format.');
  assert.equal(formatScanPathsTable({ results: null as any }), 'No paths found or invalid response format.');
});
