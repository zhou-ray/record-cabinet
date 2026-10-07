"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "./account-context";
import { emptyCloudLibrary, mergeCloudLibrary, same, type CloudState } from "./lib/cloud-library";
import { readOrganization } from "./lib/collection-backup";
import type { Album } from "./data/types";
import { setDiagnosticSync } from "./lib/beta-diagnostics";

export default function CloudLibrarySync({ disabled, onUpdate }: { disabled: boolean; onUpdate: (albums: Album[]) => void }) {
  const { storage, organizationKey, apiFetch, accountId } = useAccount();
  const [message, setMessage] = useState("Checking your account’s saved library…");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setDiagnosticSync(busy ? "Syncing" : paused ? "Paused" : message.startsWith("Library synced") ? "Up to date" : "Check status"); }, [busy, paused, message]);
  const running = useRef(false);
  const alive = useRef(true);
  const requests = useRef<AbortController | null>(null);
  const options = useRef({ disabled, onUpdate });
  useEffect(() => { options.current = { disabled, onUpdate }; }, [disabled, onUpdate]);
  useEffect(() => { alive.current = true; requests.current = new AbortController(); return () => { alive.current = false; requests.current?.abort(); }; }, []);
  const sync = useCallback(async () => {
    if (running.current || options.current.disabled || !alive.current) return;
    if (navigator.onLine === false) { setMessage("You’re offline. Changes are saved on this device and will sync when you reconnect."); return; }
    running.current = true; setBusy(true);
    try {
      const saved = await storage.loadCloudState();
      const local = { albums: saved.albums.filter(album => album.source !== "mock"), organization: readOrganization(organizationKey) };
      let accepted: CloudState | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await apiFetch("/api/library/sync", { cache: "no-store", signal: AbortSignal.any([requests.current!.signal, AbortSignal.timeout(20000)]) });
        const remote = await response.json();
        if (!response.ok) throw new Error(remote.error || "Could not sync your library.");
        if (!alive.current) return;
        setPaused(!remote.enabled);
        if (!remote.enabled) { setMessage("Cloud copy deleted. Sync is paused for this account."); return; }
        const library = mergeCloudLibrary(local, saved.base ?? emptyCloudLibrary(), remote.library);
        if (same(library, remote.library)) { accepted = remote; break; }
        const write = await apiFetch("/api/library/sync", { method: "PUT", signal: AbortSignal.any([requests.current!.signal, AbortSignal.timeout(20000)]), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: remote.revision, library }) });
        if (write.status === 412) continue;
        const result = await write.json();
        if (!write.ok) throw new Error(result.error || "Could not save your cloud library.");
        accepted = result; break;
      }
      if (!accepted) throw new Error("Another device is updating your library. We’ll try again shortly.");
      if (!alive.current) return;
      // Atomic application preserves imports/edits made during the request.
      const albums = await storage.applyCloud(accepted.library, local.albums);
      if (!alive.current) return;
      const currentOrganization = readOrganization(organizationKey);
      const organization = mergeCloudLibrary({ albums: [], organization: currentOrganization }, { albums: [], organization: local.organization }, { albums: [], organization: accepted.library.organization }).organization;
      if (!same(organization, currentOrganization)) {
        localStorage.setItem(organizationKey, JSON.stringify(organization));
        window.dispatchEvent(new Event("record-cabinet-organization"));
      }
      if (options.current.disabled) { setMessage("Cloud saved. Finishing local changes before updating the shelf."); return; }
      options.current.onUpdate(albums);
      setMessage(`Library synced · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      if (alive.current) setMessage(`${error instanceof Error ? error.message : "Sync unavailable."} Your records remain on this device.`);
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }, [storage, organizationKey, apiFetch]);
  useEffect(() => {
    const stop = () => { alive.current = false; requests.current?.abort(); };
    window.addEventListener("record-cabinet-removing-local", stop);
    const refresh = () => { if (document.visibilityState === "visible") void sync(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("record-cabinet-removing-local", stop); clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [sync]);
  useEffect(() => { const timer = setTimeout(() => { if (!disabled) void sync(); }, 500); return () => clearTimeout(timer); }, [disabled, sync]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.scope !== accountId || !alive.current) return;
      if (!paused) setMessage("Changes saved on this device. Waiting to sync…");
      clearTimeout(timer);
      timer = setTimeout(() => { void sync(); }, 2000);
    };
    const organizationChanged = (event: StorageEvent) => { if (event.key === organizationKey) changed(new CustomEvent("change", { detail: { scope: accountId } })); };
    window.addEventListener("record-cabinet-local-change", changed);
    window.addEventListener("storage", organizationChanged);
    return () => { clearTimeout(timer); window.removeEventListener("record-cabinet-local-change", changed); window.removeEventListener("storage", organizationChanged); };
  }, [accountId, organizationKey, paused, sync]);
  async function setCloudEnabled(enabled: boolean) {
    if (running.current) return;
    running.current = true; setBusy(true);
    try {
      const response = await apiFetch("/api/library/sync", { method: enabled ? "POST" : "DELETE", signal: AbortSignal.any([requests.current!.signal, AbortSignal.timeout(20000)]) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Cloud settings could not be saved.");
      setPaused(!enabled); setConfirming(false);
      setMessage(enabled ? "Sync enabled. Saving this device’s library…" : "Cloud copy deleted. Sync is paused for this account.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cloud settings could not be saved."); }
    finally { running.current = false; setBusy(false); }
    if (enabled) void sync();
  }
  return <details className="collection-tools"><summary>Library sync · {busy ? "Syncing…" : paused ? "Paused" : message.startsWith("Library synced") ? "Up to date" : "Check status"}</summary>
    <p role="status">{message}</p>
    <p>Albums, genre edits, and bins sync with this Spotify account when the app is open, about every 30 seconds. Sign into the same account on your phone and computer. Your saved music stays available offline. Import positions and artist genre defaults stay on each device. This beta supports cloud libraries up to 3 MB; larger collections stay saved locally.</p>
    <button disabled={disabled || busy} onClick={() => paused ? void setCloudEnabled(true) : void sync()}>{paused ? "Enable library sync" : "Sync now"}</button>
    <button disabled={disabled || busy || paused} onClick={() => setConfirming(true)}>Delete cloud library</button>
    {confirming && <div role="alert"><p>Delete the cloud copy and pause syncing on all devices? Records already saved on your devices are kept.</p><button disabled={busy} onClick={() => void setCloudEnabled(false)}>Delete cloud copy and pause sync</button><button onClick={() => setConfirming(false)}>Cancel</button></div>}
  </details>;
}
