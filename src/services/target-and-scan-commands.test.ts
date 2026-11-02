import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TargetService } from './target-service.js';
import { ScanService } from './scan-service.js';
import { NucleiService } from './nuclei-service.js';
import type { ApiClient, OutputFormat } from './api-client.js';

function createCommandClient(response = '{"ok":true}') {
  const calls: Array<{ args: string[]; format?: OutputFormat }> = [];
  const client = {
    executeCommand: async (args: string[], format?: OutputFormat) => {
      calls.push({ args, format });
      return response;
    }
  } as unknown as ApiClient;

  return { client, calls };
}

test('updateTarget invokes the documented target update CLI flags', async () => {
  const { client, calls } = createCommandClient();
  const svc = new TargetService(client);

  const result = await svc.updateTarget(
    'local-api',
    {
      project: 'demo',
      project_id: 'project-1',
      url: 'http://127.0.0.1:8080',
      spec_file: '/tmp/openapi.yml',
      spec_url: 'http://127.0.0.1:8080/openapi.json',
      exclude_url: ['/health'],
      exclude_xpath: ['//a[@id="logout"]']
    },
    'json'
  );

  assert.equal(result, '{"ok":true}');
  assert.equal(calls[0].format, 'json');
  assert.deepEqual(calls[0].args, [
    'target',
    'update',
    'local-api',
    '-p',
    'demo',
    '-P',
    'project-1',
    '-u',
    'http://127.0.0.1:8080',
    '--spec-file',
    '/tmp/openapi.yml',
    '--spec-url',
    'http://127.0.0.1:8080/openapi.json',
    '--exclude-url',
    '/health',
    '--exclude-xpath',
    '//a[@id="logout"]'
  ]);
});

test('startScan only passes force-private-scan when explicitly requested', async () => {
  const { client, calls } = createCommandClient('{"id":"123e4567-e89b-12d3-a456-426614174000"}');
  const svc = new ScanService(client, {
    resolveTargetId: async () => 'target-1',
    getProjectByName: async () => ({ id: 'project-1' })
  });

  await svc.startScan('local-api', { project: 'demo' }, 'json');
  await svc.startScan('local-api', { project: 'demo', force_private_scan: true }, 'json');

  assert.equal(calls[0].args.includes('--force-private-scan'), false);
  assert.equal(calls[1].args.includes('--force-private-scan'), true);
});

test('startScan passes --no-zap and --disable-nuclei-templates (NV-6605)', async () => {
  const { client, calls } = createCommandClient('{"id":"123e4567-e89b-12d3-a456-426614174000"}');
  const svc = new ScanService(client, {
    resolveTargetId: async () => 'target-1',
    getProjectByName: async () => ({ id: 'project-1' })
  });

  await svc.startScan('local-api', {
    project: 'demo',
    no_zap: true,
    disable_nuclei_folders: ['cves', 'nightvision_nuclei_templates'],
    disable_nuclei_templates: ['tpl-a', 'tpl-b']
  }, 'json');
  await svc.startScan('local-api', { project: 'demo', disable_nuclei_templates: [] }, 'json');

  assert.deepEqual(calls[0].args, [
    'scan', 'local-api', '-p', 'demo',
    '--disable-nuclei-folders', 'cves,nightvision_nuclei_templates',
    '--no-zap',
    '--disable-nuclei-templates', 'tpl-a,tpl-b'
  ]);
  assert.equal(calls[1].args.includes('--no-zap'), false);
  assert.equal(calls[1].args.includes('--disable-nuclei-templates'), false);
});

test('getConfiguredChecks with fresh skips the process-lifetime cache and refreshes it', async () => {
  let reads = 0;
  const client = {
    apiRequest: async () => {
      reads += 1;
      return { zap: { standard: [], web: [] }, nuclei: reads === 1 ? ['cves'] : ['cves', 'nightvision_nuclei_templates'] };
    }
  } as unknown as ApiClient;
  const svc = new ScanService(client, {
    resolveTargetId: async () => 'target-1',
    getProjectByName: async () => ({ id: 'project-1' })
  });

  assert.deepEqual((await svc.getConfiguredChecks()).nuclei, ['cves']);
  assert.deepEqual((await svc.getConfiguredChecks()).nuclei, ['cves'], 'cached read');
  assert.deepEqual((await svc.getConfiguredChecks({ fresh: true })).nuclei, ['cves', 'nightvision_nuclei_templates']);
  assert.deepEqual((await svc.getConfiguredChecks()).nuclei, ['cves', 'nightvision_nuclei_templates'], 'cache refreshed');
  assert.equal(reads, 2);
});

test('supportsDisableNucleiTemplates reads scan --help and caches only a yes', async () => {
  const helps = [
    '      --disable-nuclei-folders strings   x\n',
    '      --disable-nuclei-templates strings   x\n'
  ];
  const calls: string[][] = [];
  const client = {
    executeCommand: async (args: string[]) => {
      calls.push(args);
      return helps[Math.min(calls.length - 1, helps.length - 1)];
    }
  } as unknown as ApiClient;
  const svc = new ScanService(client, {
    resolveTargetId: async () => 'target-1',
    getProjectByName: async () => ({ id: 'project-1' })
  });

  assert.equal(await svc.supportsDisableNucleiTemplates(), false);
  assert.equal(await svc.supportsDisableNucleiTemplates(), true, 'an upgraded CLI is picked up');
  assert.equal(await svc.supportsDisableNucleiTemplates(), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['scan', '--help']);
});

function pagedClient(page: (n: number) => any) {
  const pages: number[] = [];
  const client = {
    apiRequest: async (_path: string, _method: string, params: { page: number }) => {
      pages.push(params.page);
      return page(params.page);
    }
  } as unknown as ApiClient;
  return { client, pages };
}

test('listTargetNucleiTemplates keeps each template status across pages', async () => {
  const { client, pages } = pagedClient((n) => (n === 1
    ? { results: [{ id: 'a', name: 'A', status: 'VALID' }], next: 'page-2' }
    : { results: [{ id: 'b', name: 'B', status: 'NO_FILE' }], next: null }));

  const templates = await new NucleiService(client).listTargetNucleiTemplates('target-1');

  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(templates.map((t) => [t.id, t.status]), [['a', 'VALID'], ['b', 'NO_FILE']]);
});

test('listTargetNucleiTemplates throws when the page cap leaves pages unread', async () => {
  const { client, pages } = pagedClient((n) => ({ results: [{ id: `t${n}`, name: `T${n}` }], next: 'more' }));

  await assert.rejects(
    new NucleiService(client).listTargetNucleiTemplates('target-1'),
    /more than 50 pages/
  );
  assert.equal(pages.length, 50);
});

test('listTargetNucleiTemplates accepts a list that ends exactly on the last page', async () => {
  const { client } = pagedClient((n) => ({
    results: [{ id: `t${n}`, name: `T${n}` }],
    next: n < 50 ? 'more' : null
  }));

  assert.equal((await new NucleiService(client).listTargetNucleiTemplates('target-1')).length, 50);
});
