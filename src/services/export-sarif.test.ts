import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExportService } from './export-service.js';
import type { ApiClient, OutputFormat } from './api-client.js';

function createExportService() {
  let capturedArgs: string[] = [];
  let capturedFormat: OutputFormat | undefined;

  const client = {
    executeCommand: async (args: string[], format?: OutputFormat) => {
      capturedArgs = args;
      capturedFormat = format;
      return '{"ok":true}';
    }
  } as unknown as ApiClient;

  return {
    svc: new ExportService(client),
    getCapturedArgs: () => capturedArgs,
    getCapturedFormat: () => capturedFormat
  };
}

test('exportSarif invokes the CLI with scan id and output path', async () => {
  const { svc, getCapturedArgs, getCapturedFormat } = createExportService();

  const result = await svc.exportSarif(
    'scan-1',
    '/tmp/nightvision.sarif',
    { swagger_file: '/tmp/openapi.yml', randomize_issue_ids: true },
    'json'
  );

  assert.equal(result, '{"ok":true}');
  assert.equal(getCapturedFormat(), 'json');
  assert.deepEqual(getCapturedArgs(), [
    'export',
    'sarif',
    '--scan-id',
    'scan-1',
    '--output',
    '/tmp/nightvision.sarif',
    '--swagger-file',
    '/tmp/openapi.yml',
    '--randomize-issue-ids'
  ]);
});

test('exportCsv invokes the CLI with scan id and output path', async () => {
  const { svc, getCapturedArgs, getCapturedFormat } = createExportService();

  const result = await svc.exportCsv(
    'scan-1',
    '/tmp/nightvision.csv',
    'json'
  );

  assert.equal(result, '{"ok":true}');
  assert.equal(getCapturedFormat(), 'json');
  assert.deepEqual(getCapturedArgs(), [
    'export',
    'csv',
    '--scan-id',
    'scan-1',
    '--output',
    '/tmp/nightvision.csv'
  ]);
});
