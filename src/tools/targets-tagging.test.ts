import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { nightvisionService } from '../services/index.js';
import { tagNewTarget } from './targets.js';

const service = nightvisionService as any;
const original = {
  listTargets: service.listTargets,
  tagAgentCreated: service.tagAgentCreated
};

afterEach(() => {
  service.listTargets = original.listTargets;
  service.tagAgentCreated = original.tagAgentCreated;
});

function stubTagging() {
  const tagged: Array<{ id: string; org: unknown }> = [];
  service.tagAgentCreated = async (id: string, org: unknown) => {
    tagged.push({ id, org });
    return { tagged: true, tag_id: 'tag-1', tag: 'Agent created' };
  };
  return tagged;
}

test('tagNewTarget tags the target from JSON create output', async () => {
  const tagged = stubTagging();
  service.listTargets = async () => {
    throw new Error('JSON output should not need a lookup');
  };

  const note = await tagNewTarget('{"id":"t1","name":"app"}', 'json', 'app', 'Demo');

  assert.equal(note, 'Tagged "Agent created".');
  assert.deepEqual(tagged, [{ id: 't1', org: undefined }]);
});

test('tagNewTarget looks the target up by name for table output', async () => {
  const tagged = stubTagging();
  service.listTargets = async (_all: boolean, projects: string[]) => {
    assert.deepEqual(projects, ['Demo']);
    // CLI list rows carry project and project_name, not project_id.
    return JSON.stringify([
      { id: 'other', name: 'other-app', project: 'p1', project_name: 'Demo' },
      { id: 't2', name: 'app', project: 'p1', project_name: 'Demo' }
    ]);
  };

  const note = await tagNewTarget('| app | ... |', 'table', 'app', 'Demo');

  assert.equal(note, 'Tagged "Agent created".');
  assert.deepEqual(tagged, [{ id: 't2', org: undefined }]);
});

test('tagNewTarget explains when it cannot find the new target', async () => {
  const tagged = stubTagging();
  service.listTargets = async () => JSON.stringify([]);

  const note = await tagNewTarget('created', 'text', 'app', 'Demo');

  assert.match(note, /could not find the new target/);
  assert.equal(tagged.length, 0);
});

test('tagNewTarget passes a tagging warning through as a note', async () => {
  service.tagAgentCreated = async () => ({ tagged: false, warning: 'Could not add the tag (no_permission).' });

  const note = await tagNewTarget('{"id":"t1"}', 'json', 'app', 'Demo');

  assert.equal(note, 'Note: Could not add the tag (no_permission).');
});
