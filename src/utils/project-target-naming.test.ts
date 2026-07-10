import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localTargetName } from './project-target-naming.js';

test('localTargetName emits names accepted by the NightVision CLI', () => {
  const name = localTargetName('repo/service.name', 'java-github-actions-demo');

  assert.match(name, /^[A-Za-z0-9_-]+$/);
  assert.ok(name.includes('-local-'));
  assert.ok(name.length <= 100);
  assert.equal(name.includes(':'), false);
  assert.equal(name.includes('.'), false);
  assert.equal(name.includes('/'), false);
});

test('localTargetName truncates long generated names without a trailing dash', () => {
  const name = localTargetName('repo', `${'very-long-app-name-'.repeat(12)}service`);

  assert.ok(name.length <= 100);
  assert.equal(name.endsWith('-'), false);
});
