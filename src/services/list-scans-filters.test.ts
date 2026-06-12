import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { NightVisionService } from './nightvision.js';

// Swap in an axios adapter that short-circuits the request and records the
// serialized query string the service would actually send. node:test isolates
// each file in its own process, so this global mutation does not leak to other
// files; it is also restored in a finally.
function captureQuery(): { adapter: any; get: () => string } {
  let captured = '(no request)';
  const adapter = async (config: any) => {
    const serialize = config.paramsSerializer && config.paramsSerializer.serialize;
    captured = serialize ? serialize(config.params) : `BRACKETED:${JSON.stringify(config.params)}`;
    return { data: { count: 0, results: [] }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { adapter, get: () => captured };
}

const TARGET_UUID = 'fa225ed2-e970-4d0c-8d72-ee7afb5bcf62';
const PROJECT_UUID = '178f6736-789d-4473-aa45-0b1a0b69ab3b';

function target(name: string, id: string, projectName: string, projectId: string) {
  return {
    name, id, location: '',
    project_name: projectName, project: projectName, project_id: projectId,
    type: 'URL', is_ready_to_scan: true
  };
}

// Run listScans against the capturing adapter and return the serialized query.
// `stub` may override the resolution methods (listTargets / getProjectByName) so
// the test does not spawn the CLI or hit the network for resolution.
async function queryFor(options: any, stub: (svc: any) => void = () => {}): Promise<string> {
  const original = axios.defaults.adapter;
  const cap = captureQuery();
  axios.defaults.adapter = cap.adapter;
  try {
    const svc = new NightVisionService() as any;
    stub(svc);
    await svc.listScans(options, 'json');
  } finally {
    axios.defaults.adapter = original;
  }
  return cap.get();
}

test('project_id is sent under the project key, not the dead project_id key', async () => {
  const q = await queryFor({ project_id: PROJECT_UUID });
  assert.match(q, new RegExp(`(^|&)project=${PROJECT_UUID}(&|$)`), q);
  assert.ok(!q.includes('project_id='), `dead key project_id must not be sent: ${q}`);
  assert.ok(!q.includes('project_name='), q);
});

test('a project name is resolved to its id and sent as project=<uuid>', async () => {
  const q = await queryFor({ project: 'rich' }, (svc) => {
    svc.getProjectByName = async (name: string) => {
      assert.equal(name, 'rich');
      return { id: PROJECT_UUID, name };
    };
  });
  assert.match(q, new RegExp(`(^|&)project=${PROJECT_UUID}(&|$)`), q);
  assert.ok(!q.includes('project_name='), `dead key project_name must not be sent: ${q}`);
});

test('a target name is resolved to its id and sent as target=<uuid>', async () => {
  const q = await queryFor({ target: 'javaspringvulny' }, (svc) => {
    svc.listTargets = async () =>
      JSON.stringify([target('javaspringvulny', TARGET_UUID, 'rich', PROJECT_UUID)]);
  });
  assert.match(q, new RegExp(`(^|&)target=${TARGET_UUID}(&|$)`), q);
  assert.ok(!q.includes('target_name='), `dead key target_name must not be sent: ${q}`);
  assert.ok(!/target(\[|%5B)/.test(q), `target must be a repeated key, not bracketed: ${q}`);
});

test('resolved scope filters and the status filter serialize together as repeated keys', async () => {
  const q = await queryFor({ target: 'javaspringvulny', status: 'failed' }, (svc) => {
    svc.listTargets = async () =>
      JSON.stringify([target('javaspringvulny', TARGET_UUID, 'rich', PROJECT_UUID)]);
  });
  assert.match(q, new RegExp(`(^|&)target=${TARGET_UUID}(&|$)`), q);
  // 'failed' maps to the unsuccessful terminal status codes, each its own key.
  assert.match(q, /(^|&)status=3(&|$)/, q);
  assert.ok(!/status(\[|%5B)/.test(q), `status must not be bracketed: ${q}`);
});

test('an ambiguous target name is an error, not a silently broadened result', async () => {
  await assert.rejects(
    queryFor({ target: 'shrewm' }, (svc) => {
      svc.listTargets = async () =>
        JSON.stringify([
          target('shrewm', 'id-1', 'rich', 'p1'),
          target('shrewm', 'id-2', 'shrewm', 'p2')
        ]);
    }),
    /Multiple targets named "shrewm"/
  );
});

test('a target name that matches nothing is an error', async () => {
  await assert.rejects(
    queryFor({ target: 'nope' }, (svc) => {
      svc.listTargets = async () => JSON.stringify([]);
    }),
    /No target found with name: nope/
  );
});
