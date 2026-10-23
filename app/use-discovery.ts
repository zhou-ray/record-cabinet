"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Album } from "./data/types";
import type { CustomSystem } from "./catalog";
import { moveDiscoveryRecord, type DiscoveryDestination } from "./lib/discovery-move";
import type { DiscoveryFeedback } from "./lib/discovery-feedback";
import { parseOrganization, readOrganization } from "./lib/collection-backup";
import { useAccount } from "./account-context";
import { useMembershipRefresh } from "./use-membership-refresh";
import { createEngagementStorage } from "./lib/engagement-storage";
import { subscribeHistoryReset } from "./lib/engagement-reset";
import { discoveryIsCurrent, DISCOVERY_TYPES, visibleDiscoveryBins, type DiscoverySnapshot } from "./lib/discovery-snapshot";
import { DISCOVERY_COPY, generateDiscovery } from "./lib/discovery-generator";
import { membershipAlbumId, nextMembershipBatch, type SavedMembership } from "./lib/saved-membership";

export function useDiscovery(collection: Album[]) {
  const { accountId, storage, organizationKey } = useAccount();
  const refresh = useMembershipRefresh();
  const enabled = /^[a-f0-9]{64}$/.test(accountId) && !collection.some(a => a.source === "mock");
  const [feedback, setFeedback] = useState<DiscoveryFeedback[]>([]);
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(null);
  const [membership, setMembership] = useState<SavedMembership[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const epoch = useRef(0), running = useRef(false), available = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    available.current = true;
    let closed = false, revision = 0;
    const repo = createEngagementStorage(accountId);
    const invalidate = () => { epoch.current++; };
    async function read() {
      if (running.current) return;
      const mutation = epoch.current;
      const ticket = ++revision;
      setNow(Date.now());
      try {
        const [history, records] = await Promise.all([repo.load(), storage.loadMembership()]);
        if (closed || ticket !== revision || mutation !== epoch.current || running.current) return;
        setSnapshot(history.discovery); setFeedback(history.feedback); setMembership(records); setNow(Date.now());
      } catch { if (!closed && ticket === revision && mutation === epoch.current && !running.current) { setSnapshot(null); setMessage("Discovery could not be loaded. Your library is still available."); } }
    }
    const reset = () => { epoch.current++; refresh.cancel(); setFeedback([]); setSnapshot(null); setMessage("Discovery cleared. Prepare bins when you're ready."); void read(); };
    const remove = () => { available.current = false; closed = true; epoch.current++; refresh.cancel(); setSnapshot(null); setMembership([]); };
    const unsubscribe = subscribeHistoryReset(accountId, reset);
    const focus = () => { void read(); };
    window.addEventListener("focus", focus);
    window.addEventListener("record-cabinet-removing-local", remove);
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`record-cabinet-discovery:${accountId}`) : null;
    if (channel) channel.onmessage = focus;
    const timer = setInterval(focus, 15000); // Local IDB only; never Spotify polling.
    void read();
    return () => { available.current = false; closed = true; invalidate(); channel?.close(); unsubscribe(); clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("record-cabinet-removing-local", remove); };
    // The refresh adapter belongs to this account; callbacks dispatch through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, storage, enabled]);
  async function prepare(regenerate = false) {
    if (regenerate && process.env.NODE_ENV !== "development") return;
    if (!enabled || !available.current || running.current) return;
    running.current = true; setBusy(true); setMessage("");
    const ticket = epoch.current;
    try {
      const repo = createEngagementStorage(accountId), writer = await repo.writer();
      if (ticket !== epoch.current) return;
      await refresh.start();
      if (ticket !== epoch.current) return;
      const [library, records, history] = await Promise.all([storage.load(), storage.loadMembership(), repo.load()]);
      if (ticket !== epoch.current) return;
      setMembership(records); setNow(Date.now());
      if (nextMembershipBatch(library.albums, records, Date.now()).length) return;
      if (!library.albums.some(a => membershipAlbumId(a))) { setMessage("Import Spotify albums to prepare these bins."); return; }
      if (history.generation !== writer.generation) return;
      let systems: ReturnType<typeof readOrganization>["systems"] = [];
      try { systems = readOrganization(organizationKey).systems; } catch { /* Organization is optional. */ }
      const result = !regenerate && history.discovery && discoveryIsCurrent(history.discovery, Date.now()) ? history.discovery : await writer.saveDiscovery(generateDiscovery({
        id: crypto.randomUUID(), accountId, now: Date.now(), albums: library.albums, membership: records, events: history.events, feedback: history.feedback, sessions: history.sessions, systems, behavioral: true,
        inspect: process.env.NODE_ENV === "development" ? scores => console.debug("Discovery scoring (local)", scores) : undefined,
      }), Date.now(), regenerate ? history.discovery?.id : undefined);
      if (ticket !== epoch.current) return;
      setSnapshot(result); setMessage("Your bins are ready. Their order stays for seven days.");
    } catch (error) { if (ticket === epoch.current) setMessage(error instanceof Error ? error.message : "Discovery could not be prepared. Try again later."); }
    finally { running.current = false; setBusy(false); }
  }
  function organizationChanged() {
    window.dispatchEvent(new Event("record-cabinet-organization"));
    window.dispatchEvent(new CustomEvent("record-cabinet-local-change", { detail: { scope: accountId } }));
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (!enabled || !available.current || running.current) throw new Error("Wait for the current Discover action to finish.");
    if (!navigator.locks) throw new Error("Filing needs a browser with Web Locks support.");
    running.current = true; setBusy(true);
    const ticket = epoch.current;
    try {
      return await navigator.locks.request(`record-cabinet-organization:${accountId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("Another tab is filing records. Try again when it finishes.");
        if (!available.current || ticket !== epoch.current) throw new Error("Discovery changed. Open the bin again.");
        return work();
      });
    } finally { running.current = false; setBusy(false); }
  }
  async function act(binId: string, album: Album, destination?: DiscoveryDestination, onRemoved?: () => void) {
    return exclusive(async () => {
      const ticket = ++epoch.current, repo = createEngagementStorage(accountId), writer = await repo.writer();
      const history = await repo.load(), albumId = membershipAlbumId(album);
      const source = history.discovery?.bins.find(bin => `discovery:${bin.type}:${history.discovery!.id}` === binId && bin.albumIds.includes(albumId ?? ""));
      if (!source || !albumId || !history.discovery || !discoveryIsCurrent(history.discovery, Date.now()) || history.generation !== writer.generation || ticket !== epoch.current) throw new Error("This Discover set changed. Return to the shelf and open it again.");
      const decision: DiscoveryFeedback = { userId: accountId, albumId, bin: source.type, snapshotId: history.discovery.id, action: destination ? "file" : "remove", timestamp: Date.now(), ...(destination ? { destination } : {}) };
      const finish = async () => {
        if (!available.current || ticket !== epoch.current) throw new Error("Discovery changed. Open the bin again before retrying.");
        const result = await writer.saveDiscoveryFeedback(decision, Date.now());
        if (ticket !== epoch.current) return;
        if (!destination) onRemoved?.();
        setSnapshot(result); setNow(Date.now()); setFeedback(previous => [...previous.filter(row => row.albumId !== decision.albumId || row.bin !== decision.bin), decision]);
        setMessage(destination ? "Record filed in your personal bin. It stays in Discover." : "Record removed from this Discover bin. It is still in your library.");
        const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`record-cabinet-discovery:${accountId}`) : null;
        channel?.postMessage("changed"); channel?.close();
      };
      if (!destination) { await finish(); return null; }
      const result = await moveDiscoveryRecord({ albumId: album.id, destination, read: () => readOrganization(organizationKey),
        write: value => { localStorage.setItem(organizationKey, JSON.stringify(value)); organizationChanged(); }, finish });
      return result.status === "filed" ? { retry: () => exclusive(result.retry) } : null;
    });
  }
  async function createSystem(system: CustomSystem) {
    return exclusive(async () => {
      const organization = readOrganization(organizationKey);
      const next = parseOrganization({ ...organization, systems: [...organization.systems, system] });
      localStorage.setItem(organizationKey, JSON.stringify(next)); organizationChanged();
    });
  }
  const current = enabled && snapshot && discoveryIsCurrent(snapshot, now);
  const bins = useMemo(() => {
    const byId = new Map(collection.map(a => [membershipAlbumId(a), a]));
    const visible = current && snapshot ? visibleDiscoveryBins(snapshot, collection, membership, now) : DISCOVERY_TYPES.map(type => ({ type, albumIds: [] }));
    return visible.map(bin => ({ id: `discovery:${bin.type}:${snapshot?.id ?? "empty"}`, label: DISCOVERY_COPY[bin.type].label,
      blurb: DISCOVERY_COPY[bin.type].blurb, empty: DISCOVERY_COPY[bin.type].empty,
      albums: bin.albumIds.map(id => byId.get(id)!).filter(Boolean) }));
  }, [collection, current, snapshot, membership, now]);
  return { enabled, bins, act, createSystem, feedback, current: !!current, busy, prepare, regenerate: () => prepare(true), cancel: () => { epoch.current++; refresh.cancel(); },
    message: message || refresh.progress.message, progress: refresh.progress,
    expiresAt: current ? snapshot.expiresAt : null };
}
