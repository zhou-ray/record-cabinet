"use client";
import { useState } from "react";
import { useAccount } from "./account-context";
import { engagementAccount } from "./lib/engagement";
import { createEngagementStorage } from "./lib/engagement-storage";
import { libraryStorage } from "./lib/library-storage";
import { readOrganization } from "./lib/collection-backup";

export default function AccountTools({ connected, disabled }: { connected: boolean; disabled: boolean }) {
  const { accountId, storage, organizationKey, apiFetch } = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function remove() {
    setBusy(true); setMessage("");
    const pending: Promise<void>[] = [];
    window.dispatchEvent(new CustomEvent("record-cabinet-removing-local", { detail: { pending } }));
    try {
      if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel("record-cabinet-account"); channel.postMessage({ removed: accountId }); channel.close(); }
      await Promise.all(pending);
      if (engagementAccount(accountId)) {
        const clearHistory = () => createEngagementStorage(accountId).clear();
        if (navigator.locks) await navigator.locks.request(`record-cabinet-engagement:${accountId}`, clearHistory);
        else await clearHistory();
      }
      await storage.clear();
      localStorage.removeItem(organizationKey);
      if (connected) {
        const response = await apiFetch("/api/spotify/logout", { method: "POST" });
        if (!response.ok) throw new Error("Local data removed. Sign out again to finish disconnecting.");
      }
      location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove local data. Please try again."); }
    finally { setBusy(false); }
  }
  async function recover() {
    setBusy(true); setMessage("");
    try {
      const old = await libraryStorage.load();
      if (!old.albums.length) { setMessage("No collection from the previous version was found in this browser."); return; }
      const data = { format: "record-cabinet", version: 1, createdAt: new Date().toISOString(), albums: old.albums, organization: readOrganization() };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "record-cabinet-previous-collection.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Previous collection downloaded. Restore it using Collection backup below while signed into its owner’s account.");
    } catch { setMessage("Could not recover the previous collection. It has not been changed."); }
    finally { setBusy(false); }
  }
  return <details className="collection-tools"><summary>Account and privacy</summary>
    <p>Albums, genre edits, and bins sync between devices signed into the same Spotify account. Import progress and artist genre defaults stay on each device. Use Library sync to delete the cloud copy and pause syncing. Removing local data here does not delete the cloud copy. Anyone with access to this browser’s storage can access its saved data.</p>
    <p><a href="/privacy">Privacy and data controls</a> · Spotify Premium and an invitation are required for Spotify playback.</p>
    <button disabled={disabled || busy} onClick={() => setConfirming(true)}>{connected ? "Disconnect and remove local data" : "Remove guest collection"}</button>
    {confirming && <div role="alert"><p>This removes this account’s albums, bins, genre defaults, import progress, and any local listening history from this browser. Download a backup below first if you want to keep them. Other accounts are unchanged.</p><button disabled={disabled || busy} onClick={remove}>Remove data{connected ? " and disconnect" : ""}</button><button disabled={busy} onClick={() => setConfirming(false)}>Cancel</button></div>}
    <details><summary>Recover a collection from the previous version</summary><p>Older versions did not separate accounts. Only recover this collection if it belongs to you. Recovery downloads a backup; it does not automatically add anything to the current account.</p><button disabled={disabled || busy} onClick={recover}>Download previous collection</button><button disabled={disabled || busy} onClick={async () => { if (!window.confirm("Delete the collection and bins saved by the previous version? Download its backup first. This cannot be undone.")) return; setBusy(true); try { await libraryStorage.clear(); localStorage.removeItem("record-cabinet-systems"); setMessage("Previous version’s local data removed."); } catch { setMessage("Previous data could not be removed. Please try again."); } finally { setBusy(false); } }}>Remove previous version’s data</button></details>
    <p role="status">{message}</p>
  </details>;
}
