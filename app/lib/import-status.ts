export type ImportWatch = { deadline: number; retryAt: number | null; retryDeadline: number | null };
export function createImportWatch(now: number): ImportWatch {
  return { deadline: now + 60000, retryAt: null, retryDeadline: null };
}
/** Heartbeats prove connectivity, not that a stalled retry made progress. */
export function observeImportEvent(watch: ImportWatch, event: { type: string; retryAt?: number; serverNow?: number }, now: number): ImportWatch {
  if (event.type === "waiting" && typeof event.retryAt === "number" && Number.isFinite(event.retryAt)) {
    if (watch.retryAt === event.retryAt) return watch;
    const remaining = Math.max(0, event.retryAt - (event.serverNow ?? now));
    return { retryAt: event.retryAt, retryDeadline: now + remaining, deadline: now + remaining + 45000 };
  }
  if (["requesting", "resuming", "progress"].includes(event.type)) return createImportWatch(now);
  return watch;
}
export function formatRetryStatus(retryAt: number, remainingMs: number): string {
  if (remainingMs <= 0) return "Spotify’s pause has ended — waiting for the retry to respond…";
  const seconds = Math.ceil(remainingMs / 1000);
  const duration = seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.ceil(seconds % 3600 / 60)}m` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  return `Spotify needs a pause — retry in ${duration} (${new Date(retryAt).toLocaleString()})`;
}

export function formatSavedPosition(checkpoint?: { pageUrl: string; index: number } | null): string {
  if (!checkpoint) return "No saved resume position for this source. Scanning starts at the beginning and skips saved albums.";
  try {
    const offset = Number(new URL(checkpoint.pageUrl).searchParams.get("offset") ?? 0);
    const position = offset + checkpoint.index + 1;
    if (!Number.isSafeInteger(position) || position < 1) throw new Error("Invalid position");
    return `Saved position: resume at item ${position.toLocaleString()} in this source.`;
  } catch { return "A previous import position is saved for this source."; }
}
