"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAccount } from "./account-context";
import type { Album } from "./data/types";
import GenreEditor from "./genre-editor";
import { genreLookupKey, genreProgress, needsAutoGenres, type GenreLookup } from "./lib/auto-genres";
import { organizeGenres, type GenreRecordResult } from "./lib/genre-organizer";
import { requestGenreLookup } from "./lib/genre-request";

export default function AutoGenres({ albums, disabled, editingDisabled = disabled, connected, onUpdate, onActivity, importing = false }: { importing?: boolean; editingDisabled?: boolean; albums: Album[]; disabled: boolean; connected: boolean; onUpdate: (albums: Album[]) => void; onActivity?: (message: string) => void }) {
  const { storage, apiFetch, accountId } = useAccount();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(true);
  const blocked = useRef(false);
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const [cache, setCache] = useState<Record<string, GenreLookup>>({});
  const [review, setReview] = useState(false);
  const [reviewFilter, setReviewFilter] = useState("missing");
  const [reviewQuery, setReviewQuery] = useState("");
  const [reviewPage, setReviewPage] = useState(0);
  const [results, setResults] = useState<GenreRecordResult[]>([]);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(onUpdate);
  useEffect(() => { latest.current = onUpdate; }, [onUpdate]);
  useEffect(() => {
    let active = true;
    void Promise.all([storage.loadAutoGenres(), storage.loadGenreImportQueue()]).then(([value, queue]) => { if (active) { setCache(value); setAutomatic(!queue.paused); setReady(true); } }).catch(() => { if (active) setMessage("Genre progress could not be read. Reload to try again."); });
    const stop = () => controller.current?.abort();
    window.addEventListener("record-cabinet-removing-local", stop);
    return () => { active = false; stop(); window.removeEventListener("record-cabinet-removing-local", stop); };
  }, [storage]);
  useEffect(() => { onActivity?.(busy ? message : ""); }, [busy, message, onActivity]);
  const missing = albums.filter(needsAutoGenres);
  const progress = genreProgress(albums, cache, now);
  async function organize(retryUnmatched = false, recheckAutomatic = false, albumIds?: readonly string[]) {
    if (controller.current || disabled) return;
    blocked.current = false;
    const abort = new AbortController(); controller.current = abort; setBusy(true);
    setResults([]); setNow(Date.now()); setMessage("Reading saved genre progress…");
    let tagged = 0, pass = recheckAutomatic ? "Rechecking" : "Quick pass";
    try {
      const queued = await storage.loadGenreImportQueue();
      const summary = await organizeGenres({ storage, signal: abort.signal, retryUnmatched, recheckAutomatic, albumIds,
        request: query => requestGenreLookup(apiFetch, query, abort.signal, status => setMessage(`${pass} · ${status} · ${tagged} organized. Progress is saved.`)),
        onCache: setCache,
        onResult: result => setResults(current => [...current, result]),
        onUpdate: album => { tagged++; latest.current([album]); },
        onStatus: status => { pass = status.startsWith("Deep") ? "Deep pass" : recheckAutomatic ? "Rechecking" : "Quick pass"; setMessage(`${status} · ${tagged} organized.`); },
      });
      if (!recheckAutomatic) await storage.finishGenreImports(albumIds ?? queued.ids);
      setMessage(`Finished: ${summary.changed} ${summary.changed === 1 ? "record updated" : "records updated"}.${summary.unmatched ? ` ${summary.unmatched} without a reliable match${recheckAutomatic ? "; previous labels kept" : "; left uncategorized"}.` : ""} Your manual choices were kept.`);
    } catch (error) {
      if (!abort.signal.aborted) blocked.current = true;
      setMessage(abort.signal.aborted ? `Stopped. ${tagged} records organized; progress is saved. Use Find missing genres to continue.` : `${error instanceof Error ? error.message : "Genre lookup paused."} ${tagged} records organized; progress is saved.`);
    } finally { controller.current = null; setBusy(false); window.dispatchEvent(new CustomEvent("record-cabinet-genre-work", { detail: { scope: accountId } })); }
  }
  const startAutomatic = useEffectEvent(async () => {
    if (!ready || !connected || disabled || controller.current || blocked.current) return;
    const currentGeneration = generation.current;
    try {
      const queue = await storage.loadGenreImportQueue();
      if (generation.current !== currentGeneration || controller.current || blocked.current || disabled) return;
      setAutomatic(!queue.paused);
      if (!queue.paused && queue.ids.length) await organize(false, false, queue.ids);
    } catch { blocked.current = true; setMessage("Automatic genre progress could not be read. Your imported records are saved."); }
  });
  useEffect(() => {
    const effectGeneration = generation.current;
    if (disabled) controller.current?.abort();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (event?: Event) => {
      if (event && (event as CustomEvent).detail?.scope !== accountId) return;
      clearTimeout(timer); timer = setTimeout(() => { void startAutomatic(); }, 200);
    };
    schedule();
    window.addEventListener("record-cabinet-local-change", schedule);
    window.addEventListener("record-cabinet-genre-work", schedule);
    return () => { generation.current = effectGeneration + 1; clearTimeout(timer); window.removeEventListener("record-cabinet-local-change", schedule); window.removeEventListener("record-cabinet-genre-work", schedule); };
  }, [ready, connected, disabled, storage, accountId]);
  async function setAutomaticSorting(enabled: boolean) {
    setAutomatic(enabled); blocked.current = !enabled;
    if (!enabled) controller.current?.abort();
    try { await storage.pauseGenreImports(!enabled); }
    catch { blocked.current = true; setMessage("Could not save your automatic sorting preference. Sorting is paused for this visit."); }
  }
  const reviewAlbums = albums.filter(album => album.source !== "mock" && (reviewFilter === "all" || (reviewFilter === "missing" ? !album.genres.length : reviewFilter === "manual" ? album.genresEdited : !album.genresEdited && album.genres.length > 0)) && `${album.title} ${album.artist}`.toLowerCase().includes(reviewQuery.toLowerCase()));
  const page = Math.min(reviewPage, Math.max(0, Math.ceil(reviewAlbums.length / 20) - 1));
  const records = albums.filter(album => album.source !== "mock");
  const categorized = records.filter(album => album.genres.length > 0).length;
  return <section id="genres" className="collection-tools" aria-label="Genres">
    <h2>Genres</h2>
    <p>New records get genres automatically after each import. You can keep browsing while we organize them. Your manual choices are always kept.</p>
    <label><input type="checkbox" checked={automatic} disabled={!ready || disabled} onChange={event => void setAutomaticSorting(event.target.checked)} /> Automatically sort genres after importing</label>
    <p>{categorized} of {records.length} records have genres.{missing.length > 0 && ` ${missing.length} still need a match.`}</p>
    {importing && <p>{automatic ? "Genres will be filled in after this import finishes." : "Automatic sorting is off. You can find missing genres here after importing."}</p>}
    <div className="collection-actions">
      {busy ? <button onClick={() => void setAutomaticSorting(false)}>Pause genre sorting</button> : missing.length > 0 && <button disabled={!ready || disabled || !connected} onClick={() => void organize(true)}>Find missing genres</button>}
      <button aria-expanded={review} aria-controls="genre-review" onClick={() => setReview(!review)}>{review ? "Close review" : "Review & edit"}</button>
    </div>
    {!connected && <p><a href="/api/spotify/login">Connect Spotify</a> to organize your account’s library.</p>}
    <p role="status">{message}</p>
    {review && <div id="genre-review" className="genre-review">
      <p>Start with uncategorized records, or switch to automatic labels to correct a match. Set genre saves your choice so automatic sorting cannot overwrite it.</p>
      <label>Show genres<select aria-label="Show genres" value={reviewFilter} onChange={event => { setReviewFilter(event.target.value); setReviewPage(0); }}><option value="missing">Uncategorized</option><option value="automatic">Automatic labels</option><option value="manual">Manual choices</option><option value="all">All records</option></select></label>
      <label>Find a record<input value={reviewQuery} onChange={event => { setReviewQuery(event.target.value); setReviewPage(0); }} /></label>
      <p>{reviewAlbums.length} matching records</p>
      <ul>{reviewAlbums.slice(page * 20, page * 20 + 20).map(album => {
        const lookup = cache[genreLookupKey(album)];
        const matches = lookup && JSON.stringify([...lookup.genres].sort()) === JSON.stringify([...album.genres].sort());
        const source = album.genresEdited ? "Manual choice" : !album.genres.length ? lookup?.failed ? "Lookup interrupted" : lookup?.phase === "complete" ? "No reliable match" : lookup?.phase === "quick" || lookup?.phase === "apple" ? "Deep pass pending" : "Not checked" : matches && lookup.source === "apple" ? "Apple catalog" : matches && lookup.source === "album" ? "MusicBrainz album" : "Saved metadata";
        return <li key={album.id}><strong>{album.title}</strong> — {album.artist}<p>{album.genres.join(" / ") || "Uncategorized"} · {source}</p>
          {!album.genresEdited && <button disabled={busy || disabled || !connected} onClick={() => void organize(!album.genres.length, !!album.genres.length, [album.id])}>{album.genres.length ? "Recheck this album" : "Retry this album"}</button>}
          <GenreEditor key={album.id} albums={albums} album={album} disabled={!ready || editingDisabled} onUpdate={onUpdate} />
        </li>;
      })}</ul>
      {reviewAlbums.length > 20 && <div className="collection-actions"><button disabled={page === 0} onClick={() => setReviewPage(page - 1)}>Previous records</button><span>Page {page + 1} of {Math.ceil(reviewAlbums.length / 20)}</span><button disabled={(page + 1) * 20 >= reviewAlbums.length} onClick={() => setReviewPage(page + 1)}>Next records</button></div>}
    </div>}
    <details className="genre-advanced">
      <summary>Advanced genre options</summary>
      <p>Waiting to check: {progress.waiting} · No reliable match: {progress.unmatched} · Interrupted: {progress.failed}. Albums without a reliable match stay uncategorized.</p>
      <p>Find missing genres checks unlabeled records, including previous misses. Recheck existing labels checks records that already have automatic genres; it keeps the current label if there is no reliable replacement.</p>
      {records.some(album => !album.genresEdited && album.genres.length > 0) && <button disabled={!ready || disabled || busy || !connected} onClick={() => void organize(false, true)}>Recheck existing labels</button>}
      <p>Matches use Apple’s catalog first, then <a href="https://musicbrainz.org/" target="_blank" rel="noreferrer">MusicBrainz</a>. This uses album and artist names, with no Spotify requests. Progress is saved and genre labels sync across devices.</p>
    {results.length > 0 && <details><summary>Show album results ({results.length})</summary><ul>{results.map((result, index) => <li key={`${result.id}:${index}`}><strong>{result.title}</strong> — {result.artist}: {result.status === "changed" ? `${result.before.join(" / ") || "Uncategorized"} → ${result.after.join(" / ")}` : result.status === "unchanged" ? `Already matches: ${result.after.join(" / ")}` : result.status === "unmatched" ? `No reliable match${result.before.length ? `; kept ${result.before.join(" / ")}` : "; still uncategorized"}` : result.status === "failed" ? "Lookup failed; saved labels kept" : result.status === "manual" ? `Manual choice kept: ${result.after.join(" / ") || "Uncategorized"}` : "Changed while checking; current labels kept"}</li>)}</ul></details>}
    </details>
  </section>;
}
