import type { Album } from "../data/types";
import { broadGenres } from "./genres";
import { GENRES } from "./manual-genres";
export type GenreLookup = { genres: string[]; source: "album" | "artist" | "saved" | "apple" | "none"; checkedAt: number; phase?: "quick" | "artist" | "album" | "apple" | "complete"; strategy?: 2 | 3; failed?: boolean };
export const LOOKUP_AGE = 30 * 24 * 60 * 60 * 1000;
export const genreName = (text: string) => text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function genreTitle(text: string) {
  let title = text.trim();
  // Strip catalog edition suffixes only; live, remix and re-recorded titles
  // remain distinct. Apply repeatedly for e.g. "[Deluxe Edition] - EP".
  const edition = /^(?:(?:\d{4}|\d+(?:st|nd|rd|th)\s+anniversary)\s+)?(?:(?:super\s+)?deluxe|remaster(?:ed)?|expanded|anniversary|legacy|special|collector'?s?|bonus\s+tracks?|explicit|clean)(?:\s+(?:edition|version|release|tracks?|bonus|audio|remaster(?:ed)?|\d{4}))*$/i;
  for (;;) {
    const suffix = title.match(/\s*(?:\(([^()]*)\)|\[([^\[\]]*)\]|\s[-–—]\s(.+))$/);
    if (!suffix) break;
    const value = (suffix[1] ?? suffix[2] ?? suffix[3]).trim();
    if (!edition.test(value) && !/^(EP|Single)$/i.test(value)) break;
    const next = title.slice(0, suffix.index).trim();
    if (!next) break;
    title = next;
  }
  return title;
}

export const genreArtist = (album: Album) => album.artists.find(artist => artist.name.trim())?.name.trim() || album.artist.trim();
export const genreLookupKey = (album: Album) => JSON.stringify([genreName(genreTitle(album.title)), genreName(genreArtist(album))]);
export const needsAutoGenres = (album: Album) => album.source !== "mock" && !album.genres.length && !album.genresEdited;
type Entity = { id: string; title?: string; name?: string; score?: number | string; genres?: { name: string; count: number }[]; tags?: { name: string; count: number }[]; "artist-credit"?: { name?: string; artist?: { id: string; name: string } }[] };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function trustedGenres(entity: Entity) {
  const tags = (entity.genres ?? entity.tags ?? []).filter(tag => typeof tag.name === "string" && tag.name.length <= 100 && Number(tag.count) > 0).sort((a,b) => b.count - a.count);
  const weights = new Map<string, number>();
  for (const tag of tags) for (const genre of broadGenres([tag.name]).filter(genre => GENRES.includes(genre))) weights.set(genre, (weights.get(genre) ?? 0) + Number(tag.count));
  const ranked = [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.filter(([, weight]) => weight >= (ranked[0]?.[1] ?? 0) / 4).slice(0, 2).map(([genre]) => genre);
}
export async function findAutomaticGenres(title: string, artist: string, request: <T>(path: string) => Promise<T>, now = Date.now): Promise<GenreLookup> {
  const cleanTitle = genreName(genreTitle(title)), cleanArtist = genreName(artist);
  if (!cleanTitle || !cleanArtist || ["various artists", "unknown artist"].includes(cleanArtist)) return { genres: [], source: "none", checkedAt: now() };
  const query = (text: string) => new URLSearchParams({ query: text, fmt: "json", limit: "10" });
  const albums = await request<{ "release-groups": Entity[] }>("release-group/?" + query('releasegroup:"' + cleanTitle + '" AND artist:"' + cleanArtist + '"'));
  if (!Array.isArray(albums["release-groups"])) throw new Error("Incomplete genre response.");
  const matches = albums["release-groups"].filter(item => uuid.test(item.id) && Number(item.score) >= 90 && genreName(item.title ?? "") === cleanTitle && item["artist-credit"]?.some(credit => genreName(credit.artist?.name ?? credit.name ?? "") === cleanArtist));
  let artistId: string | undefined;
  if (matches.length === 1) {
    const details = await request<Entity>("release-group/" + matches[0].id + "?inc=genres&fmt=json");
    if (details.id !== matches[0].id) throw new Error("Incomplete genre response.");
    const genres = trustedGenres(details);
    if (genres.length) return { genres, source: "album", checkedAt: now() };
    artistId = matches[0]["artist-credit"]?.find(credit => genreName(credit.artist?.name ?? "") === cleanArtist)?.artist?.id;
  }
  if (!artistId || !uuid.test(artistId)) {
    const artists = await request<{ artists: Entity[] }>("artist/?" + query('artist:"' + cleanArtist + '"'));
    if (!Array.isArray(artists.artists)) throw new Error("Incomplete genre response.");
    const exact = artists.artists.filter(item => uuid.test(item.id) && Number(item.score) >= 90 && genreName(item.name ?? "") === cleanArtist);
    if (exact.length !== 1) return { genres: [], source: "none", checkedAt: now() };
    artistId = exact[0].id;
  }
  const details = await request<Entity>("artist/" + artistId + "?inc=genres&fmt=json");
  if (details.id !== artistId) throw new Error("Incomplete genre response.");
  const genres = trustedGenres(details);
  return { genres, source: genres.length ? "artist" : "none", checkedAt: now() };
}

// Artist-level results can classify a whole collection without album-by-album searches.
export const genreArtistKey = (album: Album) => "artist:v1:" + genreName(genreArtist(album));
export async function findArtistGenres(artist: string, request: <T>(path: string) => Promise<T>, now = Date.now): Promise<GenreLookup> {
  const name = genreName(artist);
  const empty = (): GenreLookup => ({ genres: [], source: "none", checkedAt: now() });
  if (!name || ["various artists", "unknown artist"].includes(name)) return empty();
  const query = new URLSearchParams({ query: 'artist:"' + name + '"', fmt: "json", limit: "10" });
  const response = await request<{ artists: Entity[] }>("artist/?" + query);
  if (!Array.isArray(response.artists)) throw new Error("Incomplete genre response.");
  const matches = response.artists.filter(item => uuid.test(item.id) && Number(item.score) >= 90 && genreName(item.name ?? "") === name);
  if (matches.length !== 1) return empty();
  let genres = trustedGenres(matches[0]);
  if (!genres.length) {
    const details = await request<Entity>("artist/" + matches[0].id + "?inc=genres&fmt=json");
    if (details.id !== matches[0].id) throw new Error("Incomplete genre response.");
    genres = trustedGenres(details);
  }
  return { genres, source: genres.length ? "artist" : "none", checkedAt: now() };
}

export async function findAlbumGenres(title: string, artists: string[], request: <T>(path: string) => Promise<T>): Promise<GenreLookup> {
  const cleanTitle = genreName(genreTitle(title)), names = [...new Set(artists.map(genreName).filter(name => name && name !== "unknown artist"))];
  const empty = (): GenreLookup => ({ genres: [], source: "none", checkedAt: Date.now() });
  if (!cleanTitle || !names.length) return empty();
  const query = new URLSearchParams({ query: `releasegroup:"${cleanTitle}" AND (${names.map(name => `artist:"${name}"`).join(" OR ")})`, fmt: "json", limit: "10" });
  const response = await request<{ "release-groups": Entity[] }>("release-group/?" + query);
  if (!Array.isArray(response["release-groups"])) throw new Error("Incomplete genre response.");
  const matches = response["release-groups"].filter(item => uuid.test(item.id) && Number(item.score) >= 90 && genreName(genreTitle(item.title ?? "")) === cleanTitle && item["artist-credit"]?.some(credit => names.includes(genreName(credit.artist?.name ?? credit.name ?? ""))));
  if (matches.length !== 1) return empty();
  const details = await request<Entity>(`release-group/${matches[0].id}?inc=genres&fmt=json`);
  if (details.id !== matches[0].id) throw new Error("Incomplete genre response.");
  const genres = trustedGenres(details);
  return { genres, source: genres.length ? "album" : "none", checkedAt: Date.now() };
}

// Only extrapolate an artist's genre when at least two solo albums agree.
// Artist IDs prevent two different artists with the same name sharing genres.
export function libraryArtistGenres(albums: Album[]): Map<string, string[]> {
  const groups = new Map<string, Album[]>();
  for (const album of albums) {
    if (album.source === "mock" || album.artists.length !== 1 || !album.artists[0].id || !album.genres.length || ["various artists", "unknown artist"].includes(genreName(genreArtist(album)))) continue;
    const key = album.artists[0].id;
    const group = groups.get(key) ?? [];
    if (!group.some(item => item.id === album.id)) group.push(album);
    groups.set(key, group);
  }
  return new Map([...groups].flatMap(([key, records]) => {
    if (records.length < 2) return [];
    const shared = GENRES.filter(genre => records.every(record => broadGenres(record.genres).includes(genre))).slice(0, 2);
    return shared.length ? [[key, shared] as [string, string[]]] : [];
  }));
}

export function genreProgress(albums: Album[], cache: Record<string, GenreLookup>, now = Date.now()) {
  const result = { waiting: 0, unmatched: 0, failed: 0 };
  for (const album of albums.filter(needsAutoGenres)) {
    const lookup = cache[genreLookupKey(album)];
    if (lookup?.failed) result.failed++;
    else if (lookup?.strategy === 3 && lookup.phase === "complete" && !lookup.genres.length && now - lookup.checkedAt < LOOKUP_AGE) result.unmatched++;
    else result.waiting++;
  }
  return result;
}
