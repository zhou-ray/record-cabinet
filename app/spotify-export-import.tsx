"use client";
import { useRef, useState } from "react";
import { useAccount } from "./account-context";
import { exportAlbums, readSpotifyExport, type ExportSection } from "./lib/spotify-export";
import type { Album } from "./data/types";
export default function SpotifyExportImport({ disabled, onImported }: { disabled: boolean; onImported: (albums: Album[]) => void }) {
  const { storage, accountId } = useAccount();
  const [sections, setSections] = useState<ExportSection[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const running = useRef(false);
  async function importFile() {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); setMessage("Adding records from your export…");
    try {
      const before = await storage.load();
      const candidates = await exportAlbums(selected.flatMap(index => sections[index].entries), before.albums);
      const after = await storage.addExportAlbums(candidates);
      onImported(after); setSections([]); setSelected([]);
      setMessage(`Added ${after.length - before.albums.length} albums. Existing records were kept. No Spotify API requests were made.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the export. Your existing records are safe."); }
    finally { running.current = false; setBusy(false); }
  }
  return <section className="collection-tools spotify-file-import" aria-label="Spotify file import">
    <button className="spotify-file-import-toggle" aria-expanded={open} aria-controls="spotify-file-import-panel" onClick={() => setOpen(current => !current)}>Import Spotify data file</button>
    <span className="spotify-file-import-hint">Add albums without Spotify API requests</span>
    <div id="spotify-file-import-panel" hidden={!open}>
    <p>Request Account data from <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noreferrer">Spotify’s privacy settings</a>. Unzip the download and choose YourLibrary.json or Playlist JSON files below. Files are read on this device; unrelated account data is not uploaded.</p>
    <p>Albums appear immediately with placeholder covers. Artwork and complete track lists load when you first flip or play an album, then stay saved for next time. Spotify playback still requires a connection, Premium, and available quota.</p>
    {accountId === "guest" && <p>Connect Spotify first if you want these records to sync to your Spotify account. Otherwise they are saved to this browser’s guest collection.</p>}
    <label>Spotify export files<input type="file" accept=".json,application/json" multiple disabled={disabled || busy} onChange={async event => {
      const files = [...(event.target.files ?? [])]; event.target.value = ""; if (!files.length) return;
      setBusy(true); setSections([]); setSelected([]); setMessage("");
      try {
        if (files.length > 50 || files.reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) throw new Error("Choose up to 50 JSON files totaling less than 25 MB.");
        const next: ExportSection[] = [];
        for (const file of files) next.push(...readSpotifyExport(JSON.parse((await file.text()).replace(/^\uFEFF/, ""))).map(section => ({ ...section, name: `${section.name} · ${file.name}` })));
        setSections(next); setSelected(next.flatMap((section, index) => section.entries.length ? [index] : []));
        if (!next.some(section => section.entries.length)) setMessage("No supported music entries found. Podcasts, local files, and entries without Spotify IDs cannot be imported.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "This file could not be read."); }
      finally { setBusy(false); }
    }} /></label>
    {!!sections.length && <fieldset disabled={disabled || busy}><legend>Choose what to import</legend>
      {sections.map((section, index) => <label key={index} style={{ display: "block", margin: "10px 0" }}><input type="checkbox" checked={selected.includes(index)} disabled={!section.entries.length} onChange={event => setSelected(current => event.target.checked ? [...current, index] : current.filter(item => item !== index))} /> {section.name} · {section.entries.length} music entries{section.skipped ? ` · ${section.skipped} unsupported entries skipped` : ""}</label>)}
      <p>Repeated songs are grouped into albums. Where the export has no album ID, matching artist and album names are grouped until Spotify resolves the album on its first flip or play.</p>
      <button disabled={!selected.length} onClick={() => void importFile()}>Import selected music</button>
    </fieldset>}
    <p role="status">{message}</p>
    </div>
  </section>;
}
