import { checkedDiscoverySnapshot, discoveryIsCurrent, type DiscoverySnapshot } from "./discovery-snapshot";
import { checkedSession, engagementAccount, inspection, sessionEvents, type EngagementEvent, type Inspection, type PlaybackSession } from "./engagement";

export class HistoryResetError extends Error {
  constructor() { super("Personalization history was reset."); this.name = "HistoryResetError"; }
}
export const isHistoryResetError = (error: unknown) => error instanceof Error && error.name === "HistoryResetError";

/** Device-local, account-scoped storage. Never uploads through library cloud sync. */
export function createEngagementStorage(userId: string, factory: IDBFactory = indexedDB) {
  if (!engagementAccount(userId)) throw new Error("An authenticated account is required for engagement storage.");
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(`record-cabinet-engagement:${userId}`, 2);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (blocked) { request.transaction?.abort(); return; }
        const db = request.result;
        if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: "id" });
        if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
        if (!db.objectStoreNames.contains("metadata")) db.createObjectStore("metadata").put(0, "generation");
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("Engagement storage unavailable."));
      request.onblocked = () => { blocked = true; reject(new Error("Engagement storage is blocked by another tab.")); };
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, fail: (error: unknown) => void) => () => T, expectedGeneration?: number): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(["events", "sessions", "metadata"], mode); }
      catch (error) { db.close(); reject(error); return; }
      let result: () => T, failure: unknown;
      const fail = (error: unknown) => { failure = error; tx.abort(); };
      tx.oncomplete = () => { db.close(); try { resolve(result()); } catch (error) { reject(error); } };
      tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error("Engagement save interrupted.")); };
      tx.onerror = () => { /* Aborting the transaction rejects the whole save. */ };
      const start = () => { try { result = work(tx, fail); } catch (error) { fail(error); } };
      if (expectedGeneration === undefined) start();
      else {
        const request = tx.objectStore("metadata").get("generation");
        request.onsuccess = () => {
          if (request.result !== expectedGeneration) fail(new HistoryResetError());
          else start();
        };
      }
    });
  }
  function generation(): Promise<number> {
    return transaction("readonly", tx => {
      const request = tx.objectStore("metadata").get("generation");
      return () => request.result as number;
    });
  }
  function reset(): Promise<number> {
    return transaction("readwrite", (tx, fail) => {
      const metadata = tx.objectStore("metadata"), request = metadata.get("generation");
      let next = 0;
      request.onsuccess = () => {
        try {
        if (!Number.isSafeInteger(request.result) || request.result < 0 || request.result >= Number.MAX_SAFE_INTEGER) { fail(new Error("Invalid history generation.")); return; }
        next = request.result + 1;
        metadata.put(next, "generation");
        metadata.delete("discovery-snapshot");
        tx.objectStore("events").clear(); tx.objectStore("sessions").clear();
        } catch (error) { fail(error); }
      };
      return () => next;
    });
  }
  const repository = {
    generation,
    reset,
    async clear(): Promise<void> { await reset(); },
    /** Keep one year, at most 10,000 events and 2,000 sessions per device/account. */
    prune(now: number): Promise<void> {
      return transaction("readwrite", tx => {
        for (const [name, limit] of [["events", 10000], ["sessions", 2000]] as const) {
          const store = tx.objectStore(name), request = store.getAll();
          request.onsuccess = () => {
            const rows = request.result as (EngagementEvent | PlaybackSession)[];
            const timestamp = (row: EngagementEvent | PlaybackSession) => "timestamp" in row ? row.timestamp : row.updatedAt;
            rows.sort((a, b) => timestamp(b) - timestamp(a));
            for (const [index, row] of rows.entries()) if (index >= limit || timestamp(row) < now - 365 * 86400000) store.delete(row.id);
          };
        }
        return () => undefined;
      });
    },
    async recordInspection(value: Inspection, expectedGeneration: number): Promise<void> {
      if (value.userId !== userId || value.type !== "album_inspected") throw new Error("Invalid inspection scope.");
      const event = inspection(value.id, userId, value.albumId, value.timestamp);
      return transaction("readwrite", (tx, fail) => {
        const store = tx.objectStore("events"), request = store.get(event.id);
        request.onsuccess = () => {
          if (request.result && JSON.stringify(request.result) !== JSON.stringify(event)) { fail(new Error("Engagement event ID conflict.")); return; }
          store.put(event);
        };
        return () => undefined;
      }, expectedGeneration);
    },
    /** Atomic summary + derived start/completion events; IDs make retries idempotent. */
    async saveSession(value: PlaybackSession, expectedGeneration: number): Promise<void> {
      const session = checkedSession(value, userId);
      return transaction("readwrite", (tx, fail) => {
        const store = tx.objectStore("sessions"), request = store.get(session.id);
        request.onsuccess = () => {
          try {
            const previous: PlaybackSession | undefined = request.result;
            if (previous) {
              if (previous.albumId !== session.albumId || previous.userId !== userId || previous.startedAt !== session.startedAt || previous.albumDurationSeconds !== session.albumDurationSeconds) throw new Error("Engagement session ID conflict.");
              if (session.revision < previous.revision) return; // Late checkpoint must not undo progress.
              if (session.revision === previous.revision) {
                if (JSON.stringify(session) !== JSON.stringify(previous)) throw new Error("Engagement checkpoint conflict.");
                return;
              }
              if (previous.endedAt !== null || session.updatedAt < previous.updatedAt || session.listenedSeconds < previous.listenedSeconds
                || (previous.completedAt !== null && session.completedAt !== previous.completedAt)
                || previous.covered.some(([a, b]) => !session.covered.some(([start, end]) => start <= a && end >= b))) throw new Error("Engagement checkpoint regressed.");
            }
            store.put(session);
            // Checkpoints update the summary, not historical events. In particular,
            // do not rewrite the play-start row while the listener browses sleeves.
            for (const event of sessionEvents(session)) {
              if ((event.type === "album_play_started" && !previous)
                || (event.type === "album_completed" && previous?.completedAt == null)) tx.objectStore("events").put(event);
            }
          } catch (error) { fail(error); }
        };
        return () => undefined;
      }, expectedGeneration);
    },
    load(): Promise<{ events: EngagementEvent[]; sessions: PlaybackSession[]; generation: number; discovery: DiscoverySnapshot | null }> {
      return transaction("readonly", tx => {
        const events = tx.objectStore("events").getAll(), sessions = tx.objectStore("sessions").getAll();
        const marker = tx.objectStore("metadata").get("generation");
        const discovery = tx.objectStore("metadata").get("discovery-snapshot");
        return () => ({ events: events.result, sessions: sessions.result, generation: marker.result,
          discovery: discovery.result?.generation === marker.result ? checkedDiscoverySnapshot(discovery.result.snapshot, userId) : null });
      });
    },
  };
  // Writers bind before collecting any behavior, never lazily during a retry.
  // Deliberately do not expose unfenced write methods on the repository API.
  return { generation, reset, clear: repository.clear, prune: repository.prune, load: repository.load,
    async writer() {
      const captured = await generation();
      if (!Number.isSafeInteger(captured) || captured < 0) throw new Error("Invalid history generation.");
      return { generation: captured,
        recordInspection: (value: Inspection) => repository.recordInspection(value, captured),
        saveSession: (value: PlaybackSession) => repository.saveSession(value, captured),
        /** First current snapshot wins across tabs. An expired set may be replaced. */
        saveDiscovery(value: DiscoverySnapshot, now: number): Promise<DiscoverySnapshot> {
          const snapshot = checkedDiscoverySnapshot(value, userId);
          if (!discoveryIsCurrent(snapshot, now)) throw new Error("Discovery snapshot is not current.");
          return transaction("readwrite", (tx, fail) => {
            const metadata = tx.objectStore("metadata"), request = metadata.get("discovery-snapshot");
            let result = snapshot;
            request.onsuccess = () => {
              try {
                if (request.result?.generation === captured) {
                  const previous = checkedDiscoverySnapshot(request.result.snapshot, userId);
                  if (discoveryIsCurrent(previous, now) || previous.generatedAt > snapshot.generatedAt) { result = previous; return; }
                }
                metadata.put({ generation: captured, snapshot }, "discovery-snapshot");
              } catch (error) { fail(error); }
            };
            return () => result;
          }, captured);
        },
      };
    },
  };
}
