import { checkPlaylistPage, PlaylistIdentityError } from "../lib/playlist-preview";
import { broadGenres } from "../lib/genres";
import type { Album, LibraryProvider, Track } from "./types";

export type SpotifyPage<T> = { href?: string; items: T[]; next: string | null; total?: number };
export type SpotifyTrack = {
  id: string | null; name: string; duration_ms: number; disc_number: number; track_number: number;
  is_playable?: boolean; is_local?: boolean; restrictions?: { reason?: string }; linked_from?: { id?: string };
};
export type SpotifyAlbum = {
  id: string; name: string; uri: string; release_date?: string;
  genres?: string[];
  artists: { id: string; name: string; genres?: string[] }[];
  images?: { url: string; width?: number | null; height?: number | null }[];
  external_urls?: { spotify?: string };
  tracks: SpotifyPage<SpotifyTrack>;
};

export class ImportDataError extends Error {
  constructor(public code: "INVALID_PAGE" | "INVALID_ALBUM" | "INVALID_PAGINATION" | "EMPTY_ALBUM", public paginationIssue?: "malformed-link" | "wrong-source" | "missing-or-duplicate-offset" | "invalid-number") {
    super(code === "INVALID_PAGINATION" ? "Invalid Spotify pagination link" : `Spotify import data: ${code}`);
  }
}
function validPage<T>(page: SpotifyPage<T> | undefined): page is SpotifyPage<T> {
  return !!page && Array.isArray(page.items) && (page.next == null || typeof page.next === "string");
}
function requirePage<T>(page: SpotifyPage<T> | undefined): SpotifyPage<T> {
  if (!validPage(page)) throw new ImportDataError("INVALID_PAGE");
  return page;
}

export function normalizeSpotifyAlbum(album: SpotifyAlbum, tracks = album?.tracks?.items): Album {
  if (!album || typeof album.id !== "string" || typeof album.name !== "string" || !Array.isArray(album.artists) || album.artists.some(artist => !artist || typeof artist.name !== "string") || !Array.isArray(tracks) || tracks.some(track => !track || typeof track.name !== "string" || !Number.isFinite(track.duration_ms) || !Number.isFinite(track.disc_number) || !Number.isFinite(track.track_number))) throw new ImportDataError("INVALID_ALBUM");
  const genres = broadGenres(album.genres?.length ? album.genres : album.artists.flatMap(artist => artist.genres ?? []));
  const artists = album.artists.map(artist => ({ id: `spotify:${artist.id}`, name: artist.name }));
  const normalizedTracks: Track[] = tracks.map(track => ({
    id: track.id ? `spotify:${track.id}` : `spotify:${album.id}:${track.disc_number}:${track.track_number}`,
    title: track.name,
    duration: Math.max(0, track.duration_ms / 1000),
    disc: track.disc_number,
    number: track.track_number,
    ...(!track.id || track.is_local || track.is_playable === false || (track.is_playable !== true && track.restrictions?.reason) ? { playable: false } : track.is_playable === true ? { playable: true } : {}),
    ...(track.linked_from?.id ? { linkedFrom: `spotify:${track.linked_from.id}` } : {}),
  })).sort((a, b) => a.disc - b.disc || a.number - b.number);
  return {
    id: `spotify:${album.id}`, source: "spotify", title: album.name,
    artist: artists.map(artist => artist.name).join(", ") || "Unknown artist",
    artists, year: album.release_date?.slice(0, 4) || "Unknown year",
    genres, genre: genres.join(" / ") || "Uncategorized", color: "moss", note: "",
    catalogNumber: "", artworkUrl: album.images?.[0]?.url ?? null,
    externalUrl: album.external_urls?.spotify ?? null,
    availabilityCheckedAt: Date.now(), tracks: normalizedTracks, playback: { kind: "spotify", uri: album.uri },
  };
}

/** Inject an authenticated server-side request function; no tokens enter the album model. */
export type ImportProgress = { phase: "discovering" | "loading"; loaded: number; total: number | null; skipped?: number; completedSnapshot?: string; unchanged?: boolean; album?: Album; checkpoint?: ImportCheckpoint | null };
export type ImportSource = "saved" | "liked" | `playlist:${string}`;
export function sourceUrl(source: ImportSource): string {
  if (source === "saved") return "https://api.spotify.com/v1/me/albums?limit=50";
  if (source === "liked") return "https://api.spotify.com/v1/me/tracks?limit=50";
  if (!/^playlist:[a-zA-Z0-9]+$/.test(source)) throw new Error("Invalid import source");
  return `https://api.spotify.com/v1/playlists/${source.slice(9)}/items?limit=50`;
}
export type ImportCheckpoint = { source: ImportSource; pageUrl: string; index: number; snapshotId?: string };
export function parseImportCheckpoint(value: unknown, source: ImportSource): ImportCheckpoint | null {
  if (value == null) return null;
  try {
    const item = value as ImportCheckpoint;
    const url = new URL(item.pageUrl);
    const base = new URL(sourceUrl(source));
    // Older playlist checkpoints/next links used /tracks. Keep the same
    // playlist and offset while normalizing to the current /items endpoint.
    if (source.startsWith("playlist:") && url.pathname === base.pathname.replace(/\/items$/, "/tracks")) url.pathname = base.pathname;
    if (item.source !== source || url.origin !== base.origin || url.pathname !== base.pathname || url.username || url.password || url.hash || !Number.isInteger(item.index) || item.index < 0 || item.index > 50) throw new ImportDataError("INVALID_PAGINATION");
    const keys = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (keys.has(key)) throw new ImportDataError("INVALID_PAGINATION");
      keys.add(key);
      const valid = ["limit", "offset"].includes(key) ? /^\d+$/.test(value) && Number(value) <= 1000000
        : key === "market" ? /^(?:[A-Z]{2}|from_token)$/.test(value)
        : key === "additional_types" && source.startsWith("playlist:") ? /^(?:track|episode)(?:,(?:track|episode))*$/.test(value)
        : false;
      if (!valid) throw new ImportDataError("INVALID_PAGINATION");
    }
    return { source, pageUrl: url.href, index: item.index, ...(typeof item.snapshotId === "string" && item.snapshotId.length <= 512 ? { snapshotId: item.snapshotId } : {}) };
  } catch { throw new ImportDataError("INVALID_PAGINATION"); }
}
/** Spotify next links may include endpoint-specific defaults. Never forward
 * those query strings: rebuild a request for this source using only pagination. */
export function nextImportCheckpoint(link: string, source: ImportSource): ImportCheckpoint {
  try {
    const url = new URL(link);
    const base = new URL(sourceUrl(source));
    if (source.startsWith("playlist:") && url.pathname === base.pathname.replace(/\/items$/, "/tracks")) url.pathname = base.pathname;
    if (url.origin !== base.origin || url.pathname !== base.pathname || url.username || url.password || url.hash) throw new ImportDataError("INVALID_PAGINATION", "wrong-source");
    const clean = new URL(base.origin + base.pathname);
    for (const key of ["offset", "limit"]) {
      const values = url.searchParams.getAll(key);
      if (key === "limit" && !values.length) continue;
      if (values.length !== 1) throw new ImportDataError("INVALID_PAGINATION", "missing-or-duplicate-offset");
      if (!/^\d+$/.test(values[0])) throw new ImportDataError("INVALID_PAGINATION", "invalid-number");
      const number = Number(values[0]);
      if (!Number.isSafeInteger(number) || number > 1000000 || (key === "limit" && (number < 1 || number > 50))) throw new ImportDataError("INVALID_PAGINATION", "invalid-number");
      clean.searchParams.set(key, String(number));
    }
    return { source, pageUrl: clean.href, index: 0 };
  } catch (error) {
    if (error instanceof ImportDataError) throw error;
    throw new ImportDataError("INVALID_PAGINATION", "malformed-link");
  }
}
export function createSpotifyLibrary(request: <T>(url: string, signal?: AbortSignal) => Promise<T>, onProgress?: (progress: ImportProgress) => void, source: ImportSource = "saved", knownAlbumIds: readonly string[] = [], options: { summaryOnly?: boolean; checkPlaylist?: boolean; completedSnapshot?: string; confirmedSnapshot?: string; checkpoint?: ImportCheckpoint | null; batchSize?: number; maxPages?: number; enrich?: (album: Album, signal?: AbortSignal) => Promise<Album> } = {}): LibraryProvider {
  async function collect<T>(first: SpotifyPage<T>, signal?: AbortSignal): Promise<T[]> {
    const items = [...requirePage(first).items];
    const visited = new Set<string>();
    let next = first.next;
    while (next) {
      const url = new URL(next);
      if (url.origin !== "https://api.spotify.com" || !url.pathname.startsWith("/v1/") || visited.has(next)) throw new ImportDataError("INVALID_PAGINATION");
      visited.add(next);
      const page: SpotifyPage<T> = await request(next, signal);
      items.push(...requirePage(page).items);
      next = page.next;
    }
    return items;
  }
  return {
    async getAlbums(signal) {
      type Entry = null | { album?: SpotifyAlbum | null; is_local?: boolean; track?: { id?: string; type?: string; is_local?: boolean; album?: SpotifyAlbum } | null; item?: { id?: string; type?: string; is_local?: boolean; album?: SpotifyAlbum } | null };
      const known = new Set(knownAlbumIds);
      const seen = new Set<string>();
      const albums: Album[] = [];
      const visited = new Set<string>();
      let skipped = 0;
      let total: number | null = null;
      let cursor: ImportCheckpoint | null = parseImportCheckpoint(options.checkpoint, source) ?? { source, pageUrl: sourceUrl(source), index: 0 };
      let snapshotId: string | undefined;
      const readSnapshot = async () => {
        const value = await request<{ snapshot_id?: string }>(`https://api.spotify.com/v1/playlists/${source.slice(9)}?fields=snapshot_id`, signal);
        if (typeof value.snapshot_id !== "string" || !value.snapshot_id || value.snapshot_id.length > 512) throw new ImportDataError("INVALID_PAGE");
        return value.snapshot_id;
      };
      if (options.checkPlaylist && source.startsWith("playlist:")) {
        snapshotId = await readSnapshot();
        if (options.confirmedSnapshot && options.confirmedSnapshot !== snapshotId) throw new PlaylistIdentityError("The playlist changed after preview. Preview it again before importing.");
        if (!options.checkpoint && options.completedSnapshot === snapshotId) {
          onProgress?.({ phase: "loading", loaded: 0, skipped: 0, total: 0, checkpoint: null, unchanged: true });
          return [];
        }
        // Offsets from a different playlist version cannot safely be resumed.
        if (options.checkpoint && options.checkpoint.snapshotId !== snapshotId) cursor = { source, pageUrl: sourceUrl(source), index: 0 };
      }
      let pages = 0;
      const emit = (album?: Album) => onProgress?.({ phase: "loading", loaded: albums.length, total, skipped, ...(album ? { album } : {}), checkpoint: cursor && snapshotId ? { ...cursor, snapshotId } : cursor });
      onProgress?.({ phase: "discovering", loaded: 0, total, skipped, checkpoint: cursor && snapshotId ? { ...cursor, snapshotId } : cursor });
      while (cursor) {
        signal?.throwIfAborted();
        const pageUrl: string = cursor.pageUrl;
        if (visited.has(pageUrl)) throw new ImportDataError("INVALID_PAGINATION");
        visited.add(pageUrl);
        const page: SpotifyPage<Entry> = await request(pageUrl, signal);
        requirePage(page);
        if (source.startsWith("playlist:")) checkPlaylistPage(page, source.slice(9));
        pages++;
        if (source === "saved") total = page.total ?? (page.next ? null : page.items.length);
        for (let index = cursor.index; index < page.items.length; index++) {
          signal?.throwIfAborted();
          const entry = page.items[index];
          const track = entry?.item ?? entry?.track;
          const id = source === "saved" ? entry?.album?.id : track?.album?.id;
          let album: Album | undefined;
          if (id && !(source !== "saved" && (entry?.is_local || track?.is_local || (track?.type && track.type !== "track"))) && !seen.has(id)) {
            seen.add(id);
            if (known.has(`spotify:${id}`)) skipped++;
            else {
              const summary = source === "saved" ? entry?.album : track?.album;
              if (options.summaryOnly && summary) {
                // Reuse complete embedded tracks, but never fetch track pages
                // while filling the shelves. Empty tracks trigger on-demand loading.
                const complete = validPage(summary.tracks) && !summary.tracks.next && summary.tracks.items.length > 0 && (summary.tracks.total == null || summary.tracks.total === summary.tracks.items.length);
                album = normalizeSpotifyAlbum({ ...summary, uri: `spotify:album:${id}` }, complete ? summary.tracks.items : []);
                if (!complete) delete album.availabilityCheckedAt;
              } else if (source === "saved" && validPage(entry?.album?.tracks)) {
                const full = entry!.album!;
                album = normalizeSpotifyAlbum(full, await collect(full.tracks, signal));
              } else {
                // Some saved entries contain only album summaries. Fetch details
                // only for new albums whose embedded track page is missing.
                album = await loadSpotifyAlbum(request, id, signal);
              }
              album.importOrigin = { source, addedAt: Date.now(), ...(track?.id && /^[a-zA-Z0-9]{1,64}$/.test(track.id) ? { trackId: track.id } : {}) };
              albums.push(album);
            }
          }
          // Advance only alongside the fully loaded album. The browser commits
          // both atomically, so a failed disk write never skips a missing record.
          // Save the last album before validating the next page link. If that
          // link is incompatible, retry must not download this album again.
          cursor = index + 1 < page.items.length || page.next ? { source, pageUrl, index: index + 1 } : null;
          emit(album);
          if (index + 1 === page.items.length && page.next) {
            cursor = nextImportCheckpoint(page.next, source);
            emit();
          }
          if (album && options.enrich) {
            const enriched = await options.enrich(album, signal);
            if (enriched !== album) { albums[albums.length - 1] = enriched; emit(enriched); }
          }
          if (!options.summaryOnly && albums.length >= (options.batchSize ?? Infinity)) return albums;
        }
        cursor = page.next ? nextImportCheckpoint(page.next, source) : null;
        if (!cursor) total = albums.length + skipped;
        emit();
        if (cursor && (pages >= (options.maxPages ?? Infinity) || albums.length >= (options.batchSize ?? Infinity))) return albums;
      }
      // Only certify a complete, stable scan; an edit during import must be rescanned.
      if (snapshotId && await readSnapshot() === snapshotId) onProgress?.({ phase: "loading", loaded: albums.length, skipped, total, checkpoint: null, completedSnapshot: snapshotId });
      return albums;
    },
  };
}

/** Fetch metadata once, including every track page needed by the album needle. */
export async function loadSpotifyAlbum(request: <T>(url: string, signal?: AbortSignal) => Promise<T>, id: string, signal?: AbortSignal): Promise<Album> {
  if (!/^[a-zA-Z0-9]{1,64}$/.test(id)) throw new Error("Invalid album ID");
  const album = await request<SpotifyAlbum>(`https://api.spotify.com/v1/albums/${id}`, signal);
  if (!album || album.id !== id) throw new ImportDataError("INVALID_ALBUM");
  const tracks = [...requirePage(album.tracks).items];
  let next = album.tracks.next;
  const visited = new Set<string>();
  while (next) {
    const url = new URL(next);
    if (url.origin !== "https://api.spotify.com" || url.pathname !== `/v1/albums/${id}/tracks` || visited.has(next)) throw new ImportDataError("INVALID_PAGINATION");
    visited.add(next);
    const page: SpotifyPage<SpotifyTrack> = await request(next, signal);
    tracks.push(...requirePage(page).items); next = page.next;
  }
  if (!tracks.length) throw new ImportDataError("EMPTY_ALBUM");
  return normalizeSpotifyAlbum(album, tracks);
}
