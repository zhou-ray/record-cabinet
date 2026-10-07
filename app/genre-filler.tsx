"use client";
import { useAccount } from "./account-context";
import { useEffect, useRef, useState } from "react";
import type { Album } from "./data/types";
import { applyArtistGenres, missingGenreArtists, type GenreCache } from "./lib/genres";

export default function GenreFiller({ albums, disabled, onUpdate }: { albums: Album[]; disabled: boolean; onUpdate: (albums: Album[]) => void }) {
  const { storage: libraryStorage, apiFetch } = useAccount();
  const [cache, setCache] = useState<GenreCache>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => { void libraryStorage.loadGenres().then(value => { if (active) { setCache(value); setReady(true); } }).catch(() => { if (active) setMessage("Genre cache could not be opened. Your albums are unchanged."); }); };
    load(); window.addEventListener("record-cabinet-genres", load);
    return () => { active = false; controller.current?.abort(); window.removeEventListener("record-cabinet-genres", load); };
  }, [libraryStorage]);
  useEffect(() => {
    if (!ready) return;
    const updates = albums.map(album => applyArtistGenres(album, cache)).filter((album, index) => album !== albums[index]);
    if (!updates.length) return;
    let active = true;
    void libraryStorage.restoreAlbums(updates).then(() => { if (active) onUpdate(updates); }).catch(() => { if (active) setMessage("Genres could not be saved. Your albums are unchanged."); });
    return () => { active = false; };
  }, [albums, cache, ready, onUpdate, libraryStorage]);
  const missing = albums.filter(album => album.source === "spotify" && !album.genres.length).length;
  const pending = missingGenreArtists(albums, cache);
  if (!albums.some(album => album.source === "spotify")) return null;
  return <section className="collection-tools" aria-label="Automatic genres"><h2>Genre shelves</h2><p>{missing ? `${missing} records need genres. Use artist tags to give them a broad home.` : "Your records have genre labels."} Artist-based genres are approximate.</p>
    <button disabled={disabled || busy || !ready || !pending.length} onClick={async () => {
      if (controller.current) return;
      const abort = new AbortController(); controller.current = abort; setBusy(true); setMessage("Checking artist genres…");
      let checked = 0, tagged = 0;
      let timer: ReturnType<typeof setTimeout>;
      const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), 45000); };
      heartbeat();
      try {
        const response = await apiFetch("/api/spotify/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ genreArtists: pending.slice(0, 10) }), signal: abort.signal });
        if (!response.ok) throw new Error((await response.json()).error || "Genres could not be loaded.");
        if (!response.body) throw new Error("Genre lookup could not connect.");
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", complete = false;
        try {
          while (true) {
            const chunk = await reader.read(); heartbeat(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === "error") throw new Error(event.message);
              if (event.type === "complete") complete = true;
              if (event.type === "artist-genres") {
                const entry = { [event.artistId]: { genres: event.genres, checkedAt: event.checkedAt } };
                await libraryStorage.saveGenres(entry); setCache(current => ({ ...current, ...entry }));
                checked++; if (event.genres.length) tagged++;
                setMessage(`Checked ${checked} artists. Saving matching genre labels…`);
              }
            }
            if (chunk.done) break;
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        if (!complete) throw new Error("Genre lookup was interrupted. Completed lookups were saved; try again for the rest.");
        setMessage(`Checked ${checked} artists; ${tagged} had genre tags. Labels are applied to all matching records. Artists without tags stay uncategorized and won’t be checked again for 30 days.`);
      } catch (error) { setMessage(abort.signal.aborted ? "Genre lookup stopped. Completed lookups were kept." : error instanceof Error ? error.message : "Genre lookup failed."); }
      finally { clearTimeout(timer!); controller.current = null; setBusy(false); }
    }}>{busy ? "Finding genres…" : `Fill missing genres${pending.length ? ` (${Math.min(10, pending.length)} artists)` : ""}`}</button>
    {busy && <button onClick={() => controller.current?.abort()}>Stop genre lookup</button>}
    <p>Up to ten artists per batch. Reuses saved tags across albums; no album or song downloads.</p><p role="status">{message}</p>
  </section>;
}
