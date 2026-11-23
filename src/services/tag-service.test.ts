import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_CREATED_TAG, TagService } from './tag-service.js';
import type { ApiClient } from './api-client.js';

interface Call {
  endpoint: string;
  method: string;
  params: Record<string, any>;
  data: any;
  headers?: Record<string, string>;
}

function createApiClient(handler: (call: Call) => any) {
  const calls: Call[] = [];
  const client = {
    apiRequest: async (
      endpoint: string,
      method: string,
      params: Record<string, any> = {},
      data: any = null,
      _isFormData = false,
      _serialize?: unknown,
      headers?: Record<string, string>
    ) => {
      const call = { endpoint, method, params, data, headers };
      calls.push(call);
      return handler(call);
    }
  } as unknown as ApiClient;
  return { client, calls };
}

test('tagAgentCreated reuses the existing label in the target organization', async () => {
  const { client, calls } = createApiClient((call) => {
    if (call.method === 'GET') {
      return {
        results: [
          { id: 'keyed', key: 'source', name: 'Agent created' },
          { id: 'label', key: '', name: 'agent created' }
        ]
      };
    }
    return { results: [{ target_id: 't1', status: 'updated', reason: null }] };
  });

  const result = await new TagService(client).tagAgentCreated('t1', 'org-1');

  assert.deepEqual(result, { tagged: true, tag_id: 'label', tag: 'Agent created' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endpoint, 'tags/');
  assert.equal(calls[0].params.filter, 'Agent created');
  assert.equal(calls[1].endpoint, 'tags/label/assign-to-targets/');
  assert.deepEqual(calls[1].data, { targets: ['t1'] });
  for (const call of calls) {
    assert.deepEqual(call.headers, { 'X-Active-Organization': 'org-1' });
  }
});

test('tagAgentCreated creates the label in the organization the target belongs to', async () => {
  const { client, calls } = createApiClient((call) => {
    if (call.endpoint === 'targets/t1/') return { id: 't1', organization_id: 'org-2' };
    if (call.method === 'GET') return { results: [] };
    if (call.endpoint === 'tags/') return { id: 'new-tag' };
    return { results: [{ target_id: 't1', status: 'updated', reason: null }] };
  });

  const result = await new TagService(client).tagAgentCreated('t1');

  assert.equal(result.tagged, true);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.endpoint}`), [
    'GET targets/t1/',
    'GET tags/',
    'POST tags/',
    'POST tags/new-tag/assign-to-targets/'
  ]);
  assert.deepEqual(calls[2].data, { ...AGENT_CREATED_TAG });
  for (const call of calls.slice(1)) {
    assert.deepEqual(call.headers, { 'X-Active-Organization': 'org-2' });
  }
});

test('tagAgentCreated picks up a label another agent created first', async () => {
  let lookups = 0;
  const { client } = createApiClient((call) => {
    if (call.endpoint === 'targets/t1/') return { id: 't1', organization_id: 'org-1' };
    if (call.method === 'GET') {
      lookups += 1;
      return { results: lookups === 1 ? [] : [{ id: 'raced', key: '', name: 'Agent created' }] };
    }
    if (call.endpoint === 'tags/') throw new Error('API request failed (400): duplicate');
    return { results: [{ target_id: 't1', status: 'updated', reason: null }] };
  });

  const result = await new TagService(client).tagAgentCreated('t1');

  assert.deepEqual(result, { tagged: true, tag_id: 'raced', tag: 'Agent created' });
});

test('tagAgentCreated reports a skipped assignment as a warning', async () => {
  const { client } = createApiClient((call) => {
    if (call.endpoint === 'targets/t1/') return { id: 't1', organization_id: 'org-1' };
    if (call.method === 'GET') return { results: [{ id: 'label', key: '', name: 'Agent created' }] };
    return { results: [{ target_id: 't1', status: 'skipped', reason: 'no_permission' }] };
  });

  const result = await new TagService(client).tagAgentCreated('t1');

  assert.equal(result.tagged, false);
  assert.match((result as { warning: string }).warning, /no_permission/);
});

test('tagAgentCreated never throws when the API fails', async () => {
  const { client } = createApiClient(() => {
    throw new Error('API request failed (403): forbidden');
  });

  const result = await new TagService(client).tagAgentCreated('t1');

  assert.equal(result.tagged, false);
  assert.match((result as { warning: string }).warning, /403/);
});
