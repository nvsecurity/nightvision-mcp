import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyScanStatus, scanHasFindings, scanStatusFilterCodes } from './scan-status.js';

test('running maps to the RUNNING code', () => {
  assert.deepEqual(scanStatusFilterCodes('running'), [2]);
});

test('finished maps to every terminal status', () => {
  assert.deepEqual(scanStatusFilterCodes('finished'), [1, 3, 4, 5]);
});

test('failed maps to the unsuccessful terminal statuses', () => {
  assert.deepEqual(scanStatusFilterCodes('failed'), [3, 4, 5]);
});

test('an unrecognized name (including all) yields no codes', () => {
  assert.deepEqual(scanStatusFilterCodes('all'), []);
  assert.deepEqual(scanStatusFilterCodes('bogus'), []);
});

test('classifies numeric scan status values', () => {
  assert.equal(classifyScanStatus({ status: 1 }), 'succeeded');
  assert.equal(classifyScanStatus({ status: 2 }), 'running');
  assert.equal(classifyScanStatus({ status: 6 }), 'running');
  assert.equal(classifyScanStatus({ status: 4 }), 'failed');
});

test('classifies string scan status values from common response shapes', () => {
  assert.equal(classifyScanStatus({ status: 'FINISHED' }), 'succeeded');
  assert.equal(classifyScanStatus({ state: 'in progress' }), 'running');
  assert.equal(classifyScanStatus({ scan: { status_value: 'TIMED_OUT' } }), 'failed');
});

test('unknown scan status values stay unknown', () => {
  assert.equal(classifyScanStatus({ status: 'mystery' }), 'unknown');
  assert.equal(classifyScanStatus({}), 'unknown');
});

test('a transient poll error is non-terminal, so the long wait keeps polling', () => {
  // waitForScan wraps a failed getScanStatus call as { poll_error } and feeds it
  // back through classifyScanStatus. It must NOT read as succeeded or failed, or a
  // single 5xx/ECONNRESET mid-scan would end the wait and drop the scan handle.
  const state = classifyScanStatus({ poll_error: 'ECONNRESET' });
  assert.equal(state, 'unknown');
  assert.notEqual(state, 'succeeded');
  assert.notEqual(state, 'failed');
});

test('detects findings on terminal scan responses', () => {
  assert.equal(scanHasFindings({ issues_count: 1 }), true);
  assert.equal(scanHasFindings({ issues_statistics: { High: 0, Low: 2 } }), true);
  assert.equal(scanHasFindings({ unique_issues_statistics: { High: '3' } }), true);
  assert.equal(scanHasFindings({ issues_count: 0, issues_statistics: { High: 0 } }), false);
});
