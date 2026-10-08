import { checkedSession, engagementAccount, inspection, sessionEvents, type EngagementEvent, type Inspection, type PlaybackSession } from "./engagement";

/** Device-local, account-scoped storage. Never uploads through library cloud sync. */
export function createEngagementStorage(userId: string, factory: IDBFactory = indexedDB) {
  if (!engagementAccount(userId)) throw new Error("An authenticated account is required for engagement storage.");
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(`record-cabinet-engagement:${userId}`, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("events", { keyPath: "id" });
        request.result.createObjectStore("sessions", { keyPath: "id" });
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
  async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, fail: (error: unknown) => void) => () => T): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction(["events", "sessions"], mode); }
      catch (error) { db.close(); reject(error); return; }
      let result: () => T, failure: unknown;
      const fail = (error: unknown) => { failure = error; tx.abort(); };
      tx.oncomplete = () => { db.close(); resolve(result()); };
      tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error("Engagement save interrupted.")); };
      tx.onerror = () => { /* Aborting the transaction rejects the whole save. */ };
      try { result = work(tx, fail); } catch (error) { fail(error); }
    });
  }
  return {
    clear(): Promise<void> {
      return transaction("readwrite", tx => { tx.objectStore("events").clear(); tx.objectStore("sessions").clear(); return () => undefined; });
    },
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
    async recordInspection(value: Inspection): Promise<void> {
      if (value.userId !== userId || value.type !== "album_inspected") throw new Error("Invalid inspection scope.");
      const event = inspection(value.id, userId, value.albumId, value.timestamp);
      return transaction("readwrite", (tx, fail) => {
        const store = tx.objectStore("events"), request = store.get(event.id);
        request.onsuccess = () => {
          if (request.result && JSON.stringify(request.result) !== JSON.stringify(event)) { fail(new Error("Engagement event ID conflict.")); return; }
          store.put(event);
        };
        return () => undefined;
      });
    },
    /** Atomic summary + derived start/completion events; IDs make retries idempotent. */
    async saveSession(value: PlaybackSession): Promise<void> {
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
      });
    },
    load(): Promise<{ events: EngagementEvent[]; sessions: PlaybackSession[] }> {
      return transaction("readonly", tx => {
        const events = tx.objectStore("events").getAll(), sessions = tx.objectStore("sessions").getAll();
        return () => ({ events: events.result, sessions: sessions.result });
      });
    },
  };
}
