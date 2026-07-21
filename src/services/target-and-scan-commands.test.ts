import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TargetService } from './target-service.js';
import { ScanService } from './scan-service.js';
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
