import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTargetArgs, extractUploadMode, supportsNoTarget } from './extract-target-args.js';

const named = { target: 'api', target_id: 'b8c4b0a2-5f0e-4e4e-9f3b-0d8e2b2c7a11', project: 'demo', project_id: 'c1d2e3f4-0000-4000-8000-000000000000' };
const targetArgs = [
  '--target', 'api',
  '--target-id', named.target_id,
  '--project', 'demo',
  '--project-id', named.project_id
];

test('extracts without a target by default', () => {
  assert.deepEqual(extractTargetArgs({}, true), ['--no-target']);
});

test('leaves out a named target unless no_target is false', () => {
  assert.deepEqual(extractTargetArgs({ ...named }, true), ['--no-target']);
  assert.deepEqual(extractTargetArgs({ ...named, no_target: true }, true), ['--no-target']);
});

test('falls back to --no-upload on a CLI without --no-target', () => {
  assert.deepEqual(extractTargetArgs({ ...named }, false), ['--no-upload']);
});

test('uploads to the named target when no_target is false', () => {
  assert.deepEqual(extractTargetArgs({ ...named, no_target: false }, true), targetArgs);
});

test('uploads nothing when no_upload is true, whatever else is set', () => {
  assert.deepEqual(extractTargetArgs({ no_upload: true }, true), ['--no-upload']);
  assert.deepEqual(extractTargetArgs({ ...named, no_target: false, no_upload: true }, true), ['--no-upload']);
});

test('keeps the former target upload request working', () => {
  assert.deepEqual(extractTargetArgs({ ...named, no_upload: false }, true), targetArgs);
  assert.equal(extractUploadMode({ no_upload: false }), 'nightvision');
  assert.equal(extractUploadMode({ ...named, no_target: true, no_upload: false }), 'nightvision');
});

test('detects --no-target in the flag list only', () => {
  assert.equal(supportsNoTarget('Flags:\n      --no-target   Run without a target\n      --no-upload   Upload nothing\n'), true);
  assert.equal(supportsNoTarget('Flags:\n      --no-upload   Skip creation of the new target\n'), false);
  assert.equal(supportsNoTarget('To try it without a target, use --no-target.\n'), false);
});
