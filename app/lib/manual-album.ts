import type { Album } from "../data/types";
export type ManualAlbumInput = { title: string; artist: string; year: string; genre: string; tracks: string; note: string; color: string };
export function createManualAlbum(input: ManualAlbumInput, id: string): Album {
  const title = input.title.trim(), artist = input.artist.trim();
  if (!title || !artist) throw new Error("Enter an album title and artist.");
  if (title.length > 200 || artist.length > 200 || input.note.length > 5000 || input.genre.length > 100 || input.tracks.length > 10000) throw new Error("Some album details are too long.");
  if (input.year.trim() && !/^\d{4}$/.test(input.year.trim())) throw new Error("Enter a four-digit year, or leave it blank.");
  const tracks = input.tracks.split(/\r?\n/).map(title => title.trim()).filter(Boolean);
  if (tracks.length > 200) throw new Error("Enter up to 200 tracks.");
  return {
    id: `manual:${id}`, source: "manual", title, artist, artists: [{ id: `manual:artist:${artist.toLocaleLowerCase()}`, name: artist }],
    year: input.year.trim() || "Unknown year", genre: input.genre.trim() || "Uncategorized", genres: input.genre.trim() ? [input.genre.trim()] : [],
    color: ["moss", "clay", "blue", "ochre"].includes(input.color) ? input.color : "moss", note: input.note.trim(), catalogNumber: "",
    artworkUrl: null, externalUrl: null, playback: { kind: "none" },
    tracks: tracks.map((title, index) => ({ id: `manual:${id}:track:${index + 1}`, title, duration: 0, disc: 1, number: index + 1 })),
  };
}
export function matchingAlbum(albums: Album[], title: string, artist: string): Album | undefined {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return albums.find(album => normalize(album.title) === normalize(title) && normalize(album.artist) === normalize(artist));
}
