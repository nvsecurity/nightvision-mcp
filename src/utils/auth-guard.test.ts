import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireProjectAccess } from './auth-guard.js';
import { nightvisionService } from '../services/index.js';

// Swap a method on the singleton service for the duration of a test.
function withStub(method: string, impl: any, fn: () => Promise<void>) {
  const svc = nightvisionService as any;
  const original = svc[method];
  svc[method] = impl;
  return fn().finally(() => { svc[method] = original; });
}

// Swap several methods at once.
function withStubs(stubs: Record<string, any>, fn: () => Promise<void>) {
  const svc = nightvisionService as any;
  const originals: Record<string, any> = {};
  for (const k of Object.keys(stubs)) { originals[k] = svc[k]; svc[k] = stubs[k]; }
  return fn().finally(() => { for (const k of Object.keys(originals)) svc[k] = originals[k]; });
}

function payload(response: any) {
  return JSON.parse(response.content[0].text);
}

test('requireProjectAccess reports a transient API outage as nightvision_api_unavailable, not access denied', async () => {
  await withStub(
    'getProjectByName',
    async () => { throw new Error('Failed to get project details: Request failed with status code 503'); },
    async () => {
      const res = await requireProjectAccess({ project: 'my-project', action: 'scanning' });
      assert.equal(res.ok, false);
      assert.deepEqual(payload(res.response).blockers, ['nightvision_api_unavailable']);
      // The classified blocker is exposed on the result so accumulating callers
      // (the harness front door) do not lose the distinction.
      assert.equal((res as any).blocker, 'nightvision_api_unavailable');
    }
  );
});

test('requireProjectAccess reports a genuine lookup failure as project_access_denied', async () => {
  await withStub(
    'getProjectByName',
    async () => { throw new Error("Project 'my-project' not found. Please check the project name and try again."); },
    async () => {
      const res = await requireProjectAccess({ project: 'my-project', action: 'scanning' });
      assert.equal(res.ok, false);
      assert.deepEqual(payload(res.response).blockers, ['project_access_denied']);
      assert.equal((res as any).blocker, 'project_access_denied');
    }
  );
});

test('requireProjectAccess: a socket-level connect permission-denied is an outage, not access denied', async () => {
  await withStubs(
    {
      // Go egress block: "connect: permission denied" (EACCES) is a network
      // failure, not a project-access rejection, despite the words.
      getProjectByName: async () => {
        const err = new Error('NightVision command failed') as any;
        err.stderr = 'Error: Get "https://api.nightvision.net/...": dial tcp 10.0.0.1:443: connect: permission denied';
        throw err;
      }
    },
    async () => {
      const res = await requireProjectAccess({ project: 'my-project', action: 'scanning' });
      assert.equal(res.ok, false);
      assert.equal((res as any).blocker, 'nightvision_api_unavailable');
    }
  );
});

test('requireProjectAccess: a CLI-backed outage on the project_id path is nightvision_api_unavailable', async () => {
  await withStubs(
    {
      // findProjectById resolves via the CLI (executeCommand); a connectivity
      // failure there is a Go CLI stderr, not an axios error, and must still be
      // classified as an outage rather than PROJECT_ACCESS_DENIED.
      executeCommand: async () => {
        const err = new Error('NightVision command failed: Command failed with exit code 1') as any;
        err.stderr = 'Error: Get "https://api.nightvision.net/api/v1/projects/": dial tcp 10.0.0.1:443: connect: connection refused';
        throw err;
      }
    },
    async () => {
      const res = await requireProjectAccess({ project_id: 'proj-123', action: 'scanning' });
      assert.equal(res.ok, false);
      assert.deepEqual(payload(res.response).blockers, ['nightvision_api_unavailable']);
    }
  );
});

test('requireProjectAccess: an outage on the UUID-shaped-name fallback is nightvision_api_unavailable', async () => {
  const uuid = '11111111-1111-1111-1111-111111111111';
  await withStubs(
    {
      // findProjectById lists projects via the CLI and finds no id match, so the
      // guard falls back to a name lookup, which is where the outage happens.
      executeCommand: async () => JSON.stringify({ results: [] }),
      getProjectByName: async () => { throw new Error('Failed to get project details: Request failed with status code 503'); }
    },
    async () => {
      const res = await requireProjectAccess({ project: uuid, action: 'scanning' });
      assert.equal(res.ok, false);
      assert.deepEqual(payload(res.response).blockers, ['nightvision_api_unavailable']);
    }
  );
});
