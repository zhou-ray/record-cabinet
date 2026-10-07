import type { Album } from "../data/types";
import type { createLibraryStorage } from "./library-storage";
import { genreArtist, genreLookupKey, LOOKUP_AGE, needsAutoGenres, type GenreLookup } from "./auto-genres";

type Storage = Pick<ReturnType<typeof createLibraryStorage>, "load" | "loadAutoGenres" | "applyAutoGenres">;
type Query = { title: string; artist: string; artists: string[]; mode: "apple" | "album"; depth?: "quick" | "deep" | "full"; refreshAfter?: number };
export type GenreRecordResult = { id: string; title: string; artist: string; before: string[]; after: string[]; status: "changed" | "unchanged" | "unmatched" | "protected" | "failed" | "manual" };
export async function organizeGenres(options: {
  storage: Storage; signal: AbortSignal; retryUnmatched: boolean; recheckAutomatic?: boolean; albumIds?: readonly string[];
  request: (query: Query) => Promise<GenreLookup>;
  onCache: (cache: Record<string, GenreLookup>) => void;
  onUpdate: (album: Album) => void;
  onStatus: (message: string) => void;
  onResult?: (result: GenreRecordResult) => void;
}) {
  const { storage, signal } = options;
  const saved = await storage.load(), lookups = await storage.loadAutoGenres();
  const selected = options.albumIds ? new Set(options.albumIds) : null;
  const records = saved.albums.filter(album => !selected || selected.has(album.id)).filter(album => options.recheckAutomatic ? album.source !== "mock" && !album.genresEdited && album.genres.length > 0 : needsAutoGenres(album));
  let working: Album | undefined, tagged = 0;
  const refreshAfter = options.recheckAutomatic || options.retryUnmatched ? Date.now() : undefined;
  const requests = new Map<string, GenreLookup>();
  const totals = { changed: 0, unchanged: 0, unmatched: 0, protected: 0, failed: 0, manual: saved.albums.filter(album => album.source !== "mock" && album.genresEdited).length };
  function report(record: Album, before: string[], after: string[], status: GenreRecordResult["status"]) {
    totals[status]++;
    options.onResult?.({ id: record.id, title: record.title, artist: record.artist, before, after, status });
  }
  if (options.recheckAutomatic) for (const record of saved.albums.filter(album => album.source !== "mock" && album.genresEdited)) options.onResult?.({ id: record.id, title: record.title, artist: record.artist, before: record.genres, after: record.genres, status: "manual" });
  const fresh = (lookup?: GenreLookup) => !!lookup && Date.now() - lookup.checkedAt < LOOKUP_AGE;
  async function save(record: Album, result: GenreLookup) {
    signal.throwIfAborted();
    const key = genreLookupKey(record);
    const before = [...record.genres];
    const updated = await storage.applyAutoGenres(record.id, key, result, undefined, options.recheckAutomatic ? record.genres : undefined);
    lookups[key] = result; options.onCache({ ...lookups });
    if (updated) {
      const changed = JSON.stringify([...before].sort()) !== JSON.stringify([...updated.genres].sort());
      report(record, before, updated.genres, changed ? "changed" : "unchanged");
      if (changed) { tagged++; options.onUpdate(updated); }
    } else if (result.failed) report(record, before, before, "failed");
    else if (result.genres.length) report(record, before, before, "protected");
    else if (options.recheckAutomatic || result.phase === "complete") report(record, before, before, "unmatched");
  }
  const request = async (record: Album, mode: Query["mode"], depth?: Query["depth"]) => {
    signal.throwIfAborted();
    const key = mode + ":" + (depth ?? "full") + ":" + genreLookupKey(record);
    if (requests.has(key)) return requests.get(key)!;
    const result = await options.request({ title: record.title, artist: genreArtist(record), artists: (record.artists.length ? record.artists.map(artist => artist.name) : [record.artist]).filter(name => name.trim()).slice(0, 10), mode, ...(depth ? { depth } : {}), ...(mode === "apple" && refreshAfter ? { refreshAfter } : {}) });
    requests.set(key, result);
    return result;
  };
  try {
    const deeper: Album[] = [];
    options.onStatus(options.recheckAutomatic ? "Rechecking automatic labels" : "Quick pass · finding easy album matches");
    for (const record of records) {
      signal.throwIfAborted(); working = record;
      const previous = lookups[genreLookupKey(record)];
      if (!options.recheckAutomatic && !options.retryUnmatched && fresh(previous) && previous.source === "apple" && previous.genres.length) {
        await save(record, { ...previous, strategy: 3, phase: "complete", failed: false }); continue;
      }
      if (!options.recheckAutomatic && fresh(previous) && previous.strategy === 3 && !previous.failed && previous.phase === "complete") {
        if (previous.genres.length) { await save(record, previous); continue; }
        if (!options.retryUnmatched) continue;
      }
      // An interrupted deep pass resumes without repeating successful quick checks.
      if (!options.recheckAutomatic && fresh(previous) && previous.strategy === 3 && ["quick", "apple"].includes(previous.phase ?? "")) {
        deeper.push(record); continue;
      }
      const result = await request(record, "apple", options.recheckAutomatic ? "full" : "quick");
      await save(record, { ...result, strategy: 3, phase: result.genres.length || options.recheckAutomatic ? "complete" : "quick", failed: false });
      if (!result.genres.length && !options.recheckAutomatic) deeper.push(record);
    }
    if (deeper.length) options.onStatus(`Deep pass · checking ${deeper.length} remaining albums`);
    for (const record of deeper) {
      signal.throwIfAborted(); working = record;
      const previous = lookups[genreLookupKey(record)];
      // Another edition may already have been resolved earlier in this pass.
      if (fresh(previous) && previous.phase === "complete" && previous.genres.length) { await save(record, previous); continue; }
      if (previous?.phase !== "apple" && previous?.phase !== "complete") {
        const result = await request(record, "apple", "deep");
        await save(record, { ...result, strategy: 3, phase: result.genres.length ? "complete" : "apple", failed: false });
        if (result.genres.length) continue;
      }
      const result = await request(record, "album");
      await save(record, { ...result, strategy: 3, phase: "complete", failed: false });
    }
    return { tagged, ...totals };
  } catch (error) {
    if (!signal.aborted && working) {
      const previous = lookups[genreLookupKey(working)];
      await save(working, { genres: [], source: "none", checkedAt: Date.now(), strategy: 3, phase: previous?.strategy === 3 ? previous.phase : undefined, failed: true });
    }
    throw error;
  }
}
