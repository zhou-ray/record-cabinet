"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account-context";
import type { Album } from "./data/types";
import { spotifyLibraryId } from "./lib/spotify-export";
type Result = { id: string; title: string; artist: string; artworkUrl: string | null; year: string; tracks: number };
export default function SpotifyAlbumSearch({ albums, disabled, onChoose }: { albums: Album[]; disabled: boolean; onChoose: (id: string) => void }) {
  const { apiFetch, storage } = useAccount();
  const [results, setResults] = useState<Result[]>([]);
  const [known, setKnown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Result[]>());
  useEffect(() => () => controller.current?.abort(), []);
  const saved = new Set([...known, ...albums.map(spotifyLibraryId)]);
  return <section aria-label="Search Spotify albums">
    <h2>Find an album</h2>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy || disabled) return;
      const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
      if (query.length < 2) { setError("Enter at least two characters."); return; }
      const abort = new AbortController(); controller.current = abort;
      setBusy(true); setError(""); setMessage("Searching Spotify…"); setResults([]);
      try {
        setKnown((await storage.load()).albums.map(spotifyLibraryId).filter((id): id is string => !!id));
        let found = cache.current.get(query);
        if (!found) {
          const response = await apiFetch("/api/spotify/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ search: query }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Spotify search is unavailable.");
          found = data.results as Result[];
          if (!Array.isArray(found)) throw new Error("Spotify returned incomplete search results.");
          if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(query, found);
        }
        if (abort.signal.aborted) return;
        setResults(found); setMessage(found.length ? "Choose an album below. Add the artist name to narrow your search." : "No albums found. Try another album or artist name.");
      } catch (error) { if (!abort.signal.aborted) { setError(error instanceof Error ? error.message : "Search failed. Please try again."); setMessage(""); } }
      finally { if (!abort.signal.aborted) setBusy(false); controller.current = null; }
    }}>
      <label>Album or artist<input name="query" type="search" required minLength={2} maxLength={200} placeholder="Kind of Blue Miles Davis" disabled={busy || disabled} /></label>
      <button type="submit" disabled={busy || disabled}>{busy ? "Searching…" : "Search Spotify"}</button>
    </form>
    <p>Search when you’re ready; typing doesn’t send requests.</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error} <a href="/api/spotify/login">Connect Spotify</a></p>}
    <ul className="album-search-results">{results.map(result => <li key={result.id}>
      {/* Remote Spotify covers are displayed unchanged. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {result.artworkUrl && <img src={result.artworkUrl} alt="" width={64} height={64} loading="lazy" />}
      <div><strong>{result.title}</strong><span>{result.artist}</span><small>{[result.year, result.tracks ? result.tracks + " tracks" : ""].filter(Boolean).join(" · ")}</small></div>
      <button type="button" disabled={disabled || busy || saved.has("spotify:" + result.id)} onClick={() => onChoose(result.id)} aria-label={saved.has("spotify:" + result.id) ? result.title + " is already in your collection" : "Add " + result.title}>{saved.has("spotify:" + result.id) ? "In collection" : "Add album"}</button>
    </li>)}</ul>
  </section>;
}
