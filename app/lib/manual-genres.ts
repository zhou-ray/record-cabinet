import type { Album } from "../data/types";
export const GENRES = ["Rock", "Alternative", "Pop", "Jazz", "Hip-Hop", "Soul & R&B", "Electronic", "Classical", "Folk & Country", "Blues", "Reggae", "Latin", "World", "Soundtracks"];
export type GenreDefaults = Record<string, string[]>;
export function genreLabels(labels: string[]): string[] {
  const result: string[] = [];
  for (const raw of labels) {
    const label = raw.trim().replace(/\s+/g, " ");
    if (!label || label.toLowerCase() === "uncategorized") continue;
    if (label.length > 60) throw new Error("Keep genre names to 60 characters or fewer.");
    if (!result.some(item => item.toLowerCase() === label.toLowerCase())) result.push(label);
  }
  if (result.length > 20) throw new Error("Choose up to 20 genres.");
  return result;
}
export function genreArtists(album: Album) {
  return (album.artists.length ? album.artists : [{ id: "", name: album.artist }]).map(artist => ({ ...artist, key: artist.id || `name:${artist.name.trim().toLowerCase()}` }));
}
export function withGenres(album: Album, genres: string[]): Album {
  return { ...album, genres, genre: genres.length ? genres.join(" / ") : "Uncategorized", genresEdited: true };
}
export function applyGenreDefaults(album: Album, defaults: GenreDefaults): Album {
  if (album.genres.length || album.genresEdited) return album;
  const genres = genreLabels(genreArtists(album).flatMap(artist => defaults[artist.key] ?? []));
  return genres.length ? { ...album, genres, genre: genres.join(" / ") } : album;
}
export function editGenres(albums: Album[], ids: string[], labels: string[], mode: "add" | "replace", artistKey?: string): Album[] {
  const selected = new Set(ids), genres = genreLabels(labels);
  return albums.flatMap(album => {
    if (selected.has(album.id)) return [withGenres(album, mode === "add" ? genreLabels([...album.genres, ...genres]) : genres)];
    if (artistKey && !album.genres.length && !album.genresEdited && genreArtists(album).some(artist => artist.key === artistKey)) return [withGenres(album, genres)];
    return [];
  });
}
