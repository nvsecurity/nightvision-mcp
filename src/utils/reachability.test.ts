import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReachability } from './reachability.js';

test('checkReachability treats any HTTP response as reachable', async () => {
  const fetchImpl = async () => ({ status: 401 }) as Response;

  const result = await checkReachability('http://localhost:3000', 5, fetchImpl as typeof fetch);

  assert.deepEqual(result, {
    url: 'http://localhost:3000',
    reachable: true,
    status_code: 401
  });
});

test('checkReachability includes useful socket cause details on failure', async () => {
  const error: any = new TypeError('fetch failed');
  error.cause = { code: 'EPERM', address: '127.0.0.1', port: 4000 };
  const fetchImpl = async () => { throw error; };

  const result = await checkReachability('http://127.0.0.1:4000', 5, fetchImpl as typeof fetch);

  assert.equal(result.reachable, false);
  assert.match(result.error || '', /fetch failed/);
  assert.match(result.error || '', /code=EPERM/);
  assert.match(result.error || '', /address=127\.0\.0\.1/);
  assert.match(result.error || '', /port=4000/);
});
