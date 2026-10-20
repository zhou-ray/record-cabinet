import type { Album } from "../data/types";
import type { Arrangement } from "../catalog";
export type BinDivider = { start: number; end: number; label: string };
const artist = (album: Album) => album.artists.find(item => item.name.trim())?.name.trim() || album.artist;
const artistKey = (album: Album) => album.artists.find(item => item.name.trim())?.id || artist(album).normalize("NFC").toLocaleLowerCase();

/** Keep existing record order and avoid cutting an artist's run unless it exceeds 25 records. */
export function binDividers(albums: Album[], byArtist: boolean): BinDivider[] {
  if (!albums.length) return [];
  const groups: { start: number; end: number }[] = [];
  for (let start = 0; start < albums.length;) {
    let end = start + 1;
    if (byArtist) while (end < albums.length && artistKey(albums[end]) === artistKey(albums[start])) end++;
    const parts = Math.ceil((end - start) / 25);
    const size = Math.ceil((end - start) / parts);
    for (let first = start; first < end; first += size) groups.push({ start: first, end: Math.min(end, first + size) });
    start = end;
  }
  const costs = Array(groups.length + 1).fill(Infinity), previous = Array(groups.length + 1).fill(0);
  costs[0] = 0;
  for (let end = 1; end <= groups.length; end++) {
    for (let start = end - 1; start >= 0; start--) {
      const count = groups[end - 1].end - groups[start].start;
      if (count > 25) break;
      const cost = costs[start] + (count - 20) ** 2 + 20;
      if (cost < costs[end]) { costs[end] = cost; previous[end] = start; }
    }
  }
  const sections: BinDivider[] = [];
  for (let end = groups.length; end > 0;) {
    const first = previous[end], start = groups[first].start, last = groups[end - 1].end;
    const from = byArtist ? artist(albums[start]) : albums[start].title;
    sections.unshift({ start, end: last, label: from });
    end = first;
  }
  return sections;
}
export function binPositionKey(binId: string, arrangement: Arrangement, systemId: string, genreBinCount: number) {
  return JSON.stringify((["all", "recent"].includes(binId) || binId.startsWith("discovery:")) ? [binId] : [arrangement, arrangement === "custom" ? systemId : "", arrangement === "genre" ? genreBinCount : 0, binId]);
}
export function rememberedAlbumIndex(albums: Album[], albumId: string | null | undefined) {
  return Math.max(0, albums.findIndex(album => album.id === albumId));
}

/** Compress distant sections while preserving their order in the visible stack. */
export function binStackDepth(distance: number): number {
  const ahead = Math.max(0, distance);
  return Math.min(8, ahead <= 3 ? ahead : 3 + Math.log2(1 + (ahead - 3) / 4));
}
