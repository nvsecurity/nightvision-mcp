import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticsPathFor, normalizeLanguages, zeroRouteSummary } from './extract-languages.js';

test('normalizeLanguages maps aliases to canonical CLI names', () => {
  assert.deepEqual(normalizeLanguages('dotnet'), ['csharp']);
  assert.deepEqual(normalizeLanguages(['TypeScript', 'js', 'py']), ['js', 'python']);
  assert.deepEqual(normalizeLanguages(['golang', 'ruby', 'php']), ['go', 'ruby', 'php']);
});

test('normalizeLanguages yields no language when none was given', () => {
  assert.deepEqual(normalizeLanguages(undefined), []);
  assert.deepEqual(normalizeLanguages([]), []);
});

test('normalizeLanguages rejects a language the CLI does not analyze', () => {
  assert.throws(() => normalizeLanguages('kotlin'), /Unsupported language: kotlin/);
  assert.throws(() => normalizeLanguages(['js', 'rust']), /Unsupported language: rust/);
});

test('diagnosticsPathFor replaces the output extension', () => {
  assert.equal(diagnosticsPathFor('/tmp/openapi-spec.yml'), '/tmp/openapi-spec.diagnostics.json');
  assert.equal(diagnosticsPathFor('/tmp/api.json'), '/tmp/api.diagnostics.json');
  assert.equal(diagnosticsPathFor('/tmp/spec'), '/tmp/spec.diagnostics.json');
});

test('zeroRouteSummary keeps the zero-route account and drops log decoration', () => {
  const log = [
    '[2026-10-08 15:00:00] INFO Number of discovered paths: 0',
    '[2026-10-08 15:00:00] WARN No routes were discovered. The scanned code declares no HTTP route the analyzer could read.',
    '[2026-10-08 15:00:00] WARN Python: 2 unresolved imports look like a web framework or an API library: aiohttp, sanic',
    '[2026-10-08 15:00:00] INFO Supported frameworks are listed at https://docs.nightviz.ai/api-discovery/frameworks/',
    '[2026-10-08 15:00:01] INFO Diagnostics for this run were written for inspection. file=openapi-spec.diagnostics.json pathsDiscovered=false',
    '[2026-10-08 15:00:01] ERROR error extracting API info err="0 paths discovered"',
    ''
  ].join('\n');

  assert.equal(zeroRouteSummary(log), [
    'No routes were discovered. The scanned code declares no HTTP route the analyzer could read.',
    'Python: 2 unresolved imports look like a web framework or an API library: aiohttp, sanic',
    'Supported frameworks are listed at https://docs.nightviz.ai/api-discovery/frameworks/',
    'Diagnostics for this run were written for inspection. file=openapi-spec.diagnostics.json pathsDiscovered=false'
  ].join('\n'));
});

test('zeroRouteSummary is empty when the log has no zero-route account', () => {
  assert.equal(zeroRouteSummary(undefined), '');
  assert.equal(zeroRouteSummary('[2026-10-08 15:00:00] ERROR login failed'), '');
});
