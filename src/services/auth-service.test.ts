import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './auth-service.js';
import type { ApiClient } from './api-client.js';

/**
 * Build an AuthService whose token validation call behaves as configured.
 * `mode` controls what the user/me request does.
 */
function authService(mode: 'ok' | 'unauthorized' | 'forbidden' | 'network' | 'server_error' | 'no_token') {
  const client = {
    getToken: () => (mode === 'no_token' ? '' : 'token-1'),
    apiRequest: async () => {
      if (mode === 'ok') {
        return { user: { id: 'user-1', email: 'dev@example.com', name: 'Dev' } };
      }
      const statusByMode: Record<string, number | undefined> = {
        unauthorized: 401,
        forbidden: 403,
        server_error: 500,
        network: undefined
      };
      const statusCode = statusByMode[mode];
      const err = new Error(`API request failed (${statusCode}): boom`) as Error & {
        statusCode?: number;
        isNetworkError?: boolean;
      };
      err.statusCode = statusCode;
      err.isNetworkError = statusCode === undefined;
      throw err;
    }
  } as unknown as ApiClient;
  return new AuthService(client);
}

test('getAuthenticatedUserResult: valid token returns authenticated with the user', async () => {
  const result = await authService('ok').getAuthenticatedUserResult();
  assert.equal(result.status, 'authenticated');
  if (result.status === 'authenticated') {
    assert.equal(result.user.email, 'dev@example.com');
  }
});

test('getAuthenticatedUserResult: no token is unauthenticated', async () => {
  const result = await authService('no_token').getAuthenticatedUserResult();
  assert.equal(result.status, 'unauthenticated');
});

test('getAuthenticatedUserResult: 401 is unauthenticated (real bad token)', async () => {
  const result = await authService('unauthorized').getAuthenticatedUserResult();
  assert.equal(result.status, 'unauthenticated');
});

test('getAuthenticatedUserResult: 403 is unauthenticated', async () => {
  const result = await authService('forbidden').getAuthenticatedUserResult();
  assert.equal(result.status, 'unauthenticated');
});

test('getAuthenticatedUserResult: a network blip is error, NOT a bad token', async () => {
  // This is the core regression: a transient outage must not be reported as an
  // expired token, or every guarded tool would tell the user to re-authenticate.
  const result = await authService('network').getAuthenticatedUserResult();
  assert.equal(result.status, 'error');
});

test('getAuthenticatedUserResult: a 500 is error, NOT a bad token', async () => {
  const result = await authService('server_error').getAuthenticatedUserResult();
  assert.equal(result.status, 'error');
});
