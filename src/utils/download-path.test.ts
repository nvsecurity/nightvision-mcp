import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDownloadDir } from './download-path.js';

const HOME = '/home/user';
const TMP = '/tmp';
const allWritable = () => true;

test('uses an absolute, writable path as given', () => {
  assert.equal(resolveDownloadDir('/data/out', HOME, TMP, allWritable), '/data/out');
});

test('falls back to home for a blank or undefined request', () => {
  assert.equal(resolveDownloadDir('', HOME, TMP, allWritable), HOME);
  assert.equal(resolveDownloadDir(undefined, HOME, TMP, allWritable), HOME);
});

test('falls back to home for a non-absolute request', () => {
  assert.equal(resolveDownloadDir('relative/dir', HOME, TMP, allWritable), HOME);
});

test('strips surrounding quotes before resolving', () => {
  assert.equal(resolveDownloadDir('"/data/out"', HOME, TMP, allWritable), '/data/out');
});

test('falls back to home when the requested dir is not writable but home is', () => {
  const isWritable = (dir: string) => dir !== '/data/out';
  assert.equal(resolveDownloadDir('/data/out', HOME, TMP, isWritable), HOME);
});

test('falls back to temp when neither the requested dir nor home is writable', () => {
  const isWritable = (dir: string) => dir === TMP;
  assert.equal(resolveDownloadDir('/data/out', HOME, TMP, isWritable), TMP);
});
