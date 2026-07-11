import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { findDiscoveredSpec } from './discovered-spec.js';

test('findDiscoveredSpec prefers .nightvision/openapi.yml', () => {
  const exists = (p: string) => p === path.join('/app', '.nightvision', 'openapi.yml');
  assert.equal(findDiscoveredSpec('/app', exists, () => []), path.join('/app', '.nightvision', 'openapi.yml'));
});

test('findDiscoveredSpec falls back to a per-language spec', () => {
  const exists = () => false;
  const listDir = () => ['README.md', 'openapi_java.yml', 'openapi_python.yml'];
  // Sorted, so the first per-language spec is deterministic.
  assert.equal(findDiscoveredSpec('/app', exists, listDir), path.join('/app', '.nightvision', 'openapi_java.yml'));
});

test('findDiscoveredSpec returns null when no spec was produced', () => {
  assert.equal(findDiscoveredSpec('/app', () => false, () => ['README.md']), null);
});

test('findDiscoveredSpec returns null (not throw) when .nightvision does not exist', () => {
  const listDir = () => { throw new Error('ENOENT'); };
  assert.equal(findDiscoveredSpec('/app', () => false, listDir), null);
});
