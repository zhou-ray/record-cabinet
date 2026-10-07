"use client";
import SpotifyAlbumSearch from "./spotify-album-search";
import { useAccount } from "./account-context";
import { useEffect, useRef, useState } from "react";
import type { Album } from "./data/types";
import { createManualAlbum, matchingAlbum } from "./lib/manual-album";
import { spotifyLibraryId } from "./lib/spotify-export";
import { spotifyAlbumId } from "./lib/spotify-album-link";

export default function ManualAlbum({ albums, disabled, onAdded }: { albums: Album[]; disabled: boolean; onAdded: (album: Album) => void }) {
  const { storage: libraryStorage, apiFetch } = useAccount();
  const [mode, setMode] = useState<"spotify" | "manual">("spotify");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  async function addSpotify(input: string) {
      if (submitting.current || disabled) return;
      submitting.current = true; setBusy(true); setError(""); setStatus("Looking up the album…");
      const abort = new AbortController(); controller.current = abort;
      let timer: ReturnType<typeof setTimeout>;
      const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(new Error("Spotify stopped responding. Try again when it is available.")), 45000); };
      heartbeat();
      try {
        const id = `spotify:${spotifyAlbumId(input)}`;
        const saved = await libraryStorage.load();
        if ([...saved.albums, ...albums].some(album => spotifyLibraryId(album) === id)) throw new Error("That Spotify album is already in your collection. No lookup was needed.");
        const response = await apiFetch("/api/spotify/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ albumLink: input }), signal: abort.signal });
        if (!response.ok) throw new Error((await response.json()).error || "Spotify could not load this album.");
        if (!response.body) throw new Error("The album connection could not open.");
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = "", album: Album | null = null, complete = false;
        try {
          while (true) {
            const chunk = await reader.read(); heartbeat(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === "artist-genres") {
                await libraryStorage.saveGenres({ [event.artistId]: { genres: event.genres, checkedAt: event.checkedAt } });
                window.dispatchEvent(new Event("record-cabinet-genres"));
              }
              if (event.type === "error") throw new Error(event.message);
              if (event.type === "waiting") setStatus(`Spotify needs a pause until ${new Date(event.retryAt).toLocaleString()}. You can cancel and try later.`);
              if (event.type === "requesting") setStatus("Loading album and track details…");
              if (event.album) album = event.album;
              if (event.type === "complete") complete = true;
            }
            if (chunk.done) break;
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        if (!complete || !album || album.id !== id || album.playback.kind !== "spotify") throw new Error("The album did not finish loading. Try again.");
        album = await libraryStorage.prepareAlbumGenres({ ...album, addedAt: Date.now() }); await libraryStorage.saveAlbum(album); onAdded(album); setOpen(false); setMessage(`Added ${album.title} from Spotify. Put the record on to listen.`); button.current?.focus();
      } catch (error) { setError(abort.signal.aborted ? "Album lookup stopped. Your collection is unchanged." : error instanceof Error ? error.message : "Could not add this album."); }
      finally { clearTimeout(timer!); submitting.current = false; setBusy(false); setStatus(""); controller.current = null; }

  }
  return <section className="manual-album collection-tools" aria-label="Add an album">
    <button ref={button} disabled={disabled || busy} aria-expanded={open} aria-controls="manual-album-form" onClick={() => { setOpen(!open); setError(""); setMessage(""); }}>{open ? "Close album form" : "Add album"}</button>
    {open && <div className="collection-actions" role="group" aria-label="Album source"><button disabled={busy} aria-pressed={mode === "spotify"} onClick={() => { setMode("spotify"); setError(""); }}>From Spotify</button><button disabled={busy} aria-pressed={mode === "manual"} onClick={() => { setMode("manual"); setError(""); }}>Catalog only · no audio</button></div>}
    {open && mode === "spotify" && <div><SpotifyAlbumSearch albums={albums} disabled={disabled || busy} onChoose={id => { void addSpotify("spotify:album:" + id); }} /><details><summary>Or paste a Spotify album link</summary><form id="manual-album-form" onSubmit={event => { event.preventDefault(); void addSpotify(String(new FormData(event.currentTarget).get("albumLink") ?? "")); }}><h2>Add an album from Spotify</h2><p>In Spotify, choose Share → Copy album link. We’ll load its cover and complete tracklist so it can play on the turntable.</p><label>Spotify album link<input name="albumLink" required placeholder="https://open.spotify.com/album/…" disabled={busy} /></label><p>Requires a Spotify connection and available quota. Adding an album doesn’t start playback.</p><div className="collection-actions"><button disabled={busy || disabled} type="submit">{busy ? "Loading album…" : "Add from Spotify"}</button><button type="button" onClick={() => { if (busy) controller.current?.abort(); else setOpen(false); }}>Cancel</button><a href="/api/spotify/login">Connect Spotify</a></div></form></details>{busy && <p role="status">{status || "Loading album…"}</p>}{error && <p role="alert">{error}</p>}{busy && <button type="button" onClick={() => controller.current?.abort()}>Cancel album lookup</button>}</div>}
    {open && mode === "manual" && <form id="manual-album-form" onSubmit={async event => {
      event.preventDefault(); if (submitting.current || disabled) return;
      const form = event.currentTarget, data = new FormData(form);
      const value = (key: string) => String(data.get(key) ?? "");
      setError(""); submitting.current = true; setBusy(true);
      try {
        const album = createManualAlbum({ title: value("title"), artist: value("artist"), year: value("year"), genre: value("genre"), tracks: value("tracks"), note: value("note"), color: "moss" }, crypto.randomUUID());
        const saved = await libraryStorage.load();
        if (matchingAlbum([...saved.albums, ...albums], album.title, album.artist)) throw new Error("That album and artist are already in your collection. Include the edition in the title if this is a different release.");
        const tagged = await libraryStorage.prepareAlbumGenres({ ...album, addedAt: Date.now() });
        await libraryStorage.saveAlbum(tagged);
        onAdded(tagged); setOpen(false); setMessage(`Added ${album.title}. Find it on your shelf, then use Move bin to file it.`); button.current?.focus();
      } catch (error) { setError(error instanceof Error ? error.message : "The album could not be saved. Your entries are still here; try again."); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <h2>Add a record to your collection</h2><p>Enter the details yourself. No Spotify requests needed. This adds a record for browsing and filing, without audio.</p>
      <fieldset disabled={disabled || busy}>
        <label>Album title<input name="title" required maxLength={200} autoFocus /></label>
        <label>Artist<input name="artist" required maxLength={200} /></label>
        <label>Year (optional)<input name="year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="1977" /></label>
        <label>Genre (optional)<input name="genre" maxLength={100} /></label>
        <label>Tracklist (optional)<textarea name="tracks" maxLength={10000} rows={5} placeholder="One track title per line" /></label>
        <label>Notes (optional)<textarea name="note" maxLength={5000} rows={3} /></label>
        <div className="collection-actions"><button type="submit">{busy ? "Saving album…" : "Save album"}</button><button type="button" onClick={() => { setOpen(false); setError(""); button.current?.focus(); }}>Cancel</button></div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
