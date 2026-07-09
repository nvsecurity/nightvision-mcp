import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllAlertIds,
  getExclusionIds,
  getNucleiExclusionFolders,
  type ConfiguredChecks,
} from './check-catalog.js';

const checks: ConfiguredChecks = {
  zap: {
    standard: [
      { Id: '40018', Alert: 'SQL Injection', Status: 'release', Risk: 'High', Type: 'Active', Link: '' },
      { Id: '40012', Alert: 'Cross Site Scripting (Reflected)', Status: 'release', Risk: 'High', Type: 'Active', Link: '' },
    ],
    web: [
      { Id: '90020', Alert: 'Remote OS Command Injection', Status: 'release', Risk: 'High', Type: 'Active', Link: '' },
    ],
  },
  nuclei: ['cves', 'exposed-panels', 'misconfiguration'],
};

test('getAllAlertIds returns standard and web ids', () => {
  assert.deepEqual(getAllAlertIds(checks), ['40018', '40012', '90020']);
});

test('getExclusionIds excludes everything except the included check', () => {
  const { excludeIds, matchedAlerts } = getExclusionIds(checks, ['SQL Injection']);
  assert.deepEqual(matchedAlerts, ['SQL Injection [40018]']);
  assert.deepEqual(excludeIds.sort(), ['40012', '90020']);
});

test('getExclusionIds matches case-insensitively and across standard/web', () => {
  const { matchedAlerts } = getExclusionIds(checks, ['command injection']);
  assert.deepEqual(matchedAlerts, ['Remote OS Command Injection [90020]']);
});

test('getExclusionIds with no match excludes all alerts', () => {
  const { excludeIds, matchedAlerts } = getExclusionIds(checks, ['nonexistent']);
  assert.equal(matchedAlerts.length, 0);
  assert.deepEqual(excludeIds, ['40018', '40012', '90020']);
});

test('getNucleiExclusionFolders excludes folders not included', () => {
  const { excludeFolders, matchedFolders } = getNucleiExclusionFolders(checks, ['cves']);
  assert.deepEqual(matchedFolders, ['cves']);
  assert.deepEqual(excludeFolders.sort(), ['exposed-panels', 'misconfiguration']);
});
