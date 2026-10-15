import type { Album } from "../data/types";
import { albumDuration, albumProgress, playbackTrackIndex } from "./album-timeline";
import type { BrowserPlayback } from "./spotify-browser";
import { isHistoryResetError } from "./engagement-storage";
import { ENGAGEMENT, createPlaybackAccumulator, engagementAlbumId, inspection, startPlaybackSession, type PlaybackSession, type Inspection } from "./engagement";

export type EngagementSink = {
  begin(album: Album): void;
  resume(album: Album): void;
  observe(album: Album, state: BrowserPlayback | null): void;
  interrupt(): void;
  end(): void;
};
type Store = { saveSession(value: PlaybackSession): Promise<void>; recordInspection(value: Inspection): Promise<void> };
type Dependencies = {
  store: Store; userId: string; now: () => number; monotonic: () => number; id: () => string;
  /** Exclusive origin/account lock; null means another tab owns playback tracking. */
  acquire: () => Promise<(() => void) | null>;
  error: () => void;
  sessionStarted?: (session: PlaybackSession) => void;
  invalidated?: () => void;
};

/** Thin runtime coordinator; playback must never wait for storage or ownership. */
export function createEngagementTracker(deps: Dependencies) {
  let selected: string | null = null, generation = 0, stopped = false;
  let accumulator: ReturnType<typeof createPlaybackAccumulator> | null = null;
  let release: (() => void) | null = null, acquiring = false;
  const pending = new Map<string, PlaybackSession | Inspection>();
  let writing: Promise<void> | null = null;
  let lastCheckpoint = 0;
  function flush(): Promise<void> {
    if (writing) return writing;
    writing = (async () => {
      // Drain additions made while a write is in flight too. A snapshot leaves
      // sleeve inspections waiting behind playback until the next timer tick.
      while (pending.size) {
        const [key, value] = pending.entries().next().value!;
        try {
          if ("type" in value) await deps.store.recordInspection(value); else await deps.store.saveSession(value);
          if (pending.get(key) === value) pending.delete(key);
        } catch (error) {
          if (isHistoryResetError(error)) { discard(); deps.invalidated?.(); }
          else deps.error();
          break; // Ordinary failures retry at a checkpoint; reset failures never retry.
        }
      }
    })().finally(() => { writing = null; });
    return writing;
  }
  function queue(value: PlaybackSession | Inspection) {
    const key = `${"type" in value ? "event" : "session"}:${value.id}`;
    // A persistent storage failure must not grow memory without bound.
    if (pending.size >= 100 && !pending.has(key)) { deps.error(); return; }
    pending.set(key, value);
    void flush();
  }
  function relinquish() {
    const unlock = release; release = null;
    if (unlock) void flush().then(() => flush()).finally(unlock);
  }
  function end() {
    generation++; selected = null;
    if (accumulator) queue(accumulator.end(Math.max(deps.now(), accumulator.snapshot().updatedAt)));
    accumulator = null;
    relinquish();
  }
  function discard() {
    stopped = true; generation++; selected = null; accumulator = null; pending.clear();
    const unlock = release; release = null; unlock?.();
  }
  return {
    begin(album: Album) {
      if (stopped) return;
      end(); selected = engagementAlbumId(album);
    },
    resume(album: Album) {
      if (stopped) return;
      const id = engagementAlbumId(album);
      if (selected !== id) { end(); selected = id; }
    },
    observe(album: Album, state: BrowserPlayback | null) {
      if (stopped || !selected || engagementAlbumId(album) !== selected) return;
      const index = state ? playbackTrackIndex(album, state) : -1;
      const position = state && index >= 0 ? albumProgress(album, album.tracks[index].id.replace(/^spotify:(?!track:)/, "spotify:track:"), state.position / 1000) : null;
      if (!state || position === null) { accumulator?.interrupt(); relinquish(); return; }
      if (!release) {
        if (state.paused || acquiring) return;
        acquiring = true;
        const version = generation;
        void deps.acquire().then(unlock => {
          if (stopped || version !== generation) { unlock?.(); return; }
          release = unlock;
        }).catch(deps.error).finally(() => { acquiring = false; });
        return; // Do not backdate listening to an observation preceding ownership.
      }
      const duration = albumDuration(album);
      if (!Number.isFinite(duration) || duration <= 0 || position > duration) { accumulator?.interrupt(); return; }
      if (!accumulator) {
        if (state.paused) return;
        accumulator = createPlaybackAccumulator(startPlaybackSession(deps.id(), deps.userId, selected, duration, deps.now()));
        deps.sessionStarted?.(accumulator.snapshot());
      }
      if (duration !== accumulator.snapshot().albumDurationSeconds) { accumulator.interrupt(); return; }
      const before = accumulator.snapshot();
      const saved = accumulator.observe({ albumId: selected, playing: !state.paused, positionSeconds: position, timestamp: deps.now(), monotonicMs: deps.monotonic() });
      if (before.revision === 0 || state.paused || saved.completedAt !== before.completedAt || deps.monotonic() - lastCheckpoint >= ENGAGEMENT.checkpointMs) {
        lastCheckpoint = deps.monotonic(); queue(saved);
      }
      if (state.paused) relinquish();
    },
    inspect(album: Album, interactionId: string, timestamp = deps.now()) {
      const id = engagementAlbumId(album);
      if (!stopped && id) queue(inspection(interactionId, deps.userId, id, timestamp));
    },
    interrupt() { accumulator?.interrupt(); if (accumulator) queue(accumulator.snapshot()); relinquish(); },
    end,
    discard,
    hasPlayback: () => !stopped && selected !== null,
    flush,
    async dispose() { stopped = true; end(); await flush(); await flush(); pending.clear(); },
  };
}
