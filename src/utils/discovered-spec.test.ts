import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { findDiscoveredSpec } from './discovered-spec.js';

test('findDiscoveredSpec prefers .nightvision/openapi.yml', () => {
  const exists = (p: string) => p === path.join('/app', '.nightvision', 'openapi.yml');
  const res = findDiscoveredSpec('/app', exists, () => []);
  assert.equal(res.path, path.join('/app', '.nightvision', 'openapi.yml'));
  assert.equal(res.ambiguous, false);
});

test('findDiscoveredSpec uses a single per-language spec when it is unambiguous', () => {
  const res = findDiscoveredSpec('/app', () => false, () => ['README.md', 'openapi_python.yml']);
  assert.equal(res.path, path.join('/app', '.nightvision', 'openapi_python.yml'));
  assert.equal(res.ambiguous, false);
});

test('findDiscoveredSpec uses the first of several per-language specs and flags it ambiguous', () => {
  const res = findDiscoveredSpec('/app', () => false, () => ['README.md', 'openapi_java.yml', 'openapi_python.yml']);
  // Use-first (matching the harness), flagged so the caller can warn rather than
  // silently attaching a possibly wrong-language spec.
  assert.equal(res.path, path.join('/app', '.nightvision', 'openapi_java.yml'));
  assert.equal(res.ambiguous, true);
  assert.deepEqual(res.candidates, [
    path.join('/app', '.nightvision', 'openapi_java.yml'),
    path.join('/app', '.nightvision', 'openapi_python.yml')
  ]);
});

test('findDiscoveredSpec returns a null path when no spec was produced', () => {
  const res = findDiscoveredSpec('/app', () => false, () => ['README.md']);
  assert.equal(res.path, null);
  assert.equal(res.ambiguous, false);
});

test('findDiscoveredSpec returns a null path (not throw) when .nightvision does not exist', () => {
  const res = findDiscoveredSpec('/app', () => false, () => { throw new Error('ENOENT'); });
  assert.equal(res.path, null);
});
