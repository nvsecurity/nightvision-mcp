import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeRepeatedParams } from './query-params.js';

test('serializes array values as repeated keys, not bracketed keys', () => {
  assert.equal(serializeRepeatedParams({ status: [1, 3, 4] }), 'status=1&status=3&status=4');
});

test('serializes scalar values', () => {
  assert.equal(serializeRepeatedParams({ target_name: 'web', limit: 5 }), 'target_name=web&limit=5');
});

test('skips null and undefined values', () => {
  assert.equal(serializeRepeatedParams({ a: 1, b: null, c: undefined, d: 2 }), 'a=1&d=2');
});

test('percent-encodes special characters in values', () => {
  // URLSearchParams encodes a space as "+" and "&" as "%26".
  assert.equal(serializeRepeatedParams({ q: 'a b&c' }), 'q=a+b%26c');
});

test('an empty object serializes to an empty string', () => {
  assert.equal(serializeRepeatedParams({}), '');
});
