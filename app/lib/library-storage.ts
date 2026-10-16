import { checkedMembershipBatch, mergeMembership, readMembershipCache, type MembershipBatch, type SavedMembership } from "./saved-membership";
import type { RequestUsage } from "./request-usage";
import { genreLookupKey, needsAutoGenres, type GenreLookup } from "./auto-genres";
import { hydratedAlbum, matchingExportAlbum, spotifyLibraryId } from "./spotify-export";
import { mergeCloudLibrary, type CloudLibrary } from "./cloud-library";
import { applyGenreDefaults, editGenres, genreLabels } from "./manual-genres";
import type { GenreCache } from "./genres";
import type { ImportCheckpoint } from "../data/spotify";
import type { Album } from "../data/types";

export type SavedLibrary = { albums: Album[]; source: string };
export function mergeAlbums(current: Album[], incoming: Album[]): Album[] {
  return [...new Map([...current, ...incoming].map(album => [album.id, album])).values()];
}
export function createLibraryStorage(scope = "") {
const databaseName = scope ? `record-cabinet-library:${scope}` : "record-cabinet-library";
function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("albums", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Library storage is blocked by another tab."));
  });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => () => T, notify = true): Promise<T> {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: () => T;
    tx.oncomplete = () => { db.close(); resolve(result()); if (notify && mode === "readwrite" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("record-cabinet-local-change", { detail: { scope } })); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Library storage was interrupted.")); };
    tx.onerror = () => { /* The transaction abort handler reports failures. */ };
    try { result = work(tx); }
    catch (error) { tx.abort(); db.close(); reject(error); }
  });
}
function putAddition(store: IDBObjectStore, album: Album) {
  const request = store.get(album.id);
  request.onsuccess = () => {
    const existing: Album | undefined = request.result;
    const addedAt = existing?.addedAt ?? existing?.importOrigin?.addedAt ?? (existing ? undefined : album.addedAt ?? album.importOrigin?.addedAt ?? Date.now());
    store.put({ ...album, ...(addedAt ? { addedAt } : {}) });
  };
}
function queueImportedGenres(tx: IDBTransaction, albums: Album[]) {
  const ids = albums.filter(album => album.source !== "mock" && !album.genresEdited && !album.genres?.length).map(album => album.id);
  if (!ids.length) return;
  const settings = tx.objectStore("settings"), request = settings.get("genre-import-queue");
  request.onsuccess = () => settings.put([...new Set([...(request.result ?? []), ...ids])], "genre-import-queue");
}
return {
  loadMembership(): Promise<SavedMembership[]> {
    return transaction(["settings"], "readonly", tx => {
      const request = tx.objectStore("settings").get("saved-membership");
      return () => readMembershipCache(request.result, scope);
    });
  },
  saveMembership(batch: MembershipBatch): Promise<void> {
    const checked = checkedMembershipBatch(batch, scope);
    return transaction(["settings"], "readwrite", tx => {
      const settings = tx.objectStore("settings"), request = settings.get("saved-membership");
      request.onsuccess = () => settings.put(mergeMembership(readMembershipCache(request.result, scope), checked.records), "saved-membership");
      return () => undefined;
    }, false); // Local provider metadata, not a cloud/library mutation.
  },
  recordRequestUsage(usage: RequestUsage, day = new Date().toISOString().slice(0, 10)): Promise<void> {
    return transaction(["settings"], "readwrite", tx => {
      const settings = tx.objectStore("settings"), request = settings.get("request-usage");
      request.onsuccess = () => {
        const days = request.result ?? {}, today = days[day] ?? { import: 0, metadata: 0, search: 0, playback: 0 };
        for (const key of ["import", "metadata", "search", "playback"] as const) if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) today[key] += usage[key];
        days[day] = today;
        settings.put(Object.fromEntries(Object.entries(days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30)), "request-usage");
      };
      return () => undefined;
    }, false);
  },
  loadRequestUsage(): Promise<Record<string, RequestUsage>> {
    return transaction(["settings"], "readonly", tx => { const request = tx.objectStore("settings").get("request-usage"); return () => request.result ?? {}; });
  },
  loadListeningGuide(): Promise<boolean> {
    return transaction(["settings"], "readonly", tx => { const request = tx.objectStore("settings").get("first-listen"); return () => request.result === true; });
  },
  finishListeningGuide(): Promise<void> {
    return transaction(["settings"], "readwrite", tx => { tx.objectStore("settings").put(true, "first-listen"); return () => undefined; }, false);
  },
  loadGenreImportQueue(): Promise<{ ids: string[]; paused: boolean }> {
    return transaction(["settings"], "readonly", tx => {
      const settings = tx.objectStore("settings"), ids = settings.get("genre-import-queue"), paused = settings.get("genre-import-paused");
      return () => ({ ids: ids.result ?? [], paused: paused.result === true });
    });
  },
  finishGenreImports(ids: readonly string[]): Promise<void> {
    return transaction(["settings"], "readwrite", tx => {
      const settings = tx.objectStore("settings"), request = settings.get("genre-import-queue"), done = new Set(ids);
      request.onsuccess = () => settings.put((request.result ?? []).filter((id: string) => !done.has(id)), "genre-import-queue");
      return () => undefined;
    });
  },
  pauseGenreImports(paused: boolean): Promise<void> {
    return transaction(["settings"], "readwrite", tx => { tx.objectStore("settings").put(paused, "genre-import-paused"); return () => undefined; });
  },
  loadAutoGenres(): Promise<Record<string, GenreLookup>> {
    return transaction(["settings"], "readonly", tx => { const request = tx.objectStore("settings").get("auto-genres"); return () => request.result ?? {}; });
  },
  applyAutoGenres(id: string, key: string, lookup: GenreLookup, artistKey?: string, replaceGenres?: string[]): Promise<Album | null> {
    return transaction(["albums", "settings"], "readwrite", tx => {
      const albums = tx.objectStore("albums"), settings = tx.objectStore("settings");
      const record = albums.get(id), saved = settings.get("auto-genres");
      let updated: Album | null = null;
      saved.onsuccess = () => settings.put({ ...(saved.result ?? {}), [key]: lookup, ...(artistKey ? { [artistKey]: lookup } : {}) }, "auto-genres");
      record.onsuccess = () => {
        const album: Album | undefined = record.result;
        if (!album || album.genresEdited || album.source === "mock" || genreLookupKey(album) !== key || !lookup.genres.length) return;
        if (!needsAutoGenres(album) && (lookup.source !== "apple" || !replaceGenres || JSON.stringify(album.genres) !== JSON.stringify(replaceGenres))) return;
        updated = { ...album, genres: lookup.genres, genre: lookup.genres.join(" / ") };
        albums.put(updated);
      };
      return () => updated;
    });
  },
  loadCloudState(): Promise<{ albums: Album[]; base: CloudLibrary | null }> {
    return transaction(["albums", "settings"], "readonly", tx => {
      const albums = tx.objectStore("albums").getAll();
      const base = tx.objectStore("settings").get("cloud-base");
      return () => ({ albums: albums.result, base: base.result ?? null });
    });
  },
  applyCloud(library: CloudLibrary, observed: Album[]): Promise<Album[]> {
    return transaction(["albums", "settings"], "readwrite", tx => {
      const store = tx.objectStore("albums"), request = store.getAll();
      let result: Album[] = [];
      request.onsuccess = () => {
        const current = new Map<string, Album>((request.result as Album[]).map(album => [album.id, album]));
        // Merge edits made during the request against the observed snapshot.
        // Keeping an entire stale album would undo unrelated remote edits next sync.
        const merged = mergeCloudLibrary({ ...library, albums: [...current.values()] }, { ...library, albums: observed }, library);
        for (const album of merged.albums) {
          store.put(album); current.set(album.id, album);
        }
        result = [...current.values()];
        tx.objectStore("settings").put(library, "cloud-base");
      };
      return () => result;
    }, false);
  },
  clear(): Promise<void> {
    return transaction(["albums", "settings"], "readwrite", tx => { tx.objectStore("albums").clear(); tx.objectStore("settings").clear(); return () => undefined; });
  },
  prepareAlbumGenres(album: Album): Promise<Album> {
    return transaction(["settings"], "readonly", tx => {
      const value = tx.objectStore("settings").get("genre-defaults");
      return () => applyGenreDefaults(album, value.result ?? {});
    });
  },
  editGenres(ids: string[], labels: string[], mode: "add" | "replace", artistKey?: string): Promise<Album[]> {
    const genres = genreLabels(labels);
    return transaction(["albums", "settings"], "readwrite", tx => {
      const records = tx.objectStore("albums"), settings = tx.objectStore("settings");
      let updates: Album[] = [];
      const all = records.getAll();
      all.onsuccess = () => {
        try {
          updates = editGenres(all.result, ids, genres, mode, artistKey);
          for (const album of updates) records.put(album);
        } catch { tx.abort(); }
      };
      if (artistKey) {
        const defaults = settings.get("genre-defaults");
        defaults.onsuccess = () => settings.put({ ...(defaults.result ?? {}), [artistKey]: genres }, "genre-defaults");
      }
      return () => updates;
    });
  },
  load(): Promise<SavedLibrary> {
    return transaction(["albums", "settings"], "readonly", tx => {
      const albums = tx.objectStore("albums").getAll();
      const source = tx.objectStore("settings").get("source");
      return () => ({ albums: albums.result as Album[], source: typeof source.result === "string" && /^(saved|liked|playlist:[a-zA-Z0-9]+)$/.test(source.result) ? source.result : "saved" });
    });
  },
  loadGenres(): Promise<GenreCache> {
    return transaction(["settings"], "readonly", tx => { const value = tx.objectStore("settings").get("artist-genres"); return () => value.result ?? {}; });
  },
  saveGenres(cache: GenreCache): Promise<void> {
    return transaction(["settings"], "readwrite", tx => { const settings = tx.objectStore("settings"); const request = settings.get("artist-genres"); request.onsuccess = () => settings.put({ ...(request.result ?? {}), ...cache }, "artist-genres"); return () => undefined; });
  },
  loadImportState(source: string): Promise<{ knownAlbumIds: string[]; checkpoint: ImportCheckpoint | null; completedSnapshot?: string }> {
    // One durable snapshot also sees records saved by another tab. Never use
    // an unsaved in-memory album as evidence that its import can be skipped.
    return transaction(["albums", "settings"], "readonly", tx => {
      const albums = tx.objectStore("albums").getAll();
      const positions = tx.objectStore("settings").get("checkpoints");
      const receipt = tx.objectStore("settings").get(`playlist-snapshot:${source}`);
      return () => {
        const knownAlbumIds = (albums.result as Album[]).map(spotifyLibraryId).filter((id): id is string => !!id);
        const known = new Set(knownAlbumIds);
        const saved = receipt.result;
        return { knownAlbumIds, checkpoint: positions.result?.[source] ?? null,
          ...(saved && Array.isArray(saved.albumIds) && saved.albumIds.every((id: string) => known.has(id)) ? { completedSnapshot: saved.snapshotId } : {}) };
      };
    });
  },
  savePlaylistSnapshot(source: string, snapshotId: string): Promise<void> {
    return transaction(["albums", "settings"], "readwrite", tx => {
      const albums = tx.objectStore("albums").getAll();
      albums.onsuccess = () => tx.objectStore("settings").put({ snapshotId, albumIds: (albums.result as Album[]).map(spotifyLibraryId).filter(Boolean) }, `playlist-snapshot:${source}`);
      return () => undefined;
    });
  },
  loadCheckpoints(): Promise<Record<string, ImportCheckpoint | null>> {
    return transaction(["settings"], "readonly", tx => { const value = tx.objectStore("settings").get("checkpoints"); return () => value.result ?? {}; });
  },
  saveProgress(source: string, checkpoint: ImportCheckpoint | null, album?: Album): Promise<void> {
    return transaction(["albums", "settings"], "readwrite", tx => {
      if (album) { putAddition(tx.objectStore("albums"), album); queueImportedGenres(tx, [album]); }
      const settings = tx.objectStore("settings");
      const request = settings.get("checkpoints");
      request.onsuccess = () => settings.put({ ...(request.result ?? {}), [source]: checkpoint }, "checkpoints");
      return () => undefined;
    });
  },
  saveAlbumDetails(original: Album, loaded: Album): Promise<Album> {
    return transaction(["albums"], "readwrite", tx => {
      const store = tx.objectStore("albums"), request = store.get(original.id);
      let result: Album;
      request.onsuccess = () => {
        try { result = hydratedAlbum(request.result ?? original, loaded); store.put(result); }
        catch { tx.abort(); }
      };
      return () => result;
    });
  },
  addExportAlbums(incoming: Album[]): Promise<Album[]> {
    return transaction(["albums", "settings"], "readwrite", tx => {
      const store = tx.objectStore("albums"), request = store.getAll();
      let records: Album[] = [];
      request.onsuccess = () => {
        records = request.result;
        const added: Album[] = [];
        for (const album of incoming) if (!matchingExportAlbum(records, album)) { const saved = { ...album, addedAt: album.addedAt ?? album.importOrigin?.addedAt ?? Date.now() }; store.put(saved); records.push(saved); added.push(saved); }
        queueImportedGenres(tx, added);
      };
      return () => records;
    });
  },
  restoreAlbums(albums: Album[]): Promise<void> {
    return transaction(["albums"], "readwrite", tx => { for (const album of albums) putAddition(tx.objectStore("albums"), album); return () => undefined; });
  },
  saveAlbum(album: Album): Promise<void> {
    return transaction(["albums"], "readwrite", tx => { putAddition(tx.objectStore("albums"), album); return () => undefined; });
  },
  saveSource(source: string): Promise<void> {
    return transaction(["settings"], "readwrite", tx => { tx.objectStore("settings").put(source, "source"); return () => undefined; });
  },
};

}
export const libraryStorage = createLibraryStorage();
