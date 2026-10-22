import type { Album } from "../data/types";
import type { CustomSystem } from "../catalog";
import { checkedSession, type EngagementEvent, type PlaybackSession } from "./engagement";
import { membershipAlbumId } from "./saved-membership";

const DAY = 86400000;
/** Deliberately small, bounded signals. Configuration belongs to code, not the music UI. */
export const DISCOVERY_WEIGHTS = {
  inspection: 0.5, play: 2, listening: 3, completion: 4, personalBin: 3,
  recentPenalty: 4, halfLifeDays: 14, forgottenDays: 30, minimumCompletions: 2,
} as const;
export type DiscoveryWeights = { [K in keyof typeof DISCOVERY_WEIGHTS]: number };
export type DiscoveryScore = {
  albumId: string; inspections: number; plays: number; completions: number; listening: number;
  personalBin: boolean; lastInteraction: number; behavior: number; recency: number;
  forgottenEligible: boolean; forgotten: number; wander: number; digging: number;
};
/** Inspectable, deterministic contributions; no persistence, requests, or synthetic history. */
export function scoreDiscovery(input: {
  accountId: string; now: number; albums: readonly Album[]; events: readonly EngagementEvent[];
  sessions?: readonly PlaybackSession[]; systems?: readonly CustomSystem[]; weights?: Partial<DiscoveryWeights>;
}): DiscoveryScore[] {
  const w = { ...DISCOVERY_WEIGHTS, ...input.weights };
  if (Object.values(w).some(value => !Number.isFinite(value) || value < 0) || w.halfLifeDays <= 0 || w.forgottenDays <= 0 || w.minimumCompletions < 1 || !Number.isInteger(w.minimumCompletions)) throw new Error("Invalid discovery scoring weights.");
  const rows = new Map<string, { inspections: Set<string>; plays: Set<string>; completions: Set<string>; listening: number; last: number; filed: boolean }>();
  const canonical = new Map<string, string>();
  for (const album of input.albums) {
    const id = membershipAlbumId(album);
    if (id) { canonical.set(album.id, id); if (!rows.has(id)) rows.set(id, { inspections: new Set(), plays: new Set(), completions: new Set(), listening: 0, last: 0, filed: false }); }
  }
  for (const system of input.systems ?? []) {
    const bins = new Set(system.bins.map(bin => bin.id));
    for (const [id, bin] of Object.entries(system.assignments)) {
      const row = rows.get(canonical.get(id) ?? id);
      if (row && bins.has(bin)) row.filed = true; // One signal regardless of repeated filing/systems; labels imply nothing.
    }
  }
  const seen = new Set<string>();
  for (const event of input.events) {
    const row = rows.get(event.albumId);
    if (!row || event.userId !== input.accountId || !Number.isFinite(event.timestamp) || event.timestamp <= 0 || event.timestamp > input.now || seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.type === "album_inspected") row.inspections.add(event.id);
    else if (event.type === "album_play_started") row.plays.add(event.sessionId);
    else if (event.type === "album_completed") row.completions.add(event.sessionId);
    row.last = Math.max(row.last, event.timestamp);
  }
  // A session may arrive as several checkpoints: use its newest valid revision once.
  const sessions = new Map<string, PlaybackSession>();
  for (const candidate of input.sessions ?? []) {
    try {
      const session = checkedSession(candidate, input.accountId);
      if (session.startedAt <= 0 || session.updatedAt > input.now || !rows.has(session.albumId)) continue;
      const old = sessions.get(session.id);
      if (!old || session.revision > old.revision) sessions.set(session.id, session);
    } catch { /* Ignore corrupt or foreign observations. */ }
  }
  for (const session of sessions.values()) {
    const row = rows.get(session.albumId)!;
    // Verified listening time, not seek distance; cap repeated sections within a session.
    row.listening += Math.min(1, session.listenedSeconds / session.albumDurationSeconds);
    row.plays.add(session.id);
    if (session.completedAt !== null) row.completions.add(session.id);
    row.last = Math.max(row.last, session.updatedAt);
  }
  return [...rows].map(([albumId, row]) => {
    const inspections = row.inspections.size, plays = row.plays.size, completions = row.completions.size;
    const listening = Math.min(5, row.listening);
    const behavior = w.inspection * Math.log2(1 + Math.min(inspections, 20)) + w.play * Math.log2(1 + Math.min(plays, 10))
      + w.completion * Math.log2(1 + Math.min(completions, 5)) + w.listening * listening;
    const age = row.last ? Math.max(0, (input.now - row.last) / DAY) : Infinity;
    const recency = row.last ? Math.pow(0.5, age / w.halfLifeDays) : 0;
    const organization = row.filed ? w.personalBin : 0;
    return { albumId, inspections, plays, completions, listening, personalBin: row.filed, lastInteraction: row.last, behavior, recency,
      forgottenEligible: completions >= w.minimumCompletions && age >= w.forgottenDays,
      forgotten: (behavior + organization) * (1 - recency),
      wander: Math.log2(1 + behavior) + organization - w.recentPenalty * recency,
      digging: 1 / (1 + behavior) - recency };
  });
}
