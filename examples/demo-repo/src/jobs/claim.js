// Hand the oldest pending job to a worker.

export async function claimNext(store, workerId) {
  const job = await store.findOldestPending();
  if (!job) return null;

  const claimed = await store.update(job.id, {
    status: 'claimed',
    claimedBy: workerId,
    claimedAt: Date.now(),
  });
  return claimed;
}

export async function listClaimedBy(store, ids, workerId) {
  const out = [];
  for (const id of ids) {
    const job = await store.get(id);
    if (job && job.claimedBy === workerId) out.push(job);
  }
  return out;
}
