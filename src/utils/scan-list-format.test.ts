import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatScansTable } from './scan-list-format.js';

const sample = {
  count: 2,
  results: [
    {
      id: '3435aca3-137b-4ba4-a9ce-4f0f6119708e',
      target: { name: 'javaspringvulny' },
      project: { name: 'rich' },
      status: 1,
      status_value: 'SUCCEEDED',
      created_at: '2026-06-10T23:08:06.600764Z'
    },
    {
      id: '1e6bc1e0-0889-42d0-9b78-84e878070b97',
      target: { name: 'shrewm' },
      project: { name: 'shrewm' },
      status: 4,
      status_value: 'FAILED',
      created_at: '2026-05-15T14:34:02.859718Z'
    }
  ]
};

test('table renders created_at and the human-readable status, not a bare code', () => {
  const out = formatScansTable(sample);
  // Created column shows the real timestamp, not N/A.
  assert.match(out, /2026-06-10T23:08:06\.600764Z/);
  assert.match(out, /2026-05-15T14:34:02\.859718Z/);
  // Status column shows the string value, not just the numeric code.
  assert.match(out, /SUCCEEDED/);
  assert.match(out, /FAILED/);
  // The created/status fields are populated, so no N/A leaks into the rows.
  const dataRows = out.split('\n').slice(2);
  assert.ok(dataRows.every((r) => !r.includes('N/A')), out);
});

test('status falls back to the numeric code when status_value is absent', () => {
  const out = formatScansTable({
    results: [
      {
        id: 'x',
        target: { name: 't' },
        project: { name: 'p' },
        status: 2,
        created_at: '2026-06-12T00:00:00Z'
      }
    ]
  });
  const dataRow = out.split('\n')[2];
  assert.match(dataRow, /\b2\b/);              // numeric status shown as fallback
  assert.match(dataRow, /2026-06-12T00:00:00Z/);
});

test('missing fields render as N/A and an empty result set yields just the header', () => {
  const out = formatScansTable({ results: [{}] });
  const dataRow = out.split('\n')[2];
  assert.equal(dataRow, ['N/A', 'N/A', 'N/A', 'N/A', 'N/A'].join('\t'));

  const empty = formatScansTable({ results: [] });
  assert.equal(empty.split('\n').length, 2);   // header + separator only
  assert.equal(formatScansTable({}).split('\n').length, 2);
});
