"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Album } from "./data/types";
import { readOrganization } from "./lib/collection-backup";
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
      const ticket = ++revision;
      setNow(Date.now());
      try {
        const [history, records] = await Promise.all([repo.load(), storage.loadMembership()]);
        if (closed || ticket !== revision) return;
        setSnapshot(history.discovery); setMembership(records); setNow(Date.now());
      } catch { if (!closed && ticket === revision) { setSnapshot(null); setMessage("Discovery could not be loaded. Your library is still available."); } }
    }
    const reset = () => { epoch.current++; refresh.cancel(); setSnapshot(null); setMessage("Discovery cleared. Prepare bins when you're ready."); void read(); };
    const remove = () => { available.current = false; closed = true; epoch.current++; refresh.cancel(); setSnapshot(null); setMembership([]); };
    const unsubscribe = subscribeHistoryReset(accountId, reset);
    const focus = () => { void read(); };
    window.addEventListener("focus", focus);
    window.addEventListener("record-cabinet-removing-local", remove);
    const timer = setInterval(focus, 15000); // Local IDB only; never Spotify polling.
    void read();
    return () => { available.current = false; closed = true; invalidate(); unsubscribe(); clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("record-cabinet-removing-local", remove); };
    // The refresh adapter belongs to this account; callbacks dispatch through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, storage, enabled]);
  async function prepare() {
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
      const result = history.discovery && discoveryIsCurrent(history.discovery, Date.now()) ? history.discovery : await writer.saveDiscovery(generateDiscovery({
        id: crypto.randomUUID(), accountId, now: Date.now(), albums: library.albums, membership: records, events: history.events, sessions: history.sessions, systems, behavioral: true,
        inspect: process.env.NODE_ENV === "development" ? scores => console.debug("Discovery scoring (local)", scores) : undefined,
      }), Date.now());
      if (ticket !== epoch.current) return;
      setSnapshot(result); setMessage("Your bins are ready. Their order stays for seven days.");
    } catch (error) { if (ticket === epoch.current) setMessage(error instanceof Error ? error.message : "Discovery could not be prepared. Try again later."); }
    finally { running.current = false; setBusy(false); }
  }
  const current = enabled && snapshot && discoveryIsCurrent(snapshot, now);
  const bins = useMemo(() => {
    const byId = new Map(collection.map(a => [membershipAlbumId(a), a]));
    const visible = current && snapshot ? visibleDiscoveryBins(snapshot, collection, membership, now) : DISCOVERY_TYPES.map(type => ({ type, albumIds: [] }));
    return visible.map(bin => ({ id: `discovery:${bin.type}:${snapshot?.id ?? "empty"}`, label: DISCOVERY_COPY[bin.type].label,
      blurb: DISCOVERY_COPY[bin.type].blurb, empty: DISCOVERY_COPY[bin.type].empty,
      albums: bin.albumIds.map(id => byId.get(id)!).filter(Boolean) }));
  }, [collection, current, snapshot, membership, now]);
  return { enabled, bins, current: !!current, busy, prepare, cancel: () => { epoch.current++; refresh.cancel(); },
    message: message || refresh.progress.message, progress: refresh.progress,
    expiresAt: current ? snapshot.expiresAt : null };
}
