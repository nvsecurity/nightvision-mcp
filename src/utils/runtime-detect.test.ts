import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargetUrl } from './runtime-detect.js';
import type { ReachabilityResult } from './reachability.js';

test('resolveTargetUrl adopts a reachable provided URL', async () => {
  const checker = async (url: string): Promise<ReachabilityResult> => ({ url, reachable: true, status_code: 200 });
  const r = await resolveTargetUrl('http://127.0.0.1:8080', 5, checker);
  assert.equal(r.target_url, 'http://127.0.0.1:8080');
  assert.equal(r.checked_urls.length, 1);
  assert.equal(r.checked_urls[0].reachable, true);
});

test('resolveTargetUrl rejects a provided URL that is not reachable', async () => {
  const checker = async (url: string): Promise<ReachabilityResult> => ({ url, reachable: false, error: 'connection refused' });
  const r = await resolveTargetUrl('http://127.0.0.1:1', 5, checker);
  assert.equal(r.target_url, null);
  assert.equal(r.checked_urls[0].reachable, false);
});

test('resolveTargetUrl returns no target when none is provided (the agent must supply the URL)', async () => {
  let called = false;
  const checker = async (url: string): Promise<ReachabilityResult> => { called = true; return { url, reachable: true }; };
  const r = await resolveTargetUrl(undefined, 5, checker);
  assert.equal(r.target_url, null);
  assert.deepEqual(r.checked_urls, []);
  assert.equal(called, false, 'must not probe anything when no URL is supplied');
});
