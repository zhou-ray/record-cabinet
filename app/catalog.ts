import type { Album } from "./data/types";
export type Arrangement = "artist" | "album" | "genre" | "all" | "custom";
export type Bin = { id: string; label: string; albums: Album[] };

export type CustomSystem = { id: string; name: string; bins: { id: string; label: string }[]; assignments: Record<string, string> };
// File once by the first credited album artist; keep the full credits for display.
const filingArtist = (album: Album) => album.artists.find(artist => artist.name.trim())?.name.trim() || album.artist.trim() || "Unknown artist";
// Fold Latin accents/ligatures for filing without changing displayed names.
const latinAliases: Record<string, string> = { Æ: "AE", Œ: "OE", Ø: "O", Ł: "L", Đ: "D", Ð: "D", Þ: "TH", ẞ: "SS" };
const alphabetKey = (name: string) => name.trim().normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/[ÆŒØŁĐÐÞẞ]/g, letter => latinAliases[letter]).replace(/^[^\p{L}\p{N}]+/u, "").replace(/^THE\s+(?=\S)/u, "").replace(/^[^\p{L}\p{N}]+/u, "");
const artistSortKey = (album: Album) => alphabetKey(filingArtist(album));
function writingSystem(initial: string): string {
  if (/\p{Script=Latin}/u.test(initial)) return "Other Latin";
  if (/\p{Script=Cyrillic}/u.test(initial)) return "Cyrillic";
  if (/\p{Script=Greek}/u.test(initial)) return "Greek";
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(initial)) return "漢字 / かな";
  if (/\p{Script=Hangul}/u.test(initial)) return "Korean";
  if (/\p{Script=Arabic}/u.test(initial)) return "Arabic";
  if (/\p{Script=Hebrew}/u.test(initial)) return "Hebrew";
  if (/\p{Script=Devanagari}/u.test(initial)) return "Devanagari";
  if (/\p{Script=Thai}/u.test(initial)) return "Thai";
  return /\p{L}/u.test(initial) ? "Other scripts" : "#";
}
const unique = (albums: Album[]) => [...new Map(albums.map(album => [album.id, album])).values()].sort((a, b) => alphabetKey(a.title).localeCompare(alphabetKey(b.title), "en") || a.id.localeCompare(b.id, "en"));
export function getBins(collection: Album[], arrangement: Arrangement, system?: CustomSystem, genreBinCount = 0): Bin[] {
  if (arrangement === "all") return collection.length ? [{ id: "all", label: "All records", albums: unique(collection) }] : [];
  if (arrangement === "custom") {
    const bins = (system?.bins ?? []).slice(0, 5).map(bin => ({ ...bin, albums: unique(collection.filter(album => system?.assignments[album.id] === bin.id)) }));
    const assigned = new Set(bins.flatMap(bin => bin.albums.map(album => album.id)));
    const unfiled = unique(collection.filter(album => !assigned.has(album.id)));
    return [...bins, ...(unfiled.length ? [{ id: "unfiled", label: "Unfiled", albums: unfiled }] : [])];
  }
  if (arrangement === "artist" || arrangement === "album") {
    const sortKey = arrangement === "artist" ? artistSortKey : (album: Album) => alphabetKey(album.title);
    const letters = new Map<string, Map<string, Album>>();
    const additional = new Map<string, Album[]>();
    const compare = (a: Album, b: Album) => sortKey(a).localeCompare(sortKey(b), "en", { numeric: true }) || alphabetKey(a.title).localeCompare(alphabetKey(b.title), "en") || a.id.localeCompare(b.id, "en");
    for (const album of unique(collection)) {
      const initial = [...sortKey(album)][0] ?? "";
      if (!/^[A-Z]$/.test(initial)) {
        const group = writingSystem(initial);
        additional.set(group, [...(additional.get(group) ?? []), album]);
        continue;
      }
      const letter = initial;
      const records = letters.get(letter) ?? new Map<string, Album>();
      records.set(album.id, album); letters.set(letter, records);
    }
    const keys = [...letters.keys()].sort();
    const extraBins = [...additional].sort(([a], [b]) => a.localeCompare(b, "en")).map(([label, records]) => ({ id: `${arrangement}:script:${label}`, label, albums: records.sort(compare) }));
    const count = Math.min(12, keys.length);
    if (!count) return extraBins;
    // Precompute sleeve counts for each possible contiguous letter range.
    const ranges: Album[][][] = Array.from({ length: keys.length }, () => []);
    for (let start = 0; start < keys.length; start++) {
      const records = new Map<string, Album>();
      for (let end = start; end < keys.length; end++) {
        for (const [id, album] of letters.get(keys[end])!) records.set(id, album);
        ranges[start][end + 1] = [...records.values()];
      }
    }
    // Find the most even contiguous partition. Letter groups are indivisible.
    const target = [...letters.values()].reduce((sum, records) => sum + records.size, 0) / count;
    const costs = Array.from({ length: count + 1 }, () => Array(keys.length + 1).fill(Infinity));
    const cuts = Array.from({ length: count + 1 }, () => Array(keys.length + 1).fill(0));
    costs[0][0] = 0;
    for (let bins = 1; bins <= count; bins++) {
      for (let end = bins; end <= keys.length; end++) {
        for (let start = bins - 1; start < end; start++) {
          const cost = costs[bins - 1][start] + (ranges[start][end].length - target) ** 2;
          if (cost < costs[bins][end]) { costs[bins][end] = cost; cuts[bins][end] = start; }
        }
      }
    }
    const result: Bin[] = [];
    let end = keys.length;
    for (let bins = count; bins > 0; bins--) {
      const start = cuts[bins][end];
      const first = keys[start], last = keys[end - 1];
      result.unshift({ id: `${arrangement}:${first}-${last}`, label: first === last ? first : `${first}–${last}`, albums: ranges[start][end].sort(compare) });
      end = start;
    }
    return [...extraBins.filter(bin => bin.label === "#"), ...result, ...extraBins.filter(bin => bin.label !== "#")];
  }

  const groups = new Map<string, Bin>();
  for (const album of collection) {
    const labels = (album.genres.length ? album.genres : ["Uncategorized"]).map(name => ({ id: name, name }));
    for (const label of labels) {
      const id = `${arrangement}:${label.id}`;
      const bin = groups.get(id) ?? { id, label: label.name, albums: [] };
      if (!bin.albums.some(item => item.id === album.id)) bin.albums.push(album);
      groups.set(id, bin);
    }
  }
  const bins = [...groups.values()].map(bin => ({ ...bin, albums: [...bin.albums].sort((a, b) => alphabetKey(a.title).localeCompare(alphabetKey(b.title), "en") || a.id.localeCompare(b.id, "en")) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));
  if (!Number.isInteger(genreBinCount) || genreBinCount < 1 || genreBinCount > 6) return bins;
  const uncategorized = bins.filter(bin => bin.label === "Uncategorized");
  const genres = bins.filter(bin => bin.label !== "Uncategorized");
  if (genres.length <= genreBinCount) return [...genres, ...uncategorized];
  const groupsBySize: Bin[][] = Array.from({ length: genreBinCount }, () => []);
  const sizes = () => groupsBySize.map(group => unique(group.flatMap(bin => bin.albums)).length);
  // Keep a genre together, placing larger genres first in the least full bin.
  for (const bin of [...genres].sort((a, b) => b.albums.length - a.albums.length || a.label.localeCompare(b.label, "en"))) {
    const counts = sizes();
    groupsBySize[counts.indexOf(Math.min(...counts))].push(bin);
  }
  return [...groupsBySize.map(group => {
    const names = group.map(bin => bin.label).sort((a, b) => a.localeCompare(b, "en"));
    return { id: `genre:group:${JSON.stringify(names)}`, label: genreBinCount === 1 ? "All genres" : names.join(" / "), albums: unique(group.flatMap(bin => bin.albums)) };
  }).sort((a, b) => a.label.localeCompare(b.label, "en")), ...uncategorized];
}

/** The latest 50 additions; legacy records without dates follow dated records. */
export function recentBin(collection: Album[]): Bin {
  return { id: "recent", label: "Recently added", albums: unique(collection).sort((a, b) => (b.addedAt ?? b.importOrigin?.addedAt ?? 0) - (a.addedAt ?? a.importOrigin?.addedAt ?? 0)).slice(0, 50) };
}
