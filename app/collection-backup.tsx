"use client";
import { useAccount } from "./account-context";
import { useState } from "react";
import type { Album } from "./data/types";
import { mergeAlbums } from "./lib/library-storage";
import { mergeOrganization, parseBackup, readOrganization } from "./lib/collection-backup";
export default function CollectionBackup({ albums, disabled, onRestore }: { albums: Album[]; disabled: boolean; onRestore: (albums: Album[]) => void }) {
  const { storage: libraryStorage, organizationKey } = useAccount();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof parseBackup> | null>(null);
  async function download() {
    setBusy(true); setMessage("");
    try {
      const saved = await libraryStorage.load().catch(() => ({ albums: [] }));
      const data = { format: "record-cabinet", version: 1, createdAt: new Date().toISOString(), albums: mergeAlbums(saved.albums, albums), organization: readOrganization(organizationKey) };
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...data, ...parseBackup(data) }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `record-cabinet-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage(`Backup downloaded: ${data.albums.length} albums and ${data.organization.systems.length} systems.`);
    } catch { setMessage("Backup could not be created. Your collection is unchanged."); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!preview) return;
    setBusy(true);
    try {
      const saved = await libraryStorage.load();
      // Existing metadata and systems win; restoring never deletes a record.
      const merged = mergeAlbums(preview.albums, mergeAlbums(saved.albums, albums));
      const organization = mergeOrganization(readOrganization(organizationKey), preview.organization, () => crypto.randomUUID());
      await libraryStorage.restoreAlbums(merged);
      onRestore(merged); setPreview(null);
      try { localStorage.setItem(organizationKey, JSON.stringify(organization)); window.dispatchEvent(new Event("record-cabinet-organization")); setMessage("Backup restored. Existing records and bins were kept."); }
      catch { setMessage("Albums restored, but bins could not be saved. Keep your backup and try again when browser storage is available."); }
    } catch { setMessage("Restore could not finish. Your existing collection was kept; you can try again."); }
    finally { setBusy(false); }
  }
  return <details className="collection-tools"><summary>Collection backup</summary><p>Save your album details and bins to a file. Backups contain no Spotify login or audio.</p><div className="collection-actions"><button disabled={disabled || busy} onClick={download}>Download backup</button><label>Restore backup<input type="file" accept=".json,application/json" disabled={disabled || busy} onChange={async event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    setPreview(null); setMessage(""); setBusy(true);
    try { if (file.size > 25 * 1024 * 1024) throw new Error("Choose a backup smaller than 25 MB."); setPreview(parseBackup(JSON.parse(await file.text()))); }
    catch (error) { setMessage(error instanceof Error ? error.message : "This backup could not be read."); }
    finally { setBusy(false); }
  }} /></label></div>{preview && <div><p>Ready to add {preview.albums.length} albums and {preview.organization.systems.length} systems. Existing records and bins will be kept.</p><button disabled={disabled || busy} onClick={restore}>Add backup to collection</button><button disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div>}<p role="status">{message}</p></details>;
}
