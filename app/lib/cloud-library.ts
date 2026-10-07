import type { Album } from "../data/types";
import { parseBackup, type Organization } from "./collection-backup";
import { needsAlbumDetails } from "./spotify-export";
export type CloudLibrary = { albums: Album[]; organization: Organization };
export type CloudState = { revision: number; enabled: boolean; library: CloudLibrary };
export const emptyCloudLibrary = (): CloudLibrary => ({ albums: [], organization: { systems: [], systemId: "", arrangement: "artist" } });
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function parseCloudLibrary(value: unknown): CloudLibrary {
  if (!value || typeof value !== "object") throw new Error("Invalid library.");
  const data = value as CloudLibrary;
  const parsed = parseBackup({ format: "record-cabinet", version: 1, albums: data.albums, organization: data.organization });
  return { ...parsed, albums: parsed.albums.filter(album => album.source !== "mock") };
}
function mergeMap<T>(local: Record<string, T>, base: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const result = { ...remote };
  for (const id of new Set([...Object.keys(local), ...Object.keys(base)])) {
    if (same(local[id], base[id])) continue;
    if (local[id] === undefined) delete result[id]; else result[id] = local[id];
  }
  return result;
}
const keyed = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(item => [item.id, item]));
/** Only local changes since the last acknowledged snapshot override the cloud. */
export function mergeCloudLibrary(local: CloudLibrary, base: CloudLibrary, remote: CloudLibrary): CloudLibrary {
  // Albums are additive; a missing device copy must never erase cloud records.
  const albums = { ...keyed(remote.albums) };
  const previous = keyed(base.albums);
  for (const album of local.albums) {
    const cloud = albums[album.id], prior = previous[album.id];
    if (cloud && needsAlbumDetails(album) && !needsAlbumDetails(cloud)) {
      // A fresh file import must not discard details already fetched on another device.
      albums[album.id] = { ...cloud,
        ...(album.note !== (prior?.note ?? "") ? { note: album.note } : {}),
        ...(album.genresEdited && (!prior || !same([album.genres, album.genre], [prior.genres, prior.genre]))
          ? { genres: album.genres, genre: album.genre, genresEdited: true } : {}),
      };
    } else if (!cloud || !prior) albums[album.id] = album;
    else {
      // Independent edits (a phone note and desktop genre) can coexist.
      const merged = { ...cloud };
      for (const key of Object.keys(album) as (keyof Album)[]) {
        if (!same(album[key], prior[key])) Object.assign(merged, { [key]: album[key] });
      }
      albums[album.id] = merged;
    }
    // Manual choices win over automatic classification, including first-device sync.
    const manual = cloud?.genresEdited && !album.genresEdited ? cloud : album.genresEdited && !cloud?.genresEdited ? album : null;
    if (manual) albums[album.id] = { ...albums[album.id], genres: manual.genres, genre: manual.genre, genresEdited: true };
  }
  const localSystems = keyed(local.organization.systems), baseSystems = keyed(base.organization.systems), remoteSystems = keyed(remote.organization.systems);
  const systems = mergeMap(localSystems, baseSystems, remoteSystems);
  for (const [id, system] of Object.entries(systems)) {
    const l = localSystems[id], b = baseSystems[id], r = remoteSystems[id];
    if (!l || !b || !r) continue;
    const bins = same(l.bins, b.bins) ? r.bins : l.bins;
    systems[id] = { ...system, name: same(l.name, b.name) ? r.name : l.name, bins, assignments: Object.fromEntries(Object.entries(mergeMap(l.assignments, b.assignments, r.assignments)).filter(([, bin]) => bins.some(item => item.id === bin))) };
  }
  const organization = {
    systems: Object.values(systems),
    systemId: same(local.organization.systemId, base.organization.systemId) ? remote.organization.systemId : local.organization.systemId,
    genreBinCount: same(local.organization.genreBinCount, base.organization.genreBinCount) ? remote.organization.genreBinCount : local.organization.genreBinCount,
    arrangement: same(local.organization.arrangement, base.organization.arrangement) ? remote.organization.arrangement : local.organization.arrangement,
  };
  if (!systems[organization.systemId]) organization.systemId = organization.systems[0]?.id ?? "";
  return { albums: Object.values(albums).filter(album => album.source !== "mock"), organization };
}
