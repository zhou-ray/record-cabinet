import type { Album } from "../data/types";

export const MEMBERSHIP_BATCH_SIZE = 40;
export const MEMBERSHIP_TTL_MS = 7 * 86400000;
export type SavedMembership = {
  albumId: string; saved: boolean; checkedAt: number; source: "spotify-library-contains";
};
export type MembershipBatch = { accountId: string; records: SavedMembership[] };
const account = (id: string) => /^[a-f0-9]{64}$/.test(id);
const albumId = (id: unknown): id is string => typeof id === "string" && /^spotify:[a-zA-Z0-9]{1,64}$/.test(id);

/** Provenance, liking a track, and possessing Spotify metadata are not membership. */
export function membershipAlbumId(album: Album): string | null {
  if (!["spotify", "spotify-export"].includes(album.source) || album.playback.kind !== "spotify") return null;
  const match = /^spotify:album:([a-zA-Z0-9]{1,64})$/.exec(album.playback.uri);
  return match ? `spotify:${match[1]}` : null;
}
export function membershipIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MEMBERSHIP_BATCH_SIZE || !value.every(albumId)) throw new Error("Choose one to forty Spotify albums.");
  return [...new Set(value)];
}
export function checkedMembershipBatch(value: unknown, expectedAccount: string): MembershipBatch {
  const batch = value as MembershipBatch | null;
  if (!account(expectedAccount) || !batch || batch.accountId !== expectedAccount || !Array.isArray(batch.records)
    || !batch.records.length || batch.records.length > MEMBERSHIP_BATCH_SIZE) throw new Error("Invalid membership account or batch.");
  const seen = new Set<string>();
  const records = batch.records.map(row => {
    if (!row || !albumId(row.albumId) || seen.has(row.albumId) || typeof row.saved !== "boolean"
      || row.source !== "spotify-library-contains" || !Number.isSafeInteger(row.checkedAt) || row.checkedAt <= 0) throw new Error("Invalid membership record.");
    seen.add(row.albumId);
    return { albumId: row.albumId, saved: row.saved, checkedAt: row.checkedAt, source: row.source };
  });
  return { accountId: expectedAccount, records };
}
/** A successful boolean response updates only explicitly requested albums. */
export async function checkSavedMembership(
  ids: readonly string[], accountId: string,
  request: (url: string, signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal, now = Date.now,
): Promise<MembershipBatch> {
  const unique = membershipIds(ids);
  if (!account(accountId)) throw new Error("An authenticated account is required.");
  const checkedAt = now(); // Request start, so a slow old response cannot overwrite a newer check.
  const uris = unique.map(id => id.replace("spotify:", "spotify:album:"));
  const result = await request(`https://api.spotify.com/v1/me/library/contains?${new URLSearchParams({ uris: uris.join(",") })}`, signal);
  signal?.throwIfAborted();
  if (!Array.isArray(result) || result.length !== unique.length || result.some(saved => typeof saved !== "boolean")) throw new Error("Spotify returned an invalid membership response.");
  return checkedMembershipBatch({ accountId, records: unique.map((albumId, i) => ({ albumId, saved: result[i], checkedAt, source: "spotify-library-contains" })) }, accountId);
}
export function membershipStatus(id: string, records: readonly SavedMembership[], now: number): "saved" | "not-saved" | "unknown" {
  const row = records.find(row => row.albumId === id);
  if (!Number.isSafeInteger(now) || !row || row.source !== "spotify-library-contains" || typeof row.saved !== "boolean"
    || !Number.isSafeInteger(row.checkedAt) || row.checkedAt <= 0 || now < row.checkedAt || now - row.checkedAt >= MEMBERSHIP_TTL_MS) return "unknown";
  return row.saved ? "saved" : "not-saved";
}
/** Preserve order while excluding duplicates, removed, stale and unverified albums. */
export function eligibleSavedAlbums(albums: readonly Album[], records: readonly SavedMembership[], now: number): Album[] {
  const seen = new Set<string>();
  return albums.filter(album => {
    const id = membershipAlbumId(album);
    if (!id || seen.has(id) || membershipStatus(id, records, now) !== "saved") return false;
    seen.add(id); return true;
  });
}
export function nextMembershipBatch(albums: readonly Album[], records: readonly SavedMembership[], now: number): string[] {
  return [...new Set(albums.map(membershipAlbumId).filter((id): id is string => !!id))]
    .filter(id => membershipStatus(id, records, now) === "unknown").slice(0, MEMBERSHIP_BATCH_SIZE);
}
export function mergeMembership(current: readonly SavedMembership[], incoming: readonly SavedMembership[]): SavedMembership[] {
  const merged = new Map(current.map(row => [row.albumId, row]));
  for (const row of incoming) {
    const previous = merged.get(row.albumId);
    // On equal timestamps, fail closed if either observation says not saved.
    if (!previous || row.checkedAt > previous.checkedAt || (row.checkedAt === previous.checkedAt && !row.saved)) merged.set(row.albumId, row);
  }
  return [...merged.values()];
}
/** Corrupt local eligibility must fail closed, not make the library unusable. */
export function readMembershipCache(value: unknown, accountId: string): SavedMembership[] {
  if (!Array.isArray(value) || value.length > 100000 || !account(accountId)) return [];
  try {
    const rows: SavedMembership[] = [];
    for (let offset = 0; offset < value.length; offset += MEMBERSHIP_BATCH_SIZE) {
      rows.push(...checkedMembershipBatch({ accountId, records: value.slice(offset, offset + MEMBERSHIP_BATCH_SIZE) }, accountId).records);
    }
    return new Set(rows.map(row => row.albumId)).size === rows.length ? rows : [];
  } catch { return []; }
}
