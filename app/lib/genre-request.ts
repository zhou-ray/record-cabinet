import type { GenreLookup } from "./auto-genres";
import { GENRES } from "./manual-genres";
import { abortableDelay } from "./spotify-requests";

export async function requestGenreLookup(send: typeof fetch, body: { title: string; artist: string; artists?: string[]; mode: string; depth?: "quick" | "deep" | "full"; refreshAfter?: number }, signal: AbortSignal, status: (text: string) => void): Promise<GenreLookup> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const started = Date.now();
    const update = () => status(`Checking ${body.mode === "artist" ? body.artist : body.title} · ${Math.floor((Date.now() - started) / 1000)}s elapsed`);
    update();
    const ticker = setInterval(update, 1000);
    let response: Response, data;
    try {
      response = await send("/api/genres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]) });
      data = await response.json();
    } catch {
      signal.throwIfAborted();
      throw new Error("Genre lookup did not finish. Choose Auto-organize genres to retry; saved records will not be checked again.");
    } finally { clearInterval(ticker); }
    if (response.status === 429 && attempt < 3) {
      const seconds = Number(response.headers.get("Retry-After") ?? data.retryAfter);
      const until = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 60) * 1000 + 1000;
      while (Date.now() < until) {
        signal.throwIfAborted();
        status(`${data.provider === "Apple catalog" ? "Apple catalog" : "MusicBrainz"} needs a pause · resuming automatically in ${Math.ceil((until - Date.now()) / 1000)}s`);
        await abortableDelay(Math.min(1000, until - Date.now()), signal);
      }
      continue;
    }
    if (!response.ok) throw new Error(response.status === 429 ? "The genre catalog is still busy. Try again later." : data.error || "Genre lookup paused.");
    if (!Array.isArray(data.genres) || data.genres.some((genre: unknown) => typeof genre !== "string" || !GENRES.includes(genre)) || !Number.isFinite(data.checkedAt) || !["album", "artist", "saved", "apple", "none"].includes(data.source)) throw new Error("Genre lookup returned incomplete data. Try again later.");
    return data as GenreLookup;
  }
}
