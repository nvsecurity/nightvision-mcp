import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { isCoverageSuspect } from './harness.js';

// A succeeded scan whose SARIF export/read-back failed (so the source-linked
// finding set is empty) but that DID find issues must NOT be coverage_suspect.
// The coverage floor gates on the TRUE finding total, not the source-linked count.
test('a succeeded scan WITH findings but a failed SARIF export is NOT coverage_suspect', () => {
  // hasFindings=true even though the source-linked (SARIF) set is empty here.
  assert.equal(isCoverageSuspect('succeeded', true, false, 'failed'), false);
  assert.equal(isCoverageSuspect('succeeded', true, false, 'success'), false);
});

test('a succeeded scan with SARIF findings but a drifted status body is NOT coverage_suspect', () => {
  // hasFindings=false (status body omitted counts) but hasSourceFindings=true:
  // both sources must agree on zero before flagging suspect.
  assert.equal(isCoverageSuspect('succeeded', false, true, 'failed'), false);
});

test('a succeeded scan with 0 findings (both sources) and no fresh spec IS coverage_suspect', () => {
  assert.equal(isCoverageSuspect('succeeded', false, false, 'failed'), true);
  assert.equal(isCoverageSuspect('succeeded', false, false, 'skipped'), true);
});

test('a succeeded scan with 0 findings but a fresh spec from source is NOT coverage_suspect', () => {
  assert.equal(isCoverageSuspect('succeeded', false, false, 'success'), false);
});

test('a non-succeeded scan is never coverage_suspect', () => {
  assert.equal(isCoverageSuspect('failed', false, false, 'failed'), false);
  assert.equal(isCoverageSuspect('running', false, false, 'failed'), false);
  assert.equal(isCoverageSuspect('timeout', false, false, 'failed'), false);
});

// The harness must surface a structured coverage_suspect signal in both the
// returned scan result and the persisted manifest scan object.
test('the harness wires coverage_suspect into both the result and the manifest scan object', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, 'harness.js'), 'utf8');
  const occurrences = (src.match(/coverage_suspect: coverageSuspect/g) || []).length;
  assert.ok(occurrences >= 2, `expected coverage_suspect wired into result and manifest, found ${occurrences}`);
});
