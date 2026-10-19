import type { Album } from "../data/types";
import type { EngagementEvent } from "./engagement";
import { assignDiscoverySnapshot } from "./discovery-snapshot";
import { eligibleSavedAlbums, membershipAlbumId, type SavedMembership } from "./saved-membership";

export const DISCOVERY_COPY = {
  forgotten: { label: "Forgotten Favorites", blurb: "Records you used to reach for more often.", empty: "Keep listening and a few old favorites may find their way back here." },
  wander: { label: "Wander", blurb: "A loose path through the shelves.", empty: "A path will appear as saved albums are checked." },
  digging: { label: "Digging", blurb: "A few records that haven't had much time on the turntable.", empty: "No unexplored records in this set. Try Wander." },
};
/** Framework baseline only: shuffle, unplayed records, and repeat completions absent for 30 days.
 * No weighted scores, genre/artist balancing, or personal-bin inference (later milestones).
 */
export function generateDiscovery(input: {
  id: string; accountId: string; now: number; albums: readonly Album[]; membership: readonly SavedMembership[];
  events: readonly EngagementEvent[]; random?: () => number;
}) {
  const ids = eligibleSavedAlbums(input.albums, input.membership, input.now).map(a => membershipAlbumId(a)!);
  const random = input.random ?? Math.random;
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.max(0, Math.min(.999999999, random())) * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const history = new Map<string, { plays: number; completions: Set<string>; last: number }>();
  for (const event of input.events) {
    if (event.userId !== input.accountId || !Number.isFinite(event.timestamp) || event.timestamp > input.now) continue;
    const row = history.get(event.albumId) ?? { plays: 0, completions: new Set<string>(), last: 0 };
    row.last = Math.max(row.last, event.timestamp);
    if (event.type === "album_play_started") row.plays++;
    if (event.type === "album_completed") row.completions.add(event.sessionId);
    history.set(event.albumId, row);
  }
  const forgotten = ids.filter(id => { const h = history.get(id); return h && h.completions.size >= 2 && input.now - h.last >= 30 * 86400000; });
  const favorites = new Set(forgotten);
  const remaining = ids.filter(id => !favorites.has(id));
  return assignDiscoverySnapshot({ ...input, candidates: {
    forgotten, wander: remaining,
    digging: remaining.filter(id => { const h = history.get(id); return !h || (!h.plays && !h.completions.size); }),
  } });
}
