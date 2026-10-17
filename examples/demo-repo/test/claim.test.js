import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/jobs/store.js';
import { claimNext } from '../src/jobs/claim.js';

const jobs = () => [
  { id: 'a', status: 'pending', createdAt: 1 },
  { id: 'b', status: 'pending', createdAt: 2 },
];

test('claims the oldest pending job', async () => {
  const store = createStore(jobs());
  const job = await claimNext(store, 'w1');
  assert.equal(job.id, 'a');
  assert.equal(job.claimedBy, 'w1');
});

test('two claims in a row get different jobs', async () => {
  const store = createStore(jobs());
  const first = await claimNext(store, 'w1');
  const second = await claimNext(store, 'w2');
  assert.notEqual(first.id, second.id);
});

test('returns null when nothing is pending', async () => {
  const store = createStore([]);
  assert.equal(await claimNext(store, 'w1'), null);
});
