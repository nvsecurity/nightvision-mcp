import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractScanId } from './scan-id.js';

const SCAN_ID = '123e4567-e89b-12d3-a456-426614174000';

test('extracts scan id from a top-level id field', () => {
  assert.equal(extractScanId(JSON.stringify({ id: SCAN_ID })), SCAN_ID);
});

test('extracts scan id from common nested fields', () => {
  assert.equal(extractScanId(JSON.stringify({ result: { scan_id: SCAN_ID } })), SCAN_ID);
  assert.equal(extractScanId(JSON.stringify({ scan: { scanId: SCAN_ID } })), SCAN_ID);
});

test('extracts a UUID from non-JSON CLI output as a conservative fallback', () => {
  assert.equal(extractScanId(`Started scan ${SCAN_ID}`), SCAN_ID);
});

test('returns null when no scan id is present', () => {
  assert.equal(extractScanId(JSON.stringify({ ok: true })), null);
  assert.equal(extractScanId('scan started'), null);
});

test('does not mistake another UUID in structured pending output for the scan id', () => {
  const PROJECT_ID = '99999999-8888-4777-a666-555544443333';
  // The managed-scan pending payload sets id/scan_id to null on purpose, but the
  // rest of the JSON still carries other UUIDs (project_id, CLI progress output
  // in the stdout tail). A bare-UUID scan over the blob would wrongly return one
  // of those; on successful JSON parse we must trust only the labeled id fields.
  const pending = JSON.stringify({
    id: null,
    extracted_id: null,
    scan_id_pending: true,
    project_id: PROJECT_ID,
    raw: { stdout_tail: `resolved target ${SCAN_ID} in project ${PROJECT_ID}` }
  });
  assert.equal(extractScanId(pending), null);
});

