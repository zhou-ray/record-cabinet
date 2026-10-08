import type { Album } from "../data/types";

/** Versioned consumption rules; not recommendation weights. */
export const ENGAGEMENT = {
  version: 1,
  completionRatio: 0.75,
  maxObservationGapMs: 30_000,
  progressToleranceSeconds: 1,
  checkpointMs: 15_000,
} as const;

export type Inspection = {
  id: string; userId: string; albumId: string;
  type: "album_inspected"; timestamp: number;
};
export type PlaybackEvent = {
  id: string; userId: string; albumId: string;
  type: "album_play_started" | "album_completed"; timestamp: number; sessionId: string;
};
export type EngagementEvent = Inspection | PlaybackEvent;
export type PlaybackSession = {
  version: 1; id: string; userId: string; albumId: string;
  startedAt: number; updatedAt: number; endedAt: number | null;
  listenedSeconds: number; albumDurationSeconds: number;
  /** Unique verified coverage determines completion; repeated sections do not inflate it. */
  covered: [number, number][];
  completionRatio: number; completedAt: number | null; revision: number;
};
export type PlaybackObservation = {
  albumId: string; playing: boolean; positionSeconds: number;
  /** performance.now(), not Date.now(); never persist this clock across reloads. */
  monotonicMs: number; timestamp: number;
};

export const engagementAccount = (id: string) => /^[a-f0-9]{64}$/.test(id);
export const engagementAlbum = (id: string) => /^spotify:[a-zA-Z0-9]{1,64}$/.test(id);
const validId = (id: string) => typeof id === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(id);
const time = (value: number) => Number.isFinite(value) && value >= 0;

/** Collection eligibility for discovery is a separate, not-yet-implemented check. */
export function engagementAlbumId(album: Pick<Album, "id" | "source" | "playback">): string | null {
  if (album.source === "mock" || album.source === "manual" || album.playback.kind !== "spotify") return null;
  const match = /^spotify:album:([a-zA-Z0-9]{1,64})$/.exec(album.playback.uri);
  return match ? `spotify:${match[1]}` : null;
}

export function inspection(id: string, userId: string, albumId: string, timestamp: number): Inspection {
  if (!validId(id) || id.startsWith("playback:") || !engagementAccount(userId) || !engagementAlbum(albumId) || !time(timestamp)) throw new Error("Invalid engagement identity or timestamp.");
  return { id, userId, albumId, type: "album_inspected", timestamp };
}

function coverage(intervals: [number, number][], start: number, end: number): [number, number][] {
  const result: [number, number][] = [];
  for (const [a, b] of [...intervals, [start, end] as [number, number]].sort(([a], [b]) => a - b)) {
    const last = result.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else result.push([a, b]);
  }
  return result;
}

/** Whitelist durable fields; no arbitrary metadata, credentials, or SDK payloads. */
export function checkedSession(value: PlaybackSession, userId: string): PlaybackSession {
  if (!value || value.version !== 1 || !validId(value.id) || !engagementAccount(userId) || value.userId !== userId || !engagementAlbum(value.albumId)
    || !time(value.startedAt) || !time(value.updatedAt) || value.updatedAt < value.startedAt
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Number.isFinite(value.albumDurationSeconds) || value.albumDurationSeconds <= 0
    || !time(value.listenedSeconds) || !Array.isArray(value.covered)
    || (value.endedAt !== null && (!time(value.endedAt) || value.endedAt < value.startedAt || value.endedAt > value.updatedAt))
    || (value.completedAt !== null && (!time(value.completedAt) || value.completedAt < value.startedAt || value.completedAt > value.updatedAt))) throw new Error("Invalid engagement session.");
  let previousEnd = -1, total = 0;
  const covered: [number, number][] = value.covered.map(interval => {
    if (!Array.isArray(interval) || interval.length !== 2) throw new Error("Invalid engagement coverage.");
    const [start, end] = interval;
    if (!time(start) || !time(end) || start <= previousEnd || end <= start || end > value.albumDurationSeconds) throw new Error("Invalid engagement coverage.");
    previousEnd = end; total += end - start;
    return [start, end];
  });
  const ratio = total / value.albumDurationSeconds;
  if (Math.abs(value.completionRatio - ratio) > 1e-8 || !Number.isFinite(value.completionRatio)
    || value.listenedSeconds + 1e-8 < total || (ratio >= ENGAGEMENT.completionRatio) !== (value.completedAt !== null)) throw new Error("Invalid engagement completion.");
  return { version: 1, id: value.id, userId, albumId: value.albumId, startedAt: value.startedAt, updatedAt: value.updatedAt,
    endedAt: value.endedAt, listenedSeconds: value.listenedSeconds, albumDurationSeconds: value.albumDurationSeconds,
    covered, completionRatio: ratio, completedAt: value.completedAt, revision: value.revision };
}

/** Construct only after confirmed matching playback, never on a play request. */
export function startPlaybackSession(id: string, userId: string, albumId: string, duration: number, timestamp: number): PlaybackSession {
  return checkedSession({ version: 1, id, userId, albumId, startedAt: timestamp, updatedAt: timestamp, endedAt: null,
    listenedSeconds: 0, albumDurationSeconds: duration, covered: [], completionRatio: 0, completedAt: null, revision: 0 }, userId);
}

export function sessionEvents(session: PlaybackSession): PlaybackEvent[] {
  const base = { userId: session.userId, albumId: session.albumId, sessionId: session.id };
  return [{ ...base, id: `playback:${session.id}:started`, type: "album_play_started", timestamp: session.startedAt },
    ...(session.completedAt === null ? [] : [{ ...base, id: `playback:${session.id}:completed`, type: "album_completed" as const, timestamp: session.completedAt }])];
}

/** Pure accumulator. Persist snapshots separately; route navigation should not recreate it. */
export function createPlaybackAccumulator(saved: PlaybackSession) {
  let session = checkedSession(saved, saved.userId);
  let previous: PlaybackObservation | null = null;
  const snapshot = () => checkedSession(session, session.userId);
  return {
    snapshot,
    /** Call before a seek, after device loss, or when state becomes uncertain. */
    interrupt() { previous = null; },
    observe(observation: PlaybackObservation): PlaybackSession {
      if (session.endedAt !== null) return snapshot();
      const current = { ...observation };
      if (current.albumId !== session.albumId || !time(current.timestamp) || !time(current.monotonicMs)
        || !time(current.positionSeconds) || current.positionSeconds > session.albumDurationSeconds || current.timestamp < session.updatedAt) {
        previous = null; return snapshot();
      }
      if (previous && current.monotonicMs <= previous.monotonicMs) return snapshot();
      const elapsed = previous ? (current.monotonicMs - previous.monotonicMs) / 1000 : 0;
      const advance = previous ? current.positionSeconds - previous.positionSeconds : 0;
      if (previous?.playing && elapsed > 0 && elapsed <= ENGAGEMENT.maxObservationGapMs / 1000
        && advance > 0 && advance <= elapsed + ENGAGEMENT.progressToleranceSeconds) {
        // Conservatively cap progress to actual elapsed time. Never credit seek distance.
        const consumed = Math.min(advance, elapsed);
        const covered = coverage(session.covered, current.positionSeconds - consumed, current.positionSeconds);
        const ratio = covered.reduce((total, [a, b]) => total + b - a, 0) / session.albumDurationSeconds;
        session = { ...session, listenedSeconds: session.listenedSeconds + consumed, covered, completionRatio: ratio,
          completedAt: session.completedAt ?? (ratio >= ENGAGEMENT.completionRatio ? current.timestamp : null) };
      }
      session = { ...session, updatedAt: current.timestamp, revision: session.revision + 1 };
      previous = current;
      return snapshot();
    },
    /** No speculative final seconds are added. Flush one last confirmed observation first. */
    end(timestamp: number): PlaybackSession {
      if (session.endedAt === null && time(timestamp) && timestamp >= session.updatedAt) {
        session = { ...session, endedAt: timestamp, updatedAt: timestamp, revision: session.revision + 1 };
        previous = null;
      }
      return snapshot();
    },
  };
}
