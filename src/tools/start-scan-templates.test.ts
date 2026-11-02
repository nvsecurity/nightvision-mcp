import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerScanTools } from './scans.js';
import { nightvisionService } from '../services/index.js';

// start-scan with no_zap / run_only_nuclei_templates (NV-6605).

function captureTools(register: (server: any) => void) {
  const handlers = new Map<string, (args: any, extra: any) => Promise<any>>();
  register({ registerTool(name: string, _config: unknown, handler: any) { handlers.set(name, handler); } });
  return handlers;
}

function withStubbedService(stubs: Record<string, any>, fn: () => Promise<void>) {
  const svc = nightvisionService as any;
  const originals: Record<string, any> = {};
  for (const k of Object.keys(stubs)) { originals[k] = svc[k]; svc[k] = stubs[k]; }
  return fn().finally(() => { for (const k of Object.keys(originals)) svc[k] = originals[k]; });
}

const SCAN_ID = '123e4567-e89b-12d3-a456-426614174000';
const T_ADMIN = '11111111-1111-4111-8111-111111111111';
const T_ADMIN2 = '22222222-2222-4222-8222-222222222222';
const T_DEBUG = '33333333-3333-4333-8333-333333333333';
const ASSIGNED = [
  { id: T_ADMIN, name: 'Admin Panel' },
  { id: T_ADMIN2, name: 'Admin Panel Legacy' },
  { id: T_DEBUG, name: 'Debug Endpoint' }
];
// The cached catalog predates nightvision_nuclei_templates; a fresh read has it.
const STALE_CHECKS = { zap: { standard: [], web: [] }, nuclei: ['cves', 'exposures'] };
const FRESH_CHECKS = { zap: { standard: [], web: [] }, nuclei: ['cves', 'exposures', 'nightvision_nuclei_templates'] };

function stubs(overrides: Record<string, any> = {}) {
  const scans: any[] = [];
  const checkReads: any[] = [];
  const base = {
    getToken: () => 'test-token',
    getAuthenticatedUserResult: async () => ({ status: 'authenticated', user: { email: 'x@y.z' } }),
    getProjectByName: async () => ({ id: 'project-1', name: 'demo' }),
    resolveTargetId: async () => 'target-1',
    listTargetNucleiTemplates: async () => ASSIGNED,
    supportsDisableNucleiTemplates: async () => true,
    getConfiguredChecks: async (options?: { fresh?: boolean }) => {
      checkReads.push(options);
      return options?.fresh ? FRESH_CHECKS : STALE_CHECKS;
    },
    startManagedScan: async (_target: string, options: any) => {
      scans.push(options);
      return JSON.stringify({ id: SCAN_ID, extracted_id: SCAN_ID });
    },
    ...overrides
  };
  return { base, scans, checkReads };
}

const handler = () => {
  const h = captureTools(registerScanTools).get('start-scan');
  assert.ok(h, 'start-scan handler registered');
  return h!;
};

test('run_only_nuclei_templates alone skips the other templates and every built-in folder from a fresh read', async () => {
  const { base, scans, checkReads } = stubs();
  await withStubbedService(base, async () => {
    const res = await handler()({
      target_name: 'app', project: 'demo', no_zap: true, run_only_nuclei_templates: ['debug endpoint']
    }, {});
    const env = JSON.parse(res.content[0].text);
    assert.equal(env.ok, true);
    assert.equal(scans.length, 1);
    assert.equal(scans[0].no_zap, true);
    assert.deepEqual(scans[0].disable_nuclei_templates, [T_ADMIN, T_ADMIN2]);
    assert.deepEqual(scans[0].disable_nuclei_folders, ['cves', 'exposures', 'nightvision_nuclei_templates']);
    assert.deepEqual(checkReads, [{ fresh: true }]);
    assert.deepEqual(env.data.nuclei_templates_run, ['Debug Endpoint']);
    assert.deepEqual(env.data.nuclei_templates_skipped, ['Admin Panel', 'Admin Panel Legacy']);
    assert.equal(env.data.builtin_nuclei_folders_disabled, true);
  });
});

test('run_only_nuclei_templates with run_only_nuclei_folders keeps the folder selection', async () => {
  const { base, scans } = stubs();
  await withStubbedService(base, async () => {
    const res = await handler()({
      target_name: 'app', project: 'demo', run_only_nuclei_templates: [T_ADMIN], run_only_nuclei_folders: ['cves']
    }, {});
    assert.equal(JSON.parse(res.content[0].text).ok, true);
    assert.deepEqual(scans[0].disable_nuclei_folders, ['exposures', 'nightvision_nuclei_templates']);
    assert.deepEqual(scans[0].disable_nuclei_templates, [T_ADMIN2, T_DEBUG]);
  });
});

test('a template value that matches nothing returns the assigned list and starts no scan', async () => {
  const { base, scans } = stubs();
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['nope'] }, {});
    assert.equal(res.isError, true);
    const text = res.content[0].text;
    assert.match(text, /matches: nope/);
    for (const t of ASSIGNED) assert.ok(text.includes(`${t.name} (${t.id})`), `lists ${t.name}`);
    assert.equal(scans.length, 0);
  });
});

test('a template name that matches several templates is refused, not silently widened', async () => {
  const { base, scans } = stubs();
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['admin'] }, {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /'admin' matches several templates/);
    assert.equal(scans.length, 0);
  });
});

test('an old CLI without --disable-nuclei-templates fails before any scan starts', async () => {
  const { base, scans } = stubs({ supportsDisableNucleiTemplates: async () => false });
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['Admin Panel'] }, {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /does not support --disable-nuclei-templates/);
    assert.match(res.content[0].text, /Upgrade the NightVision CLI/);
    assert.equal(scans.length, 0);
  });
});

test('no_zap together with run_only_zap_checks is refused', async () => {
  const { base, scans } = stubs();
  await withStubbedService(base, async () => {
    const res = await handler()({
      target_name: 'app', project: 'demo', no_zap: true, run_only_zap_checks: ['SQL Injection']
    }, {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /not both/);
    assert.equal(scans.length, 0);
  });
});

const WITH_STATUS = [
  { id: T_ADMIN, name: 'Admin Panel', status: 'NO_FILE' },
  { id: T_DEBUG, name: 'Debug Endpoint', status: 'VALID' }
];

test('a picked template with no file is refused by name and starts no scan', async () => {
  const { base, scans } = stubs({ listTargetNucleiTemplates: async () => WITH_STATUS });
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['Admin Panel'] }, {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /file was never uploaded/);
    assert.ok(res.content[0].text.includes(`Admin Panel (${T_ADMIN})`));
    assert.equal(scans.length, 0);
  });
});

test('an unselected template with no file stays in the skip list', async () => {
  const { base, scans } = stubs({ listTargetNucleiTemplates: async () => WITH_STATUS });
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['Debug Endpoint'] }, {});
    assert.equal(JSON.parse(res.content[0].text).ok, true);
    assert.deepEqual(scans[0].disable_nuclei_templates, [T_ADMIN]);
  });
});

test('a picked template with no status counts as VALID (older API)', async () => {
  const { base, scans } = stubs();
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['Debug Endpoint'] }, {});
    assert.equal(JSON.parse(res.content[0].text).ok, true);
    assert.equal(scans.length, 1);
  });
});

test('a template listing that hits its page cap starts no scan', async () => {
  const { base, scans } = stubs({
    listTargetNucleiTemplates: async () => { throw new Error('more than 50 pages'); }
  });
  await withStubbedService(base, async () => {
    const res = await handler()({ target_name: 'app', project: 'demo', run_only_nuclei_templates: ['Debug Endpoint'] }, {});
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /more than 50 pages/);
    assert.match(res.content[0].text, /No scan was started/);
    assert.equal(scans.length, 0);
  });
});
