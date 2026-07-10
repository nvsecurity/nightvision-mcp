import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonText } from './tool-response.js';

test('jsonText returns successful structured MCP text content', () => {
  const response = jsonText({
    ok: true,
    status: 'success',
    data: { scan_id: 'scan-1' },
    warnings: ['warning-1']
  });

  assert.equal(response.isError, false);
  assert.equal(response.content[0].type, 'text');
  assert.deepEqual(JSON.parse(response.content[0].text), {
    ok: true,
    status: 'success',
    data: { scan_id: 'scan-1' },
    warnings: ['warning-1']
  });
});

test('jsonText marks blocked and error payloads as MCP errors', () => {
  const response = jsonText({
    ok: false,
    status: 'blocked',
    error: {
      code: 'NOT_AUTHENTICATED',
      message: 'Not authenticated.'
    },
    blockers: ['not_authenticated']
  });

  assert.equal(response.isError, true);
  assert.deepEqual(JSON.parse(response.content[0].text), {
    ok: false,
    status: 'blocked',
    error: {
      code: 'NOT_AUTHENTICATED',
      message: 'Not authenticated.'
    },
    blockers: ['not_authenticated']
  });
});
