import type { Album } from "../data/types";
import type { Arrangement, CustomSystem } from "../catalog";
export const ORGANIZATION_KEY = "record-cabinet-systems";
export type Organization = { systems: CustomSystem[]; systemId: string; arrangement: Arrangement; genreBinCount?: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string" && value.length <= 10000;
const list = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 100000;
export function parseOrganization(value: unknown): Organization {
  if (!object(value) || !list(value.systems) || !string(value.systemId) || !["artist", "album", "genre", "all", "custom"].includes(String(value.arrangement))) throw new Error("Invalid bin organization.");
  const systems = value.systems.map(item => {
    if (!object(item) || !string(item.id) || !string(item.name) || !list(item.bins) || item.bins.length > 5 || !object(item.assignments)) throw new Error("Invalid bins in backup.");
    const bins = item.bins.map(bin => {
      if (!object(bin) || !string(bin.id) || !string(bin.label)) throw new Error("Invalid bin in backup.");
      return { id: bin.id, label: bin.label };
    });
    if (new Set(bins.map(bin => bin.id)).size !== bins.length) throw new Error("Duplicate bin IDs.");
    const assignments = Object.fromEntries(Object.entries(item.assignments).map(([id, bin]) => {
      if (!string(bin) || !bins.some(item => item.id === bin)) throw new Error("Invalid album assignment.");
      return [id, bin];
    }));
    return { id: item.id, name: item.name, bins, assignments };
  });
  if (new Set(systems.map(system => system.id)).size !== systems.length) throw new Error("Duplicate system IDs.");
  return { systems, systemId: systems.some(system => system.id === value.systemId) ? value.systemId : systems[0]?.id ?? "", arrangement: value.arrangement as Arrangement, ...(value.genreBinCount === undefined ? {} : { genreBinCount: Number.isInteger(value.genreBinCount) && Number(value.genreBinCount) >= 0 && Number(value.genreBinCount) <= 6 ? Number(value.genreBinCount) : 0 }) };
}
export function readOrganization(key = ORGANIZATION_KEY): Organization {
  const raw = localStorage.getItem(key);
  return raw ? parseOrganization(JSON.parse(raw)) : { systems: [], systemId: "", arrangement: "artist" };
}
export function parseBackup(value: unknown): { albums: Album[]; organization: Organization } {
  if (!object(value) || value.format !== "record-cabinet" || value.version !== 1 || !list(value.albums)) throw new Error("Choose a Record Cabinet version 1 backup.");
  const albums = value.albums.map(item => {
    if (!object(item) || !["mock", "spotify", "spotify-export", "manual"].includes(String(item.source)) || !["id", "title", "artist", "year", "genre", "color", "note", "catalogNumber"].every(key => string(item[key])) || !list(item.artists) || !list(item.genres) || !item.genres.every(string) || !list(item.tracks) || !object(item.playback)) throw new Error("Invalid album in backup.");
    const artists = item.artists.map(artist => { if (!object(artist) || !string(artist.id) || !string(artist.name)) throw new Error("Invalid artist."); return { id: artist.id, name: artist.name }; });
    const tracks = item.tracks.map(track => {
      if (!object(track) || !string(track.id) || !string(track.title) || typeof track.duration !== "number" || !Number.isFinite(track.duration) || track.duration < 0 || !Number.isInteger(track.disc) || !Number.isInteger(track.number)) throw new Error("Invalid track in backup.");
      return { id: track.id, title: track.title, duration: track.duration, disc: Number(track.disc), number: Number(track.number), ...(typeof track.playable === "boolean" ? { playable: track.playable } : {}), ...(typeof track.linkedFrom === "string" && /^spotify:(?:track:)?[a-zA-Z0-9]{1,64}$/.test(track.linkedFrom) ? { linkedFrom: track.linkedFrom } : {}) };
    });
    for (const key of ["artworkUrl", "externalUrl"]) if (item[key] !== null && (!string(item[key]) || !/^https:\/\//.test(item[key] as string))) throw new Error("Invalid album link.");
    const playback = item.playback;
    const validSpotify = playback.kind === "spotify" && /^spotify:album:[a-zA-Z0-9]{1,64}$/.test(String(playback.uri));
    const validPending = playback.kind === "spotify-pending" && /^spotify:track:[a-zA-Z0-9]{1,64}$/.test(String(playback.trackUri)) && tracks.length === 0;
    if (item.source === "manual" ? playback.kind !== "none" || !/^manual:[a-zA-Z0-9-]+$/.test(String(item.id))
      : item.source === "spotify" ? !validSpotify || item.id !== `spotify:${String(playback.uri).split(":")[2]}`
      : item.source === "spotify-export" ? !/^export:[a-f0-9]{64}$/.test(String(item.id)) || !(validSpotify || validPending)
      : playback.kind !== "local" || !/^\/audio\/[a-zA-Z0-9_-]+\.wav$/.test(String(playback.url))) throw new Error("Invalid playback source.");
    const origin = item.importOrigin;
    const importOrigin = object(origin) && typeof origin.source === "string" && /^(saved|liked|playlist:[a-zA-Z0-9]{1,64})$/.test(origin.source) && typeof origin.addedAt === "number" && Number.isFinite(origin.addedAt) && origin.addedAt > 0 ? { source: origin.source, addedAt: origin.addedAt, ...(typeof origin.trackId === "string" && /^[a-zA-Z0-9]{1,64}$/.test(origin.trackId) ? { trackId: origin.trackId } : {}) } : undefined;
    return { ...(typeof item.addedAt === "number" && Number.isFinite(item.addedAt) && item.addedAt > 0 ? { addedAt: item.addedAt } : {}), ...(importOrigin ? { importOrigin } : {}), id: item.id, source: item.source, title: item.title, artist: item.artist, year: item.year, genre: item.genre, color: item.color, note: item.note, catalogNumber: item.catalogNumber, artists, genres: item.genres, ...(typeof item.availabilityCheckedAt === "number" && Number.isFinite(item.availabilityCheckedAt) && item.availabilityCheckedAt > 0 ? { availabilityCheckedAt: item.availabilityCheckedAt } : {}), ...(item.genresEdited === true ? { genresEdited: true } : {}), tracks, artworkUrl: item.artworkUrl, externalUrl: item.externalUrl, playback: playback.kind === "spotify-pending" ? { kind: "spotify-pending", trackUri: playback.trackUri } : playback.kind === "none" ? { kind: "none" } : playback.kind === "spotify" ? { kind: "spotify", uri: playback.uri } : { kind: "local", url: playback.url, demo: true } } as Album;
  });
  return { albums: [...new Map(albums.map(album => [album.id, album])).values()], organization: parseOrganization(value.organization) };
}
export function mergeOrganization(current: Organization, incoming: Organization, newId: () => string): Organization {
  const systems = [...current.systems];
  for (const system of incoming.systems) {
    if (systems.some(existing => (existing.name === system.name || existing.name === `${system.name} (restored)`) && JSON.stringify({ ...existing, id: "", name: "" }) === JSON.stringify({ ...system, id: "", name: "" }))) continue;
    systems.push(systems.some(existing => existing.id === system.id) ? { ...system, id: newId(), name: `${system.name} (restored)` } : system);
  }
  return current.systems.length ? { ...current, systems } : { ...incoming, systems };
}
