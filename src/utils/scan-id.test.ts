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
  // Bare UUIDs embedded in prose, with no "Scan ID:" label and no bare-uuid
  // stdout line, must NOT be returned (would grab the project/target id).
  const pending = JSON.stringify({
    id: null,
    extracted_id: null,
    scan_id_pending: true,
    project_id: PROJECT_ID,
    raw: { stdout_tail: `resolved target ${SCAN_ID} in project ${PROJECT_ID}` }
  });
  assert.equal(extractScanId(pending), null);
});

test('recovers the LABELED scan id from a managed-scan pending payload', () => {
  // Real shape: the wrapper reports id/extracted_id null, but the CLI printed
  // "Scan ID: <uuid>" (and the bare id to stdout). Recover it instead of blocking.
  const TARGET_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const CRED_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  const PROJECT_ID = '99999999-8888-4777-a666-555544443333';
  const pending = JSON.stringify({
    id: null,
    extracted_id: null,
    scan_id_pending: true,
    project_id: PROJECT_ID,
    raw: {
      stdout_tail: `${SCAN_ID}\n`,
      stderr_tail: `INFO Scan Details:\n  │ Scan ID: ${SCAN_ID}\n  │ Target ID: ${TARGET_ID}\n  │ Credentials: ${CRED_ID}\n`
    }
  });
  assert.equal(extractScanId(pending), SCAN_ID);
});

test('the labeled scan id wins over other UUIDs in the same log', () => {
  const TARGET_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const pending = JSON.stringify({
    id: null,
    raw: { stderr_tail: `Target ID: ${TARGET_ID}\nScan ID: ${SCAN_ID}\n` }
  });
  assert.equal(extractScanId(pending), SCAN_ID);
});

test('recovers a bare scan id printed alone on the stdout tail', () => {
  const pending = JSON.stringify({
    id: null,
    raw: { stdout_tail: `\n${SCAN_ID}\n` }
  });
  assert.equal(extractScanId(pending), SCAN_ID);
});

