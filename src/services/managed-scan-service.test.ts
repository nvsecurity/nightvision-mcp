import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScanService } from './scan-service.js';
import type { ApiClient } from './api-client.js';

function installFakeNightVision(script: string) {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-managed-scan-'));
  const binDir = path.join(baseDir, 'bin');
  const logPath = path.join(baseDir, 'argv.log');
  mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, 'nightvision');
  writeFileSync(stub, script);
  chmodSync(stub, 0o755);
  return { baseDir, binDir, logPath };
}

function withFakePath<T>(binDir: string, logPath: string, fn: () => Promise<T>): Promise<T> {
  const oldPath = process.env.PATH;
  const oldLog = process.env.NIGHTVISION_TEST_LOG;
  process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ''}`;
  process.env.NIGHTVISION_TEST_LOG = logPath;
  return fn().finally(() => {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldLog === undefined) delete process.env.NIGHTVISION_TEST_LOG;
    else process.env.NIGHTVISION_TEST_LOG = oldLog;
  });
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getToken: () => 'token-1',
    executeCommand: async () => '',
    apiRequest: async () => {
      throw new Error('apiRequest was not expected');
    },
    ...overrides
  } as unknown as ApiClient;
}

test('startManagedScan returns a scan id from CLI output and passes scan flags', async () => {
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    'printf \'{"id":"scan-cli-1"}\'',
    'sleep 0.1',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    const service = new ScanService(client({
      apiRequest: async <T>() => ({ results: [] } as T)
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });

    const raw = await service.startManagedScan(
      'local-api',
      {
        project: 'Demo Project',
        auth: 'login-profile',
        force_private_scan: true,
        disable_zap_active_alerts: ['40012'],
        disable_nuclei_folders: ['cves/2024']
      },
      'json',
      5000
    );

    const result = JSON.parse(raw);
    assert.equal(result.id, 'scan-cli-1');
    assert.equal(result.extracted_id, 'scan-cli-1');
    assert.equal(result.cli_process.managed, true);
    assert.equal(result.target_name, 'local-api');
    assert.equal(result.project, 'Demo Project');

    const argv = readFileSync(fake.logPath, 'utf8');
    assert.match(argv, /scan local-api/);
    assert.match(argv, /-p Demo Project/);
    assert.match(argv, /-c login-profile/);
    assert.match(argv, /--force-private-scan/);
    assert.match(argv, /--disable-zap-active-alerts 40012/);
    assert.match(argv, /--disable-nuclei-folders cves\/2024/);
    assert.match(argv, /-F json/);
    assert.match(argv, /--api-url https:\/\/api\.nightvision\.net\/api\/v1\//);
  });
});

test('startManagedScan finds a recent API scan when CLI output is quiet', async () => {
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    'sleep 0.1',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    let sawResolvedFilters = false;
    // The pre-launch baseline snapshot must NOT already contain the new scan;
    // the started scan is the id that appears in list-scans AFTER launch. The
    // first apiRequest is the baseline (empty); later calls surface scan-api-1.
    let listCalls = 0;
    const service = new ScanService(client({
      apiRequest: async <T>(_endpoint: string, _method: 'GET' | 'POST' | 'PUT' | 'DELETE', params: Record<string, any>): Promise<T> => {
        assert.deepEqual(params.target, ['target-1']);
        assert.deepEqual(params.project, ['project-1']);
        assert.equal(params.limit, 25);
        sawResolvedFilters = true;
        listCalls += 1;
        if (listCalls === 1) {
          return { results: [] } as T;
        }
        return {
          results: [
            {
              id: 'scan-api-1',
              created_at: new Date().toISOString()
            }
          ]
        } as T;
      }
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });

    const raw = await service.startManagedScan(
      'local-api',
      { project: 'Demo Project' },
      'json',
      2000
    );

    const result = JSON.parse(raw);
    assert.equal(result.id, 'scan-api-1');
    assert.equal(result.extracted_id, 'scan-api-1');
    assert.equal(result.raw.id, 'scan-api-1');
    assert.equal(sawResolvedFilters, true);
  });
});

test('startManagedScan does NOT bind to a pre-existing scan for the target', async () => {
  // Regression: a target that already has a recent scan must not have that old
  // scan id returned as the newly started scan. CLI is quiet; list-scans returns
  // the SAME pre-existing scan before and after launch, so baseline-diff must
  // reject it and return a pending result rather than the wrong id.
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    'sleep 0.2',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    const preExisting = { id: 'scan-OLD', created_at: new Date(Date.now() - 60_000).toISOString() };
    const service = new ScanService(client({
      apiRequest: async <T>() => ({ results: [preExisting] } as T)
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });

    const raw = await service.startManagedScan('local-api', { project: 'Demo Project' }, 'json', 1500);
    const result = JSON.parse(raw);
    assert.notEqual(result.id, 'scan-OLD');
    assert.equal(result.id, null);
    assert.equal(result.scan_id_pending, true);
  });
});

test('startManagedScan does NOT kill the CLI relay when a scan id never appears', async () => {
  // Regression: for private scans the CLI process IS the Smart Proxy relay.
  // A scan-id timeout must leave the process running (tracked as pending), never
  // SIGTERM it and abort the scan we just started.
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    'sleep 5',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    const service = new ScanService(client({
      apiRequest: async <T>() => ({ results: [] } as T)
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });

    // Short timeout so no id is discovered before we give up waiting.
    const raw = await service.startManagedScan('local-api', { project: 'Demo Project' }, 'json', 300);
    const result = JSON.parse(raw);
    assert.equal(result.id, null);
    assert.equal(result.scan_id_pending, true);

    // The process must still be alive and tracked under its pending key.
    const listed = JSON.parse(service.listManagedScanProcesses());
    assert.equal(listed.results.length, 1);
    assert.equal(listed.results[0].exited, false);
    assert.equal(listed.results[0].scan_id_pending, true);

    // Clean up the still-running child.
    service.cancelManagedScanProcess(result.pending_process_key);
  });
});

test('startManagedScan ignores an unrelated UUID in CLI progress output', async () => {
  // Regression: the parser must not grab the first UUID anywhere in stdout (which
  // may be a target/project/credential id). Here the CLI prints a target UUID in
  // prose and no labeled scan id; the started scan is identified via list-scans.
  const targetUuid = '11111111-2222-3333-4444-555555555555';
  const scanUuid = '99999999-8888-7777-6666-555555555555';
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    `printf 'Using target ${targetUuid} to run scan...\\n'`,
    'sleep 0.2',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    let calls = 0;
    const service = new ScanService(client({
      apiRequest: async <T>() => {
        calls += 1;
        // Baseline (first call) empty; the new scan appears afterward.
        return (calls === 1 ? { results: [] } : { results: [{ id: scanUuid, created_at: new Date().toISOString() }] }) as T;
      }
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });

    const raw = await service.startManagedScan('local-api', { project: 'Demo Project' }, 'json', 2000);
    const result = JSON.parse(raw);
    // Must be the real scan id from list-scans, never the target UUID from prose.
    assert.equal(result.id, scanUuid);
    assert.notEqual(result.id, targetUuid);
  });
});

test('startManagedScan accepts a scan id that IS explicitly labeled in output', async () => {
  const scanUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    `printf 'scan_id: ${scanUuid}\\n'`,
    'sleep 0.1',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    const service = new ScanService(client({
      apiRequest: async <T>() => ({ results: [] } as T)
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });
    const raw = await service.startManagedScan('local-api', { project: 'Demo Project' }, 'json', 2000);
    assert.equal(JSON.parse(raw).id, scanUuid);
  });
});

test('managed scan processes can be listed, inspected, and cancelled', async () => {
  const fake = installFakeNightVision([
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$NIGHTVISION_TEST_LOG"',
    'printf \'{"id":"scan-long-1"}\'',
    'sleep 30',
    ''
  ].join('\n'));

  await withFakePath(fake.binDir, fake.logPath, async () => {
    const service = new ScanService(client({
      apiRequest: async <T>() => ({ results: [] } as T)
    }), {
      resolveTargetId: async () => 'target-1',
      getProjectByName: async () => ({ id: 'project-1' })
    });

    const raw = await service.startManagedScan(
      'local-api',
      { project: 'Demo Project' },
      'json',
      5000
    );
    assert.equal(JSON.parse(raw).id, 'scan-long-1');

    const listed = JSON.parse(service.listManagedScanProcesses());
    assert.equal(listed.results.length, 1);
    assert.equal(listed.results[0].scan_id, 'scan-long-1');
    assert.equal(listed.results[0].exited, false);

    const inspected = JSON.parse(service.getManagedScanProcess('scan-long-1'));
    assert.equal(inspected.scan_id, 'scan-long-1');
    assert.match(inspected.stdout_tail, /scan-long-1/);
    assert.equal(inspected.exited, false);

    const cancelled = JSON.parse(service.cancelManagedScanProcess('scan-long-1'));
    assert.equal(cancelled.scan_id, 'scan-long-1');
    assert.equal(cancelled.cancelled, true);
  });
});
