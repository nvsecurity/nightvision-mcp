import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageOutputPath } from './output-naming.js';

test('appends the language and preserves a .yml extension', () => {
  assert.equal(languageOutputPath('api-spec.yml', 'python'), 'api-spec_python.yml');
});

test('preserves a .json extension', () => {
  assert.equal(languageOutputPath('api-spec.json', 'go'), 'api-spec_go.json');
});

test('preserves a .yaml extension', () => {
  assert.equal(languageOutputPath('spec.yaml', 'js'), 'spec_js.yaml');
});

test('preserves the directory portion of the path', () => {
  assert.equal(languageOutputPath('/tmp/out/spec.yml', 'ruby'), '/tmp/out/spec_ruby.yml');
});

test('appends with no extension when none is recognized', () => {
  assert.equal(languageOutputPath('spec', 'php'), 'spec_php');
});

test('never emits a literal $1 (regression for the template-literal bug)', () => {
  const out = languageOutputPath('api-spec.yml', 'java');
  assert.ok(!out.includes('$1'), `unexpected literal $1 in ${out}`);
});
