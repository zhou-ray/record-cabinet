import type { Album } from "../data/types";
export type ExportEntry = { title: string; artist: string; uri: string };
export type ExportSection = { name: string; entries: ExportEntry[]; skipped: number };
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.length <= 1000 ? value.trim() : "";
const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
export const albumNameKey = (album: Pick<Album, "artist" | "title">) => JSON.stringify([normalized(album.artist), normalized(album.title)]);
export const spotifyLibraryId = (album: Album) => album.playback.kind === "spotify" ? album.playback.uri.replace("spotify:album:", "spotify:") : null;
export function matchingExportAlbum(albums: Album[], incoming: Album): Album | undefined {
  const canonical = spotifyLibraryId(incoming);
  return albums.find(album => album.id === incoming.id || (canonical && spotifyLibraryId(album) === canonical) || ((incoming.playback.kind === "spotify-pending" || album.playback.kind === "spotify-pending") && albumNameKey(album) === albumNameKey(incoming)));
}
export function readSpotifyExport(value: unknown): ExportSection[] {
  const data = obj(value), sections: ExportSection[] = [];
  function add(name: string, values: unknown[], kind: "album" | "track", playlist = false) {
    if (values.length > 100000) throw new Error("Choose a file with fewer than 100,000 entries.");
    const entries: ExportEntry[] = []; let skipped = 0;
    for (const raw of values) {
      const item = obj(playlist ? obj(raw).track : raw);
      const title = text(item.album ?? item.albumName), artist = text(item.artist ?? item.artistName);
      const uri = text(item.uri ?? item.trackUri);
      if (!title || !artist || !(kind === "album" ? /^spotify:album:[a-zA-Z0-9]{1,64}$/ : /^spotify:track:[a-zA-Z0-9]{1,64}$/).test(uri)) { skipped++; continue; }
      entries.push({ title, artist, uri });
    }
    sections.push({ name, entries, skipped });
  }
  if (Array.isArray(data.albums)) add("Saved albums", data.albums, "album");
  if (Array.isArray(data.tracks)) add("Liked Songs", data.tracks, "track");
  if (Array.isArray(data.playlists)) {
    if (data.playlists.length > 1000) throw new Error("Choose a file with fewer than 1,000 playlists.");
    for (const raw of data.playlists) {
      const playlist = obj(raw);
      if (Array.isArray(playlist.items)) add(text(playlist.name) || "Untitled playlist", playlist.items, "track", true);
    }
  }
  if (!sections.length) throw new Error("Choose YourLibrary.json or a Playlist JSON file from Spotify’s account-data download.");
  return sections;
}
export async function exportAlbums(entries: ExportEntry[], existing: Album[]): Promise<Album[]> {
  const result: Album[] = [];
  const ids = new Set(existing.map(album => album.id));
  const canonicalIds = new Set(existing.map(spotifyLibraryId).filter(Boolean));
  const names = new Set(existing.map(albumNameKey));
  const pendingNames = new Set(existing.filter(album => album.playback.kind === "spotify-pending").map(albumNameKey));
  // Prefer exact album IDs before resolving song-based entries by name.
  const ordered = [...entries].sort((a, b) => Number(b.uri.startsWith("spotify:album:")) - Number(a.uri.startsWith("spotify:album:")));
  for (const entry of ordered) {
    const exact = entry.uri.startsWith("spotify:album:");
    const name = albumNameKey(entry);
    const canonical = exact ? entry.uri.replace("spotify:album:", "spotify:") : null;
    if (exact ? canonicalIds.has(canonical) || pendingNames.has(name) : names.has(name)) continue;
    const hash = exact ? "" : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(albumNameKey(entry))))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const album: Album = {
      id: exact ? entry.uri.replace("spotify:album:", "spotify:") : `export:${hash}`,
      source: exact ? "spotify" : "spotify-export", title: entry.title, artist: entry.artist,
      artists: [{ id: "", name: entry.artist }], year: "Unknown year", genres: [], genre: "Uncategorized", color: "moss", note: "", catalogNumber: "", artworkUrl: null,
      externalUrl: `https://open.spotify.com/${exact ? "album" : "track"}/${entry.uri.split(":")[2]}`,
      tracks: [], playback: exact ? { kind: "spotify", uri: entry.uri } : { kind: "spotify-pending", trackUri: entry.uri },
    };
    if (ids.has(album.id)) continue;
    result.push(album);
    ids.add(album.id); names.add(name);
    if (canonical) canonicalIds.add(canonical); else pendingNames.add(name);
  }
  return result;
}
export function needsAlbumDetails(album: Album): boolean {
  return album.playback.kind === "spotify-pending" || (album.playback.kind === "spotify" && !album.tracks.length);
}
export function hydratedAlbum(original: Album, loaded: Album): Album {
  if (loaded.playback.kind !== "spotify" || !loaded.tracks.length) throw new Error("Spotify did not return a complete album.");
  if (original.playback.kind === "spotify" && original.playback.uri !== loaded.playback.uri) throw new Error("Spotify returned a different album.");
  return { ...loaded, id: original.id, source: original.source, note: original.note, ...(original.addedAt ? { addedAt: original.addedAt } : {}), ...(original.importOrigin ? { importOrigin: original.importOrigin } : {}), ...(original.genresEdited || original.genres.length ? { genres: original.genres, genre: original.genre, genresEdited: original.genresEdited } : {}) };
}

// Reuse confirmed availability for a week; legacy albums get one initial check.
export function needsAvailabilityRefresh(album: Album, now = Date.now()): boolean {
  return album.playback.kind === "spotify" && album.tracks.length > 0 && (!album.availabilityCheckedAt || now - album.availabilityCheckedAt >= 7 * 86400000);
}
