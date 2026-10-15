"use client";
import { useEffect, useMemo, useRef } from "react";
import type { Album } from "./data/types";
import { useAccount } from "./account-context";
import { ENGAGEMENT, engagementAccount, engagementAlbumId } from "./lib/engagement";
import { clearEngagementDebug, observeEngagementDebug, traceEngagement } from "./lib/engagement-debug";
import { playbackTrackIndex } from "./lib/album-timeline";
import { signalHistoryReset, subscribeHistoryReset } from "./lib/engagement-reset";
import { createEngagementStorage } from "./lib/engagement-storage";
import { createEngagementTracker, type EngagementSink } from "./lib/engagement-tracker";
import { recordPlaybackEvent } from "./lib/beta-diagnostics";

/** Explicit opt-in build switch; release/provider review still precedes public collection. */
export function useEngagement() {
  const { accountId } = useAccount();
  const tracker = useRef<ReturnType<typeof createEngagementTracker> | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED !== "true" || !engagementAccount(accountId)) return;
    const store = createEngagementStorage(accountId);
    let current: ReturnType<typeof createEngagementTracker> | null = null;
    let currentGeneration: number | null = null, binding = 0, closed = false;
    async function syncWriter() {
      const ticket = ++binding;
      try {
        const writer = await store.writer();
        if (closed || ticket !== binding || writer.generation === currentGeneration) return;
        const reset = currentGeneration !== null;
        current?.discard(); tracker.current = null;
        currentGeneration = writer.generation;
        if (reset) signalHistoryReset(accountId, writer.generation);
        current = createEngagementTracker({ store: writer, userId: accountId, now: Date.now, monotonic: () => performance.now(), id: () => crypto.randomUUID(),
          error: () => recordPlaybackEvent("engagement-storage-error"),
          invalidated: () => { void syncWriter(); },
          sessionStarted: session => traceEngagement(accountId, "Session confirmed", session.albumId, session.id),
          acquire: () => new Promise(resolve => {
            if (!navigator.locks) { resolve(null); return; }
            void navigator.locks.request(`record-cabinet-engagement:${accountId}`, { ifAvailable: true }, lock => {
              if (!lock) { resolve(null); return; }
              return new Promise<void>(unlock => resolve(unlock));
            }).catch(() => resolve(null));
          }),
        });
        tracker.current = current;
      } catch { if (!closed) recordPlaybackEvent("engagement-storage-error"); }
    }
    void syncWriter();
    const unsubscribe = subscribeHistoryReset(accountId, () => { void syncWriter(); });
    void store.prune(Date.now()).catch(() => recordPlaybackEvent("engagement-storage-error"));
    const pruning = setInterval(() => { void store.prune(Date.now()).catch(() => recordPlaybackEvent("engagement-storage-error")); }, 3600000);
    const timer = setInterval(() => { void syncWriter().then(() => current?.flush()); }, ENGAGEMENT.checkpointMs);
    const interrupt = () => { current?.interrupt(); void syncWriter(); };
    const check = () => { void syncWriter(); };
    const stop = (event?: Event) => {
      if (event instanceof PageTransitionEvent && event.persisted) { current?.interrupt(); return; }
      closed = true; binding++; tracker.current = null; clearInterval(timer); clearInterval(pruning);
      const finished = current?.dispose() ?? Promise.resolve();
      clearEngagementDebug(accountId);
      if (event instanceof CustomEvent && Array.isArray(event.detail?.pending)) event.detail.pending.push(finished);
    };
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    window.addEventListener("offline", interrupt);
    document.addEventListener("visibilitychange", interrupt);
    window.addEventListener("record-cabinet-removing-local", stop);
    return () => {
      closed = true; binding++; unsubscribe();
      tracker.current = null; clearInterval(timer); clearInterval(pruning);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("pagehide", stop); window.removeEventListener("offline", interrupt);
      document.removeEventListener("visibilitychange", interrupt);
      window.removeEventListener("record-cabinet-removing-local", stop);
      void current?.dispose();
      clearEngagementDebug(accountId);
    };
  }, [accountId]);
  return useMemo(() => {
    const sink: EngagementSink = {
      begin: album => { traceEngagement(accountId, "Start requested", engagementAlbumId(album)); tracker.current?.begin(album); },
      resume: album => { traceEngagement(accountId, "Resume requested", engagementAlbumId(album)); tracker.current?.resume(album); },
      observe: (album, state) => {
        if (!tracker.current?.hasPlayback()) return;
        const uri = state?.track_window.current_track.album?.uri;
        const track = state?.track_window.current_track;
        const index = state ? playbackTrackIndex(album, state) : -1;
        observeEngagementDebug(accountId, { selectedAlbum: engagementAlbumId(album), reportedAlbum: uri?.startsWith("spotify:album:") ? uri.replace("spotify:album:", "spotify:") : null, playing: !!state && !state.paused,
          reportedTrack: track?.uri ?? null, linkedTrack: track?.linked_from?.uri ?? track?.linked_from_uri ?? null,
          matchedTrack: index >= 0 ? album.tracks[index].id.replace(/^spotify:(?!track:)/, "spotify:track:") : null,
          context: state?.context?.uri?.startsWith("spotify:album:") ? state.context.uri : null });
        tracker.current?.observe(album, state);
      },
      interrupt: () => tracker.current?.interrupt(), end: () => { traceEngagement(accountId, "Tracking ended", null); tracker.current?.end(); },
    };
    return { sink: process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED === "true" && engagementAccount(accountId) ? sink : undefined,
      captureInspection: () => {
        const owner = tracker.current;
        return (album: Album, id: string, timestamp: number) => {
          if (!owner || owner !== tracker.current) return;
          traceEngagement(accountId, "Inspection requested", engagementAlbumId(album), id); owner.inspect(album, id, timestamp);
        };
      } };
  }, [accountId]);
}
