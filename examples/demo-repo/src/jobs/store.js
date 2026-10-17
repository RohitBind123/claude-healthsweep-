// In-memory job store. Every call is async, like a real database client.

const tick = () => new Promise((resolve) => setImmediate(resolve));

export function createStore(jobs = []) {
  const rows = new Map(jobs.map((j) => [j.id, { ...j }]));
  return {
    async findOldestPending() {
      await tick();
      const pending = [...rows.values()].filter((j) => j.status === 'pending');
      pending.sort((a, b) => a.createdAt - b.createdAt);
      return pending[0] ? { ...pending[0] } : null;
    },
    async update(id, fields) {
      await tick();
      const row = rows.get(id);
      rows.set(id, { ...row, ...fields });
      return { ...rows.get(id) };
    },
    async get(id) {
      await tick();
      return rows.has(id) ? { ...rows.get(id) } : null;
    },
  };
}
