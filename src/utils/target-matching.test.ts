import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchTargetByName } from './target-matching.js';
import type { Target } from '../types/index.js';

const t = (name: string, project_name: string, project_id: string): Target => ({
  name,
  id: `${project_name}-${name}`,
  location: 'https://example.com',
  project_name,
  project: project_name,
  project_id,
  type: 'WEB',
  is_ready_to_scan: true,
});

test('returns the single match by name', () => {
  const r = matchTargetByName([t('a', 'p1', 'id1'), t('b', 'p1', 'id1')], 'a');
  assert.equal(r.status, 'found');
  if (r.status !== 'found') return;
  assert.equal(r.target.name, 'a');
});

test('reports not-found when no target matches', () => {
  const r = matchTargetByName([t('a', 'p1', 'id1')], 'missing');
  assert.equal(r.status, 'not-found');
});

test('reports ambiguous when the same name exists in multiple projects', () => {
  const r = matchTargetByName([t('a', 'p1', 'id1'), t('a', 'p2', 'id2')], 'a');
  assert.equal(r.status, 'ambiguous');
  if (r.status !== 'ambiguous') return;
  assert.deepEqual(r.projects, ['p1', 'p2']);
});

test('narrows an ambiguous name by project name', () => {
  const r = matchTargetByName([t('a', 'p1', 'id1'), t('a', 'p2', 'id2')], 'a', 'p2');
  assert.equal(r.status, 'found');
  if (r.status !== 'found') return;
  assert.equal(r.target.project_name, 'p2');
});

test('narrows an ambiguous name by project id', () => {
  const r = matchTargetByName([t('a', 'p1', 'id1'), t('a', 'p2', 'id2')], 'a', undefined, 'id1');
  assert.equal(r.status, 'found');
  if (r.status !== 'found') return;
  assert.equal(r.target.project_id, 'id1');
});
