import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllAlertIds,
  getExclusionIds,
  getNucleiExclusionFolders,
  selectNucleiTemplates,
  type ConfiguredChecks,
  type NucleiTemplateRef,
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

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const assigned: NucleiTemplateRef[] = [
  { id: T1, name: 'Admin Panel Check' },
  { id: T2, name: 'admin panel check v2' },
  { id: T3, name: 'Debug Endpoint' },
];

test('selectNucleiTemplates matches by exact id and skips the other templates', () => {
  const sel = selectNucleiTemplates(assigned, [T3]);
  assert.equal(sel.ok, true);
  if (!sel.ok) return;
  assert.deepEqual(sel.run.map((t) => t.id), [T3]);
  assert.deepEqual(sel.skip.map((t) => t.id), [T1, T2]);
  assert.equal(sel.matches[0].by, 'id');
});

test('selectNucleiTemplates prefers a case-insensitive exact name over partial matches', () => {
  // "admin panel check" is a substring of both names, but equals only the first.
  const sel = selectNucleiTemplates(assigned, ['ADMIN PANEL CHECK']);
  assert.equal(sel.ok, true);
  if (!sel.ok) return;
  assert.deepEqual(sel.run.map((t) => t.id), [T1]);
  assert.equal(sel.matches[0].by, 'name');
});

test('selectNucleiTemplates accepts a partial name that matches one template', () => {
  const sel = selectNucleiTemplates(assigned, ['debug']);
  assert.equal(sel.ok, true);
  if (!sel.ok) return;
  assert.deepEqual(sel.run.map((t) => t.id), [T3]);
  assert.equal(sel.matches[0].by, 'partial-name');
});

test('selectNucleiTemplates leaves a value longer than a template name unmatched', () => {
  const sel = selectNucleiTemplates(assigned, ['debug endpoint check v2']);
  assert.equal(sel.ok, false);
  if (sel.ok) return;
  assert.deepEqual(sel.unmatched, ['debug endpoint check v2']);
  assert.deepEqual(sel.ambiguous, []);
});

test('selectNucleiTemplates refuses a partial name that matches several templates', () => {
  const sel = selectNucleiTemplates(assigned, ['admin']);
  assert.equal(sel.ok, false);
  if (sel.ok) return;
  assert.deepEqual(sel.unmatched, []);
  assert.equal(sel.ambiguous.length, 1);
  assert.deepEqual(sel.ambiguous[0].candidates.map((t) => t.id), [T1, T2]);
});

test('selectNucleiTemplates refuses an exact name shared by several templates', () => {
  const dup: NucleiTemplateRef[] = [{ id: T1, name: 'Same' }, { id: T2, name: 'same' }];
  const sel = selectNucleiTemplates(dup, ['same']);
  assert.equal(sel.ok, false);
  if (sel.ok) return;
  assert.deepEqual(sel.ambiguous[0].candidates.map((t) => t.id), [T1, T2]);
});

test('selectNucleiTemplates fails when any value matches nothing', () => {
  const sel = selectNucleiTemplates(assigned, ['debug', 'nope', '  ']);
  assert.equal(sel.ok, false);
  if (sel.ok) return;
  assert.deepEqual(sel.unmatched, ['nope', '  ']);
});
