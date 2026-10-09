"use client";
import { useEffect, useMemo, useRef } from "react";
import type { Album } from "./data/types";
import { useAccount } from "./account-context";
import { ENGAGEMENT, engagementAccount, engagementAlbumId } from "./lib/engagement";
import { clearEngagementDebug, observeEngagementDebug, traceEngagement } from "./lib/engagement-debug";
import { createEngagementStorage } from "./lib/engagement-storage";
import { createEngagementTracker, type EngagementSink } from "./lib/engagement-tracker";
import { recordPlaybackEvent } from "./lib/beta-diagnostics";

/** Explicit opt-in build switch until Milestone 2's user data controls are ready. */
export function useEngagement() {
  const { accountId } = useAccount();
  const tracker = useRef<ReturnType<typeof createEngagementTracker> | null>(null);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED !== "true" || !engagementAccount(accountId)) return;
    const store = createEngagementStorage(accountId);
    const current = createEngagementTracker({ store, userId: accountId, now: Date.now, monotonic: () => performance.now(), id: () => crypto.randomUUID(),
      error: () => recordPlaybackEvent("engagement-storage-error"),
      sessionStarted: session => traceEngagement(accountId, "Session confirmed", session.albumId, session.id),
      acquire: () => new Promise(resolve => {
        if (!navigator.locks) { resolve(null); return; } // Fail closed on unsupported browsers.
        void navigator.locks.request(`record-cabinet-engagement:${accountId}`, { ifAvailable: true }, lock => {
          if (!lock) { resolve(null); return; }
          return new Promise<void>(unlock => resolve(unlock));
        }).catch(() => resolve(null));
      }),
    });
    tracker.current = current;
    void store.prune(Date.now()).catch(() => recordPlaybackEvent("engagement-storage-error"));
    const pruning = setInterval(() => { void store.prune(Date.now()).catch(() => recordPlaybackEvent("engagement-storage-error")); }, 3600000);
    const timer = setInterval(() => { void current.flush(); }, ENGAGEMENT.checkpointMs);
    const interrupt = () => current.interrupt();
    const stop = (event?: Event) => {
      if (event instanceof PageTransitionEvent && event.persisted) { current.interrupt(); return; }
      tracker.current = null; clearInterval(timer); clearInterval(pruning);
      const finished = current.dispose();
      clearEngagementDebug(accountId);
      if (event instanceof CustomEvent && Array.isArray(event.detail?.pending)) event.detail.pending.push(finished);
    };
    window.addEventListener("pagehide", stop);
    window.addEventListener("offline", interrupt);
    document.addEventListener("visibilitychange", interrupt);
    window.addEventListener("record-cabinet-removing-local", stop);
    return () => {
      tracker.current = null; clearInterval(timer); clearInterval(pruning);
      window.removeEventListener("pagehide", stop); window.removeEventListener("offline", interrupt);
      document.removeEventListener("visibilitychange", interrupt);
      window.removeEventListener("record-cabinet-removing-local", stop);
      void current.dispose();
      clearEngagementDebug(accountId);
    };
  }, [accountId]);
  return useMemo(() => {
    const sink: EngagementSink = {
      begin: album => { traceEngagement(accountId, "Start requested", engagementAlbumId(album)); tracker.current?.begin(album); },
      resume: album => { traceEngagement(accountId, "Resume requested", engagementAlbumId(album)); tracker.current?.resume(album); },
      observe: (album, state) => {
        const uri = state?.track_window.current_track.album?.uri;
        observeEngagementDebug(accountId, { selectedAlbum: engagementAlbumId(album), reportedAlbum: uri?.startsWith("spotify:album:") ? uri.replace("spotify:album:", "spotify:") : null, playing: !!state && !state.paused });
        tracker.current?.observe(album, state);
      },
      interrupt: () => tracker.current?.interrupt(), end: () => { traceEngagement(accountId, "Tracking ended", null); tracker.current?.end(); },
    };
    return { sink: process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED === "true" && engagementAccount(accountId) ? sink : undefined,
      inspect: (album: Album, id: string, timestamp: number) => { traceEngagement(accountId, "Inspection requested", engagementAlbumId(album), id); tracker.current?.inspect(album, id, timestamp); } };
  }, [accountId]);
}
