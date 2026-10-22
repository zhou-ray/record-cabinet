import { engagementAccount, engagementAlbum } from "./engagement";
import { DISCOVERY_TYPES, type DiscoverySnapshot, type DiscoveryType } from "./discovery-snapshot";

export type DiscoveryFeedback = {
  userId: string; albumId: string; bin: DiscoveryType; snapshotId: string;
  action: "remove" | "move"; timestamp: number;
  destination?: { systemId: string; binId: string };
};
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
export function checkedDiscoveryFeedback(value: DiscoveryFeedback, userId: string): DiscoveryFeedback {
  if (!value || !engagementAccount(userId) || value.userId !== userId || !engagementAlbum(value.albumId)
    || !DISCOVERY_TYPES.includes(value.bin) || !id(value.snapshotId)
    || !["remove", "move"].includes(value.action) || !Number.isSafeInteger(value.timestamp) || value.timestamp <= 0
    || (value.action === "move" && (!id(value.destination?.systemId) || !id(value.destination?.binId)))) throw new Error("Invalid discovery feedback.");
  return { userId, albumId: value.albumId, bin: value.bin, snapshotId: value.snapshotId, action: value.action, timestamp: value.timestamp,
    ...(value.action === "move" ? { destination: { systemId: value.destination!.systemId, binId: value.destination!.binId } } : {}) };
}
export function feedbackKey(value: Pick<DiscoveryFeedback, "albumId" | "bin">) { return `${value.bin}:${value.albumId}`; }
/** Latest decision per album/bin; retries are idempotent and storage remains bounded. */
export function mergeDiscoveryFeedback(rows: readonly DiscoveryFeedback[], value: DiscoveryFeedback, userId: string): DiscoveryFeedback[] {
  const checked = checkedDiscoveryFeedback(value, userId);
  const byKey = new Map(rows.map(row => { const valid = checkedDiscoveryFeedback(row, userId); return [feedbackKey(valid), valid]; }));
  const old = byKey.get(feedbackKey(checked));
  if (!old || checked.timestamp > old.timestamp) byKey.set(feedbackKey(checked), checked);
  else if (checked.timestamp === old.timestamp && JSON.stringify(old) !== JSON.stringify(checked)) throw new Error("Conflicting discovery feedback.");
  if (byKey.size > 10000) throw new Error("Discovery feedback storage is full. Export and reset personalization before adding more.");
  return [...byKey.values()];
}
/** Remove only the source assignment, never another bin or a personal assignment. */
export function applyDiscoveryFeedback(snapshot: DiscoverySnapshot, value: DiscoveryFeedback): DiscoverySnapshot {
  const checked = checkedDiscoveryFeedback(value, snapshot.accountId);
  if (checked.snapshotId !== snapshot.id) throw new Error("This discovery set changed. Open it again before filing.");
  return { ...snapshot, bins: snapshot.bins.map(bin => bin.type === checked.bin ? { ...bin, albumIds: bin.albumIds.filter(id => id !== checked.albumId) } : bin) };
}
