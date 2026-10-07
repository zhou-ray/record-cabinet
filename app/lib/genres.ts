import type { Album } from "../data/types";
export type ArtistGenres = { genres: string[]; checkedAt: number };
export type GenreCache = Record<string, ArtistGenres>;
export const GENRE_CACHE_AGE = 30 * 24 * 60 * 60 * 1000;
export function broadGenres(tags: readonly string[]): string[] {
  const result = new Set<string>();
  for (const raw of tags) {
    const tag = raw.toLowerCase().replace(/[-_]/g, " ").trim();
    if (!tag || tag === "uncategorized") continue;
    const rules: [RegExp, string][] = [
      [/^alternative$/, "Alternative"],
      [/\b(jazz|bebop|bop|swing)\b/, "Jazz"],
      [/\b(hip hop|rap|trap|drill|grime)\b/, "Hip-Hop"],
      [/\b(soul|r&b|rnb|funk|motown|gospel)\b/, "Soul & R&B"],
      [/\b(electronic|electronica|house|techno|trance|ambient|edm|dubstep|disco|synthpop|synth pop|trip hop|downtempo|drum and bass|jungle|idm)\b/, "Electronic"],
      [/\b(classical|orchestra|orchestral|opera|symphony)\b/, "Classical"],
      [/\b(country|folk|americana|bluegrass|singer songwriter)\b/, "Folk & Country"],
      [/\b(rock|metal|punk|grunge|shoegaze|post hardcore|emo|britpop)\b/, "Rock"],
      [/\b(blues)\b/, "Blues"],
      [/\b(reggae|dancehall|ska|dub)\b/, "Reggae"],
      [/\b(latin|salsa|bossa nova|samba|reggaeton|bachata|cumbia|flamenco)\b/, "Latin"],
      [/\b(afrobeat|afrobeats|highlife|world|traditional|celtic)\b/, "World"],
      [/\b(pop|k pop|j pop)\b/, "Pop"],
      [/\b(soundtrack|score|musical)\b/, "Soundtracks"],
    ];
    if (/\b(baroque|chamber)\b/.test(tag) && !/\b(pop|rock)\b/.test(tag)) result.add("Classical");
    const matches = rules.filter(([pattern]) => pattern.test(tag));
    if (matches.length) for (const [, label] of matches) result.add(label);
    else if (!/\b(baroque|chamber)\b/.test(tag)) result.add(raw.trim().replace(/\b\w/g, char => char.toUpperCase()));
  }
  return [...result];
}
export function applyArtistGenres(album: Album, cache: GenreCache): Album {
  if (album.source !== "spotify" || album.genres.length || album.genresEdited) return album;
  const genres = broadGenres(album.artists.flatMap(artist => cache[artist.id]?.genres ?? []));
  return genres.length ? { ...album, genres, genre: genres.join(" / ") } : album;
}
export function missingGenreArtists(albums: Album[], cache: GenreCache, now = Date.now()): string[] {
  return [...new Set(albums.filter(album => album.source === "spotify" && !album.genres.length && !album.genresEdited).flatMap(album => album.artists.map(artist => artist.id)))].filter(id => /^spotify:[a-zA-Z0-9]{1,64}$/.test(id) && (!cache[id] || now - cache[id].checkedAt >= GENRE_CACHE_AGE));
}
export function createGenreResolver(request: <T>(url: string, signal?: AbortSignal) => Promise<T>, cache: GenreCache, now = Date.now) {
  return async (id: string, signal?: AbortSignal): Promise<ArtistGenres> => {
    if (!/^spotify:[a-zA-Z0-9]{1,64}$/.test(id)) throw new Error("Invalid artist ID");
    if (cache[id] && now() - cache[id].checkedAt < GENRE_CACHE_AGE) return cache[id];
    const artist = await request<{ genres?: unknown }>(`https://api.spotify.com/v1/artists/${id.slice(8)}`, signal);
    const genres = Array.isArray(artist.genres) ? artist.genres.filter((tag): tag is string => typeof tag === "string" && tag.length <= 200) : [];
    const entry = { genres, checkedAt: now() };
    cache[id] = entry; return entry;
  };
}
