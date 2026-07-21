import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { isNonAppSourcePath } from './app-source-path.js';

const HOME = '/Users/dev';

test('rejects the home directory itself (the real-world "ran from home" failure)', () => {
  assert.equal(isNonAppSourcePath('/Users/dev', HOME), true);
  assert.equal(isNonAppSourcePath('/Users/dev/', HOME), true);
});

test('rejects a filesystem root', () => {
  assert.equal(isNonAppSourcePath('/', HOME), true);
  assert.equal(isNonAppSourcePath(path.parse(process.cwd()).root, HOME), true);
});

test('allows a real project directory under home', () => {
  assert.equal(isNonAppSourcePath('/Users/dev/repos/my-api', HOME), false);
});

test('allows a project directory with no detected language (valid WEB-target scan)', () => {
  // A bare directory is still a legitimate scan target; only home/root are refused.
  assert.equal(isNonAppSourcePath('/srv/some-app', HOME), false);
});
