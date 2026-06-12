import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanStatusFilterCodes } from './scan-status.js';

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
