import type { Album } from "../data/types";
import { checkedMembershipBatch, membershipAlbumId, membershipStatus, nextMembershipBatch, type MembershipBatch, type SavedMembership } from "./saved-membership";

export type MembershipProgress = {
  status: "idle" | "checking" | "partial" | "complete" | "cancelled" | "error";
  total: number; checked: number; saved: number; requests: number; message: string;
};
type Storage = {
  load(): Promise<{ albums: Album[] }>;
  loadMembership(): Promise<SavedMembership[]>;
  membershipWriter(): Promise<{ save(batch: MembershipBatch, signal?: AbortSignal): Promise<void> }>;
};
export const emptyMembershipProgress = (): MembershipProgress => ({ status: "idle", total: 0, checked: 0, saved: 0, requests: 0, message: "" });

/** Explicit, bounded runs. Previously committed batches are the resume checkpoint. */
export function createMembershipRefresh(options: {
  accountId: string; storage: Storage; apiFetch: typeof fetch;
  progress: (value: MembershipProgress) => void; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let controller: AbortController | null = null, running: Promise<void> | null = null, closed = false;
  let state = emptyMembershipProgress();
  function publish(change: Partial<MembershipProgress>) {
    state = { ...state, ...change };
    if (!closed) options.progress({ ...state });
  }
  function counts(albums: Album[], records: SavedMembership[]) {
    const ids = [...new Set(albums.map(membershipAlbumId).filter((id): id is string => !!id))];
    const statuses = ids.map(id => membershipStatus(id, records, now()));
    return { total: ids.length, checked: statuses.filter(s => s !== "unknown").length, saved: statuses.filter(s => s === "saved").length };
  }
  async function run(signal: AbortSignal) {
    publish({ ...emptyMembershipProgress(), status: "checking" });
    try {
      if (!/^[a-f0-9]{64}$/.test(options.accountId)) throw new Error("Connect Spotify before checking saved albums.");
      // Bind before reading/fetching; local deletion invalidates this writer atomically.
      const writer = await options.storage.membershipWriter();
      signal.throwIfAborted();
      const library = await options.storage.load();
      signal.throwIfAborted();
      for (let batchIndex = 0; ; batchIndex++) {
        const records = await options.storage.loadMembership();
        signal.throwIfAborted();
        const summary = counts(library.albums, records);
        publish(summary);
        const ids = nextMembershipBatch(library.albums, records, now());
        if (!ids.length) { publish({ status: "complete", message: "Saved-album checks are up to date." }); return; }
        if (batchIndex === 3) { publish({ status: "partial", message: "Progress saved. Continue to check the remaining albums." }); return; }
        publish({ requests: state.requests + 1 });
        const response = await options.apiFetch("/api/spotify/library", {
          method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
          body: JSON.stringify({ membershipAlbumIds: ids }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        });
        signal.throwIfAborted();
        if (!response.ok) {
          if (response.status === 429) throw new Error("Spotify needs a pause. Progress is saved; try again later.");
          if (response.status === 401 || response.status === 409) throw new Error("Your Spotify connection changed. Reconnect before continuing.");
          throw new Error("Saved albums could not be checked. Progress is saved; try again later.");
        }
        const batch = checkedMembershipBatch(await response.json(), options.accountId);
        signal.throwIfAborted();
        if (batch.records.length !== ids.length || batch.records.some(row => !ids.includes(row.albumId)
          || membershipStatus(row.albumId, batch.records, now()) === "unknown")) throw new Error("Spotify returned an incomplete or stale saved-album check. Try again later.");
        await writer.save(batch, signal);
        signal.throwIfAborted();
      }
    } catch (error) {
      publish(signal.aborted
        ? { status: "cancelled", message: "Check stopped. Completed batches are saved." }
        : { status: "error", message: error instanceof Error ? error.message : "Saved albums could not be checked. Try again later." });
    }
  }
  return {
    start(): Promise<void> {
      if (closed) return Promise.resolve();
      if (running) return running;
      controller = new AbortController();
      running = run(controller.signal).finally(() => { running = null; controller = null; });
      return running;
    },
    cancel() { controller?.abort(); },
    dispose() { closed = true; controller?.abort(); },
  };
}
