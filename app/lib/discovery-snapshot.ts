import type { Album } from "../data/types";
import { eligibleSavedAlbums, membershipAlbumId, type SavedMembership } from "./saved-membership";

export const DISCOVERY_LIFETIME = 7 * 86400000;
export const DISCOVERY_LIMIT = 20;
export const DISCOVERY_TYPES = ["forgotten", "wander", "digging"] as const;
export type DiscoveryType = typeof DISCOVERY_TYPES[number];
export type DiscoverySnapshot = {
  id: string; accountId: string; generatedAt: number; expiresAt: number; version: "framework-1" | "cold-start-1" | "behavioral-1";
  bins: { type: DiscoveryType; albumIds: string[] }[];
};
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

/** Allowlisted durable shape; array order is the saved browsing order. */
export function checkedDiscoverySnapshot(value: unknown, accountId: string): DiscoverySnapshot {
  const row = value as DiscoverySnapshot | null;
  if (!/^[a-f0-9]{64}$/.test(accountId) || !row || row.accountId !== accountId || !validId(row.id)
    || (row.version !== "framework-1" && row.version !== "cold-start-1" && row.version !== "behavioral-1") || !Number.isSafeInteger(row.generatedAt) || row.generatedAt <= 0
    || !Number.isSafeInteger(row.expiresAt) || row.expiresAt !== row.generatedAt + DISCOVERY_LIFETIME
    || !Array.isArray(row.bins) || row.bins.length !== DISCOVERY_TYPES.length) throw new Error("Invalid discovery snapshot.");
  const seen = new Set<string>();
  const bins = row.bins.map((bin, index) => {
    if (!bin || bin.type !== DISCOVERY_TYPES[index] || !Array.isArray(bin.albumIds) || bin.albumIds.length > DISCOVERY_LIMIT) throw new Error("Invalid discovery bin.");
    const albumIds = bin.albumIds.map(id => {
      if (typeof id !== "string" || !/^spotify:[a-zA-Z0-9]{1,64}$/.test(id) || seen.has(id)) throw new Error("Invalid or overlapping discovery album.");
      seen.add(id); return id;
    });
    return { type: bin.type, albumIds };
  });
  return { id: row.id, accountId, generatedAt: row.generatedAt, expiresAt: row.expiresAt, version: row.version, bins };
}
export function discoveryIsCurrent(snapshot: DiscoverySnapshot, now: number) {
  return Number.isSafeInteger(now) && now >= snapshot.generatedAt && now < snapshot.expiresAt;
}

/** Assignment only, not ranking. Ordered candidates come from a separate generator.
 * Round-robin allocation keeps a small library from being consumed by the first bin.
 * Forgotten Favorites receives nothing unless the caller supplies evidence-based candidates.
 */
export function assignDiscoverySnapshot(input: {
  id: string; accountId: string; now: number; albums: readonly Album[]; membership: readonly SavedMembership[];
  candidates: Partial<Record<DiscoveryType, readonly string[]>>; version?: DiscoverySnapshot["version"];
}): DiscoverySnapshot {
  const eligible = new Set(eligibleSavedAlbums(input.albums, input.membership, input.now).map(membershipAlbumId));
  const used = new Set<string>();
  const queues = DISCOVERY_TYPES.map(type => [...new Set(input.candidates[type] ?? [])].filter(id => eligible.has(id)));
  const bins = DISCOVERY_TYPES.map(type => ({ type, albumIds: [] as string[] }));
  const positions = [0, 0, 0];
  for (let round = 0; round < DISCOVERY_LIMIT; round++) {
    for (let index = 0; index < bins.length; index++) {
      const queue = queues[index];
      while (positions[index] < queue.length && used.has(queue[positions[index]])) positions[index]++;
      const id = queue[positions[index]++];
      if (id) { used.add(id); bins[index].albumIds.push(id); }
    }
  }
  return checkedDiscoverySnapshot({ id: input.id, accountId: input.accountId, generatedAt: input.now,
    expiresAt: input.now + DISCOVERY_LIFETIME, version: input.version ?? "framework-1", bins }, input.accountId);
}

/** A filtered view never refills or changes the persisted ordering. */
export function visibleDiscoveryBins(snapshot: DiscoverySnapshot, albums: readonly Album[], membership: readonly SavedMembership[], now: number) {
  const eligible = new Set(eligibleSavedAlbums(albums, membership, now).map(membershipAlbumId));
  const current = discoveryIsCurrent(snapshot, now);
  return snapshot.bins.map(bin => ({ type: bin.type, albumIds: current ? bin.albumIds.filter(id => eligible.has(id)) : [] }));
}
