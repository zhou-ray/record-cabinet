import "server-only";
import { createHash } from "node:crypto";
import { command } from "./cloud-store";
import { GenreCooldown } from "./musicbrainz";
import { genreName, genreTitle, type GenreLookup } from "./auto-genres";
import { broadGenres } from "./genres";
import { GENRES } from "./manual-genres";
const CLAIM = "if redis.call('EXISTS',KEYS[1])==1 then return redis.call('PTTL',KEYS[1]) end redis.call('SET',KEYS[1],'1','PX',3100) return 0";

export function matchAppleGenres(data: unknown, title: string, artists: string[]): string[] {
  if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) throw new Error("Incomplete album response.");
  const matchName = (name: string) => genreName(name.replace(/&/g, " and "));
  const names = new Set([...artists, artists.join(" & ")].map(matchName));
  names.delete(""); names.delete("unknown artist");
  const candidates = data.results.filter(item => item && item.wrapperType === "collection" && item.collectionType === "Album" && typeof item.collectionName === "string" && typeof item.artistName === "string" && matchName(genreTitle(item.collectionName)) === matchName(genreTitle(title)) && names.has(matchName(item.artistName)));
  const exact = candidates.filter(item => matchName(item.collectionName) === matchName(title));
  const matches = exact.length ? exact : candidates;
  const genres = matches.map(item => typeof item.primaryGenreName === "string" ? broadGenres([item.primaryGenreName === "Dance" ? "Electronic" : item.primaryGenreName === "Singer/Songwriter" ? "Folk & Country" : item.primaryGenreName]).filter(genre => GENRES.includes(genre)) : []);
  // Multiple editions are fine only if their genre labels agree.
  return genres.length && genres[0].length && genres.every(value => JSON.stringify(value) === JSON.stringify(genres[0])) ? genres[0].slice(0, 2) : [];
}

async function searchApple(query: string, signal: AbortSignal, refreshAfter?: number): Promise<unknown> {
  signal.throwIfAborted();
  const key = "record-cabinet:apple-genres:v2:" + createHash("sha256").update(query).digest("hex");
  const cached = await command(["GET", key]);
  if (cached) {
    const entry = JSON.parse(cached);
    if (!refreshAfter || entry.fetchedAt >= refreshAfter) return entry.data ?? entry;
  }
    const delay = Number(await command(["EVAL", CLAIM, 1, "record-cabinet:apple-genres:pace"]));
    if (delay > 0) throw new GenreCooldown(Math.ceil(delay / 1000), "Apple catalog");
    signal.throwIfAborted();
    const response = await fetch("https://itunes.apple.com/search?" + query, { signal, cache: "no-store", headers: { Accept: "application/json" } });
    if (response.status === 429 || response.status === 503) {
      await command(["SET", "record-cabinet:apple-genres:pace", "1", "PX", 60000]);
      throw new GenreCooldown(60, "Apple catalog");
    }
    if (!response.ok) throw new Error("Album catalog is unavailable.");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("results" in data) || !Array.isArray(data.results)) throw new Error("Incomplete album response.");
    await command(["SET", key, JSON.stringify({ data, fetchedAt: Date.now() }), "EX", 86400]);
    return data;
}

export async function findAppleGenres(title: string, artists: string[], signal: AbortSignal, refreshAfter?: number, depth: "quick" | "deep" | "full" = "full"): Promise<GenreLookup> {
  const name = genreTitle(title);
  const searches = [
    { term: `${name} ${artists[0] ?? ""}`, country: "US", limit: "25" },
    { term: name, country: "US", limit: "50" },
    { term: `${name} ${artists[0] ?? ""}`, country: "GB", limit: "25" },
  ];
  for (const search of depth === "quick" ? searches.slice(0, 1) : depth === "deep" ? searches.slice(1) : searches) {
    const query = new URLSearchParams({ ...search, entity: "album", media: "music" }).toString().replace(/\+/g, "%20");
    const data = await searchApple(query, signal, refreshAfter);
    const genres = matchAppleGenres(data, title, artists);
    if (genres.length) return { genres, source: "apple", checkedAt: Date.now() };
  }
  return { genres: [], source: "none", checkedAt: Date.now() };
}
