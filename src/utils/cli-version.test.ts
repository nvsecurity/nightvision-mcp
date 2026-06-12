import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCliVersion, isCliVersionBelow, MIN_CLI_VERSION } from './cli-version.js';

test('extractCliVersion reads a version from real-looking output', () => {
  assert.equal(extractCliVersion('nightvision CLI\n\nVersion 0.11.1\nCommit abc123'), '0.11.1');
  assert.equal(extractCliVersion('Version v0.5.0'), '0.5.0');         // leading v is ignored
  assert.equal(extractCliVersion('Version V1.2.3'), '1.2.3');         // uppercase V too
  assert.equal(extractCliVersion('0.10.13'), '0.10.13');
});

test('extractCliVersion returns null when there is no version number', () => {
  assert.equal(extractCliVersion('nightvision CLI\n\nVersion unknown\nCommit unknown'), null);
  assert.equal(extractCliVersion(''), null);
});

test('isCliVersionBelow compares major.minor.patch numerically', () => {
  assert.equal(isCliVersionBelow('0.4.9', '0.5.0'), true);
  assert.equal(isCliVersionBelow('0.5.0', '0.5.0'), false);          // equal is not below
  assert.equal(isCliVersionBelow('0.11.1', '0.5.0'), false);
  assert.equal(isCliVersionBelow('0.5.0', '0.10.0'), true);          // 5 < 10, not lexical
  assert.equal(isCliVersionBelow('1.0.0', '0.5.0'), false);
});

test('isCliVersionBelow tolerates an optional v prefix on either side', () => {
  assert.equal(isCliVersionBelow('v0.4.9', '0.5.0'), true);
  assert.equal(isCliVersionBelow('v1.0.0', '0.5.0'), false);         // v must not zero the major
  assert.equal(isCliVersionBelow('0.11.1', 'v0.5.0'), false);
  assert.equal(isCliVersionBelow('v0.5.0', 'v0.5.0'), false);
});

test('the installed-version floor sits at or above where the relied-on flags appeared', () => {
  // Guard the constant: the flags this server uses arrived in 0.5.0, so the
  // floor must not be set below that.
  assert.equal(isCliVersionBelow(MIN_CLI_VERSION, '0.5.0'), false);
});
