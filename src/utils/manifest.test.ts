import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeManifest } from './manifest.js';

test('writeManifest creates .nightvision/manifest.json with valid JSON', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-manifest-'));

  const manifestPath = await writeManifest(root, {
    status: 'blocked',
    blockers: ['runtime_url_not_reachable']
  });

  assert.equal(manifestPath, path.join(root, '.nightvision', 'manifest.json'));
  assert.equal(existsSync(manifestPath), true);
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), {
    status: 'blocked',
    blockers: ['runtime_url_not_reachable']
  });
});
