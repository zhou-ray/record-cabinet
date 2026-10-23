import { checkedDiscoveryFeedback, feedbackKey, type DiscoveryFeedback } from "./discovery-feedback";
import type { Album } from "../data/types";
import type { CustomSystem } from "../catalog";
import { scoreDiscovery, type DiscoveryWeights, type DiscoveryScore } from "./discovery-scoring";
import type { PlaybackSession, EngagementEvent } from "./engagement";
import { assignDiscoverySnapshot, DISCOVERY_LIMIT } from "./discovery-snapshot";
import { eligibleSavedAlbums, membershipAlbumId, type SavedMembership } from "./saved-membership";

export const DISCOVERY_COPY = {
  forgotten: { label: "Forgotten Favorites", blurb: "Records you used to reach for more often.", empty: "Keep listening and a few old favorites may find their way back here." },
  wander: { label: "Wander", blurb: "A loose path through the shelves.", empty: "A path will appear as saved albums are checked." },
  digging: { label: "Digging", blurb: "A few records that haven't had much time on the turntable.", empty: "No unexplored records in this set. Try Wander." },
};
// Use the primary credited artist, matching alphabetical filing. Unknown credits
// share a group rather than pretending missing metadata proves diversity.
function artistKey(album: Album): string {
  const primary = album.artists?.find(artist => artist.name?.trim());
  if (primary?.id?.trim()) return `id:${primary.id.trim()}`;
  return `name:${(primary?.name || album.artist || "unknown").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`;
}

/** Stable cold-start fallback plus opt-in interpretable behavioral ranking. */
export function generateDiscovery(input: {
  id: string; accountId: string; now: number; albums: readonly Album[]; membership: readonly SavedMembership[];
  feedback?: readonly DiscoveryFeedback[]; events: readonly EngagementEvent[]; random?: () => number; behavioral?: boolean;
  sessions?: readonly PlaybackSession[]; systems?: readonly CustomSystem[]; weights?: Partial<DiscoveryWeights>;
  inspect?: (scores: readonly DiscoveryScore[]) => void;
}) {
  const excluded = new Set<string>();
  for (const value of input.feedback ?? []) {
    try { const row = checkedDiscoveryFeedback(value, input.accountId); if (row.action !== "file" && row.timestamp <= input.now) excluded.add(feedbackKey(row)); } catch { /* Ignore invalid or foreign feedback. */ }
  }
  const eligible = eligibleSavedAlbums(input.albums, input.membership, input.now);
  const scores = input.behavioral ? new Map(scoreDiscovery({ ...input, albums: eligible }).map(row => [row.albumId, row])) : null;
  if (scores) input.inspect?.([...scores.values()]);
  const ids = eligible.map(a => membershipAlbumId(a)!);
  const artists = new Map(eligible.map(a => [membershipAlbumId(a)!, artistKey(a)]));
  const random = input.random ?? Math.random;
  for (let i = ids.length - 1; i > 0; i--) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error("Invalid discovery random sample.");
    const j = Math.floor(sample * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const history = new Map<string, { plays: number; inspections: number; completions: Set<string>; last: number }>();
  const seen = new Set<string>();
  for (const event of input.events) {
    if (event.userId !== input.accountId || !Number.isFinite(event.timestamp) || event.timestamp <= 0 || event.timestamp > input.now || seen.has(event.id)) continue;
    seen.add(event.id);
    const row = history.get(event.albumId) ?? { plays: 0, inspections: 0, completions: new Set<string>(), last: 0 };
    row.last = Math.max(row.last, event.timestamp);
    if (event.type === "album_play_started") row.plays++;
    if (event.type === "album_inspected") row.inspections++;
    if (event.type === "album_completed") row.completions.add(event.sessionId);
    history.set(event.albumId, row);
  }
  const forgotten = ids.filter(id => { if (excluded.has(`forgotten:${id}`)) return false; if (scores) return scores.get(id)!.forgottenEligible; const h = history.get(id); return h && h.completions.size >= 2 && input.now - h.last >= 30 * 86400000; }).sort((a, b) => scores ? scores.get(b)!.forgotten - scores.get(a)!.forgotten : 0).slice(0, DISCOVERY_LIMIT);
  const favorites = new Set(forgotten);
  const remaining = ids.filter(id => !favorites.has(id));
  // Rank underexploration (or cold-start tiers). Completed records do not fill
  // Digging just to reach a quota. Ties retain the randomized order.
  const diggingCandidates = remaining.filter(id => !excluded.has(`digging:${id}`) && !(scores ? scores.get(id)!.completions : history.get(id)?.completions.size)).sort((a, b) => {
    if (scores) return scores.get(b)!.digging - scores.get(a)!.digging;
    const x = history.get(a), y = history.get(b);
    return (x?.plays ?? 0) - (y?.plays ?? 0) || (x?.inspections ?? 0) - (y?.inspections ?? 0);
  });
  const reserve = Math.min(DISCOVERY_LIMIT, Math.floor(remaining.length / 2), diggingCandidates.length);
  // Reserve enough eligible records for Digging without preemptively taking
  // all of an artist's records away from Wander's diversity pass.
  const diggable = new Set(diggingCandidates);
  let unassignedDiggable = diggable.size;
  const pool = remaining.filter(id => !excluded.has(`wander:${id}`)).sort((a, b) => scores ? scores.get(b)!.wander - scores.get(a)!.wander : 0);
  const wander: string[] = [], counts = new Map<string, number>();
  const target = Math.min(DISCOVERY_LIMIT, remaining.length - reserve);
  while (pool.length && wander.length < target) {
    let best = -1;
    for (let i = 0; i < pool.length; i++) {
      if (diggable.has(pool[i]) && unassignedDiggable <= reserve) continue;
      if (best < 0 || (counts.get(artists.get(pool[i])!) ?? 0) < (counts.get(artists.get(pool[best])!) ?? 0)) best = i;
    }
    if (best < 0) break;
    const [id] = pool.splice(best, 1), artist = artists.get(id)!;
    wander.push(id); counts.set(artist, (counts.get(artist) ?? 0) + 1);
    if (diggable.has(id)) unassignedDiggable--;
  }
  const assigned = new Set(wander);
  const digging = diggingCandidates.filter(id => !assigned.has(id)).slice(0, reserve);
  return assignDiscoverySnapshot({ ...input, version: input.behavioral ? "behavioral-1" : "cold-start-1", candidates: { forgotten, wander, digging } });
}
