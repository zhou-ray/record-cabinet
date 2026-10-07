import type { Album } from "../data/types";
import type { BrowserPlayback } from "./spotify-browser";
import { playbackTrackIndex, lastPlayableTrackIndex } from "./album-timeline";

/** Verify the local SDK before stopping; wall-clock estimates are not completion. */
export function createAlbumStop(onEnd: () => void, schedule = setTimeout, unschedule = clearTimeout, readState?: () => Promise<BrowserPlayback | null>) {
  let album: Album | null = null, ended = false, nearEnd = false;
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancel() { revision++; if (timer !== undefined) unschedule(timer); timer = undefined; }
  function finish() { cancel(); if (!album || ended) return; ended = true; onEnd(); }
  function observe(value: BrowserPlayback | null) {
    cancel();
    if (!album || ended || !value) return;
    const index = playbackTrackIndex(album, value);
    if (index < 0) {
      // An unknown ID at startup or mid-album is not proof of completion.
      if (nearEnd) finish();
      return;
    }
    const valid = Number.isFinite(value.duration) && value.duration > 0 && Number.isFinite(value.position) && value.position >= 0;
    if (!valid) return;
    const final = index === lastPlayableTrackIndex(album);
    if (final && value.paused && value.position === 0 && nearEnd) { finish(); return; }
    nearEnd = final && value.duration - value.position <= 2000;
    if (!value.paused && final) {
      const version = revision;
      timer = schedule(() => {
        if (!readState) return; // Never stop from an unverified optimistic clock.
        void readState().then(current => {
          if (revision !== version || !album || ended || !current) return;
          const currentIndex = playbackTrackIndex(album, current);
          if (currentIndex < 0) { finish(); return; }
          const last = currentIndex === lastPlayableTrackIndex(album);
          if (last && current.duration > 0 && current.position >= current.duration - 50) finish();
          else observe(current);
        }).catch(() => { /* Preserve controls; the next SDK event can resynchronize. */ });
      }, Math.max(100, value.duration - value.position));
    }
  }
  return { reset(next: Album | null) { cancel(); album = next; ended = false; nearEnd = false; }, cancel, observe };
}
