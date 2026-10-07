import { recentBin, getBins, type Arrangement, type CustomSystem } from "../catalog";
import type { Album } from "../data/types";
export type DiggingPosition = { albumId: string; binId: string; arrangement: Arrangement; systemId: string; genreBinCount: number; opened: boolean; flipped: boolean };
export function readDiggingPosition(raw: string | null): DiggingPosition | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value.albumId !== "string" || typeof value.binId !== "string" || typeof value.systemId !== "string" || !["artist", "album", "genre", "all", "custom"].includes(value.arrangement)) return null;
    return { albumId: value.albumId, binId: value.binId, systemId: value.systemId, arrangement: value.arrangement, genreBinCount: Number.isInteger(value.genreBinCount) && value.genreBinCount >= 0 && value.genreBinCount <= 6 ? value.genreBinCount : 0, opened: value.opened === true, flipped: value.flipped === true };
  } catch { return null; }
}
export function resolveDiggingPosition(saved: DiggingPosition | null, albums: Album[], systems: CustomSystem[]) {
  if (!saved || !albums.some(album => album.id === saved.albumId)) return null;
  const bins = saved.binId === "recent" ? [recentBin(albums)] : getBins(albums, saved.binId === "all" ? "all" : saved.arrangement, systems.find(system => system.id === saved.systemId), saved.genreBinCount);
  const contains = (bin: { albums: Album[] }) => bin.albums.some(album => album.id === saved.albumId);
  const bin = bins.find(bin => bin.id === saved.binId && contains(bin)) ?? bins.find(contains) ?? getBins(albums, "all")[0];
  if (!bin) return null;
  const index = bin.albums.findIndex(album => album.id === saved.albumId);
  return { bin, index, album: bin.albums[index] };
}
