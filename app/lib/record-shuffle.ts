/** Draw uniformly from records not yet picked this cycle, across all bins. */
export function createRecordShuffle(random = Math.random) {
  const drawn = new Set<string>();
  let last: string | undefined;
  return (ids: readonly string[], current?: string): string | undefined => {
    const available = [...new Set(ids)];
    const members = new Set(available);
    for (const id of drawn) if (!members.has(id)) drawn.delete(id);
    if (!available.length) { last = undefined; return undefined; }
    // Count the record already in the user's hands as seen this cycle.
    if (current && members.has(current)) drawn.add(current);
    let pool = available.filter(id => !drawn.has(id));
    if (!pool.length) {
      drawn.clear();
      pool = available.filter(id => id !== current && id !== last);
      if (!pool.length) pool = available.filter(id => id !== current);
      if (!pool.length) pool = available;
    }
    const id = pool[Math.floor(random() * pool.length)];
    drawn.add(id);
    last = id;
    return id;
  };
}
