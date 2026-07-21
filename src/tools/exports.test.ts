import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExportability } from './exports.js';

test('a succeeded scan is exportable', () => {
  const r = evaluateExportability(JSON.stringify({ status_value: 1, issues_count: 3 }));
  assert.equal(r.exportable, true);
  assert.equal(r.state, 'succeeded');
});

test('a FAILED scan WITH findings is still exportable (NightVision yields findings on failed scans)', () => {
  const r = evaluateExportability(JSON.stringify({ status: 'FAILED', issues_count: 12 }));
  assert.equal(r.exportable, true);
  assert.equal(r.hasFindings, true);
});

test('a FAILED scan WITHOUT findings is NOT exportable', () => {
  const r = evaluateExportability(JSON.stringify({ status: 'FAILED', issues_count: 0 }));
  assert.equal(r.exportable, false);
  assert.equal(r.state, 'failed');
  assert.equal(r.hasFindings, false);
});

test('a still-running scan is NOT exportable', () => {
  const r = evaluateExportability(JSON.stringify({ status: 'RUNNING' }));
  assert.equal(r.exportable, false);
  assert.equal(r.state, 'running');
});

test('a RUNNING scan reporting partial findings is NOT exportable', () => {
  const r = evaluateExportability(JSON.stringify({ status: 'RUNNING', issues_count: 4 }));
  assert.equal(r.state, 'running');
  assert.equal(r.hasFindings, true);
  assert.equal(r.exportable, false);
});

test('a scan with findings surfaced only in statistics is exportable', () => {
  const r = evaluateExportability(JSON.stringify({
    status: 'ABORTED',
    issues_statistics: { critical: 0, high: 2, medium: 0 }
  }));
  assert.equal(r.exportable, true);
  assert.equal(r.hasFindings, true);
});

test('non-JSON status does not hard-block export', () => {
  const r = evaluateExportability('not json at all');
  assert.equal(r.exportable, true);
  assert.equal(r.state, 'unknown');
});
