import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActualOutputFile } from './discover-output-path.js';

// Build an existence predicate from a fixed set of paths that "exist".
const existsAmong = (...present: string[]) => (p: string) => present.includes(p);

test('returns the requested path when it exists', () => {
  const out = resolveActualOutputFile('/tmp/spec.json', existsAmong('/tmp/spec.json'));
  assert.equal(out, '/tmp/spec.json');
});

test('falls back to the .yml sibling the CLI actually wrote', () => {
  const out = resolveActualOutputFile('/tmp/spec.json', existsAmong('/tmp/spec.yml'));
  assert.equal(out, '/tmp/spec.yml');
});

test('falls back to .yaml when only that exists', () => {
  const out = resolveActualOutputFile('/tmp/spec.json', existsAmong('/tmp/spec.yaml'));
  assert.equal(out, '/tmp/spec.yaml');
});

test('prefers .yml over .yaml when both exist', () => {
  const out = resolveActualOutputFile('/tmp/spec.json', existsAmong('/tmp/spec.yml', '/tmp/spec.yaml'));
  assert.equal(out, '/tmp/spec.yml');
});

test('handles a requested path with no recognized extension', () => {
  const out = resolveActualOutputFile('/tmp/spec', existsAmong('/tmp/spec.yml'));
  assert.equal(out, '/tmp/spec.yml');
});

test('handles a requested .yml that is missing but a .yaml exists', () => {
  const out = resolveActualOutputFile('/tmp/spec.yml', existsAmong('/tmp/spec.yaml'));
  assert.equal(out, '/tmp/spec.yaml');
});

test('returns null when nothing exists, so the caller can report no spec was produced', () => {
  const out = resolveActualOutputFile('/tmp/spec.json', existsAmong());
  assert.equal(out, null);
});
