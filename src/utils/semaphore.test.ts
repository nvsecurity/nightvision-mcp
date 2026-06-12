import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from './semaphore.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('never exceeds the configured concurrency', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const task = async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(10);
    active--;
  };
  await Promise.all(Array.from({ length: 10 }, () => sem.run(task)));
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

test('a limit of 1 runs tasks one at a time in FIFO order', async () => {
  const sem = new Semaphore(1);
  const order: number[] = [];
  await Promise.all([
    sem.run(async () => { await delay(20); order.push(1); }),
    sem.run(async () => { await delay(1); order.push(2); }),
    sem.run(async () => { order.push(3); }),
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});

test('releases the slot when a task throws', async () => {
  const sem = new Semaphore(1);
  await assert.rejects(sem.run(async () => { throw new Error('boom'); }), /boom/);
  // The slot must be freed, so a later task can still run.
  assert.equal(await sem.run(async () => 'ok'), 'ok');
});

test('returns the task result', async () => {
  const sem = new Semaphore(3);
  assert.equal(await sem.run(async () => 42), 42);
});
