import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENVIRONMENT } from '../config/environment.js';
import { ApiClient } from './api-client.js';
import { AuthService } from './auth-service.js';
import { ScanService } from './scan-service.js';

for (const version of ['0.18.0', '0.25.1', '0.26.0', '0.26.1', 'unknown']) {
  test(`CLI execution compatibility: ${version}`, {
    skip: process.platform === 'win32' ? 'requires an executable shell stub' : false
  }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'nv-cli-compat-'));
    const cli = join(dir, 'nightvision');
    const log = join(dir, 'argv.jsonl');
    writeFileSync(cli, [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const args = process.argv.slice(2);',
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      `process.stdout.write(args[0] === "version" ? "Version ${version}" : JSON.stringify(args));`
    ].join('\n'));
    chmodSync(cli, 0o755);
    const previousPath = ENVIRONMENT.NIGHTVISION_CLI_PATH;
    ENVIRONMENT.NIGHTVISION_CLI_PATH = cli;
    t.after(() => {
      ENVIRONMENT.NIGHTVISION_CLI_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    });

    const client = new ApiClient();
    assert.equal(await client.getCliVersion(), version === 'unknown' ? null : version);
    if (version === '0.18.0' || version === '0.25.1') {
      const upgrade = /Upgrade the NightVision CLI to 0\.26\.0 or later/;
      await assert.rejects(client.executeCommand(['target', 'list']), upgrade);
      await assert.rejects(new AuthService(client).createToken(), upgrade);
      const scans = new ScanService(client, {
        resolveTargetId: async () => { throw new Error('must not resolve a target'); },
        getProjectByName: async () => { throw new Error('must not resolve a project'); }
      });
      await assert.rejects(scans.startManagedScan('local-api'), upgrade);
      assert.deepEqual(JSON.parse(scans.listManagedScanProcesses()).results, []);
    } else {
      const argv = JSON.parse(await client.executeCommand(['target', 'list'], 'json'));
      assert.deepEqual(argv, ['target', 'list', '-F', 'json', '--api-url', ENVIRONMENT.CURRENT_API_URL]);
    }

    const calls: string[][] = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(calls.filter((args) => args[0] === 'version').every((args) => args.length === 1),
      'version probes must not depend on API flags or the compatibility guard');
    if (version === '0.18.0' || version === '0.25.1') {
      assert.ok(calls.every((args) => args[0] === 'version'), 'no CLI workflow is launched before upgrade');
    }
  });
}
