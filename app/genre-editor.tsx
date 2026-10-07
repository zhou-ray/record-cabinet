"use client";
import { useAccount } from "./account-context";
import { useState } from "react";
import type { Album } from "./data/types";
import { GENRES, genreArtists, genreLabels } from "./lib/manual-genres";

import styles from "./record-bin.module.css";

export default function GenreEditor({ albums, album, disabled, onUpdate }: { albums: Album[]; album?: Album; disabled: boolean; onUpdate: (updates: Album[]) => void }) {
  const { storage: libraryStorage } = useAccount();
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<string[]>(album?.genres ?? []);
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState<string[]>(album ? [album.id] : []);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [mode, setMode] = useState<"add" | "replace">(album ? "replace" : "add");
  const [artistKey, setArtistKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const visible = albums.filter(item => (!onlyMissing || !item.genres.length) && `${item.title} ${item.artist}`.toLowerCase().includes(query.toLowerCase()));
  const choices = [...new Map([...GENRES, ...albums.flatMap(item => item.genres), ...labels].map(label => [label.toLowerCase(), label])).values()];
  function addCustom() {
    try { setLabels(genreLabels([...labels, custom])); setCustom(""); setMessage(""); }
    catch (error) { setMessage((error as Error).message); }
  }
  return <div className={styles.genreEditor}>
    <button disabled={disabled || busy} aria-expanded={open} onClick={() => { setOpen(!open); setLabels(album?.genres ?? []); setMessage(""); }}>{open ? "Close genres" : album ? "Set genre" : "Tag multiple albums"}</button>
    {open && <form aria-label={album ? `Genres for ${album.title}` : "Tag multiple albums"} className={styles.organizer} onSubmit={async event => {
      event.preventDefault();
      if (disabled || busy || !selected.length) return;
      setBusy(true); setMessage("");
      try {
        const finalLabels = genreLabels([...labels, custom]);
        if (mode === "add" && !finalLabels.length) throw new Error("Choose at least one genre to add.");
        const updates = await libraryStorage.editGenres(selected, finalLabels, mode, artistKey || undefined);
        onUpdate(updates); setLabels(finalLabels); setCustom("");
        setMessage(`Saved genres for ${updates.length} ${updates.length === 1 ? "record" : "records"}.${artistKey ? " Artist default saved for future uncategorized imports." : ""}`);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Genres could not be saved. Try again."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={disabled || busy}>
        <legend>{album ? album.title : "Choose records and genres"}</legend>
        {!album && <>
          <label>Search albums<input value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label><input type="checkbox" checked={onlyMissing} onChange={event => setOnlyMissing(event.target.checked)} /> Only uncategorized</label>
          <div className={styles.organizerRow}><button type="button" onClick={() => setSelected([...new Set([...selected, ...visible.map(item => item.id)])])}>Select shown</button><button type="button" onClick={() => setSelected([])}>Clear selection</button><span>{selected.length} selected</span></div>
          <div className={styles.genreAlbumList}>{visible.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />{item.title} · {item.artist}</label>)}</div>
          <label>How to apply<select value={mode} onChange={event => setMode(event.target.value as "add" | "replace")}><option value="add">Add to existing genres</option><option value="replace">Replace existing genres</option></select></label>
        </>}
        <div className={styles.genreOptions} role="group" aria-label="Genre choices">{choices.map(label => <button key={label} type="button" aria-pressed={labels.some(value => value.toLowerCase() === label.toLowerCase())} onClick={() => setLabels(labels.some(value => value.toLowerCase() === label.toLowerCase()) ? labels.filter(value => value.toLowerCase() !== label.toLowerCase()) : [...labels, label])}>{label}</button>)}</div>
        <label>Custom genre<input value={custom} maxLength={60} onChange={event => setCustom(event.target.value)} /></label><button type="button" disabled={!custom.trim()} onClick={addCustom}>Add custom genre</button>
        {album && <label>Artist default<select aria-label="Artist default" value={artistKey} onChange={event => setArtistKey(event.target.value)}><option value="">Only change this album</option>{genreArtists(album).map(artist => <option key={artist.key} value={artist.key}>Apply to {artist.name}’s uncategorized albums</option>)}</select><span>Also use these genres for future uncategorized imports. Existing labels and explicitly cleared albums stay unchanged.</span></label>}
        {mode === "replace" && <p>No genres selected clears the selected albums to Uncategorized.</p>}
        <button type="submit" disabled={!selected.length}>{busy ? "Saving genres…" : "Save genres"}</button>
      </fieldset>
    </form>}
    {message && <p role="status">{message}</p>}
  </div>;
}
