import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerScanTools } from './scans.js';
import { nightvisionService } from '../services/index.js';

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

const AUTH = {
  getToken: () => 'test-token',
  getAuthenticatedUserResult: async () => ({ status: 'authenticated', user: { email: 'x@y.z' } })
};

test('wait-for-scan keeps polling through a transient getScanStatus failure instead of aborting', async () => {
  const handler = captureTools(registerScanTools).get('wait-for-scan');
  assert.ok(handler, 'wait-for-scan handler registered');

  let calls = 0;
  await withStubbedService(
    {
      ...AUTH,
      getScanStatus: async () => {
        calls += 1;
        // First poll fails transiently (5xx); the wait must not abort.
        if (calls === 1) throw new Error('Request failed with status code 503');
        return JSON.stringify({ id: 's1', status: 'SUCCEEDED', status_value: 1 });
      }
    },
    async () => {
      const res = await handler!({ scan_id: 's1', timeout_seconds: 5, poll_interval_seconds: 0.01 }, {});
      const env = JSON.parse(res.content[0].text);
      assert.equal(env.ok, true, 'a transient poll failure did not abort the wait');
      assert.equal(env.data.terminal_status, 'succeeded');
      assert.ok(calls >= 2, 'polled again after the transient failure');
    }
  );
});
