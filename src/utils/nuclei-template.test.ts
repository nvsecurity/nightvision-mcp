import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidNucleiTemplatePath } from './nuclei-template.js';

test('accepts a .yaml path', () => {
  assert.doesNotThrow(() => assertValidNucleiTemplatePath('/tmp/template.yaml'));
});

test('accepts a .yml path and is case-insensitive', () => {
  assert.doesNotThrow(() => assertValidNucleiTemplatePath('/tmp/template.YML'));
});

test('rejects a non-YAML extension', () => {
  assert.throws(() => assertValidNucleiTemplatePath('/tmp/template.txt'), /\.yaml or \.yml/);
});

test('rejects a path containing a NUL byte before checking the extension', () => {
  // The path ends in .yaml, so only the NUL-byte guard can reject it. Build the
  // NUL at runtime so the source stays ASCII.
  const nulPath = '/tmp/evil' + String.fromCharCode(0) + '.yaml';
  assert.throws(() => assertValidNucleiTemplatePath(nulPath), /Invalid template file path/);
});
