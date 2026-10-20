"use client";
import { playlistId, type PlaylistPreview } from "./lib/playlist-preview";
import { useAccount } from "./account-context";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Album } from "./data/types";
import { publicDemo } from "./data/public-demo";
import RequestUsagePanel from "./request-usage";
import ListeningGuide from "./listening-guide";
import FirstVisit from "./first-visit";
import BetaTools from "./beta-tools";
import EngagementDebug from "./engagement-debug";
import { recordDiagnostic, recordPlaybackEvent } from "./lib/beta-diagnostics";
import { spotifySignInMessage } from "./lib/spotify-sign-in-message";
import CloudLibrarySync from "./cloud-library-sync";
import AccountTools from "./account-tools";
import AutoGenres from "./auto-genres";
import ManualAlbum from "./manual-album";
import CollectionBackup from "./collection-backup";
import type { ImportCheckpoint } from "./data/spotify";
import RecordBin from "./record-bin";
import { mergeAlbums } from "./lib/library-storage";
import { createImportWatch, observeImportEvent, formatRetryStatus, formatSavedPosition } from "./lib/import-status";

// Both cabinet views live in the shared layout. Keep navigation in the same
// document even if a new deployment would require a route payload reload.
function CabinetLink({ href, children }: { href: "/" | "/settings"; children: ReactNode }) {
  return <a href={href} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
  }}>{children}</a>;
}
function RetryStatus({ retryAt, deadline }: { retryAt: number; deadline: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatRetryStatus(retryAt, deadline - now)}</>;
}

export default function LibraryScreen({ connected, demo, legacySession = false }: { connected: boolean; demo: Album[]; legacySession?: boolean }) {
  const demoCollection = useMemo(() => publicDemo(demo), [demo]);
  const settings = usePathname() === "/settings";
  const params = useSearchParams();
  useEffect(() => {
    recordPlaybackEvent(settings ? "settings-view" : "records-view");
    document.title = settings ? "Library & settings — Record Cabinet" : "Record Cabinet — The Listening Room";
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [settings]);
  const [authError] = useState(params.get("spotify") ?? (legacySession ? "reconnect" : ""));
  const mobileSetup = authError === "mobile-setup";
  const { accountId, storage: libraryStorage, apiFetch } = useAccount();
  const [albums, setAlbums] = useState<Album[] | null>(connected ? [] : demo);
  const [error, setError] = useState(spotifySignInMessage(authError));
  useEffect(() => { if (/\bReference: [a-f0-9]{8}\b/i.test(error)) recordDiagnostic("import", 0, error); }, [error]);
  const [progress, setProgress] = useState({ loaded: 0, skipped: 0, total: null as number | null, complete: true });
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [retryDeadline, setRetryDeadline] = useState(0);
  const importController = useRef<AbortController | null>(null);
  const [checkpoints, setCheckpoints] = useState<Record<string, ImportCheckpoint | null>>({});
  const checkpointRef = useRef<Record<string, ImportCheckpoint | null>>({});
  const [importRequests, setImportRequests] = useState<number | null>(null);
  const [genreActivity, setGenreActivity] = useState("");
  const [unchanged, setUnchanged] = useState(false);
  const [batchSize, setBatchSize] = useState(100);
  const importBatch = useRef(100);
  const freshImport = useRef(false);
  const [tourSession, setTourSession] = useState(0);
  const [showDemo, setShowDemo] = useState(() => params.get("demo") === "1");
  const running = useRef(false);
  const [source, setSource] = useState("saved");
  const [selectedSource, setSelectedSource] = useState("saved");
  const [playlists, setPlaylists] = useState<{ id: string; name: string }[]>([]);
  const [playlistError, setPlaylistError] = useState("");
  const [listing, setListing] = useState(false);
  const [playlistLink, setPlaylistLink] = useState("");
  const [preview, setPreview] = useState<(PlaylistPreview & { fresh: boolean }) | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const confirmedPlaylist = useRef<PlaylistPreview | null>(null);
  const previewController = useRef<AbortController | null>(null);
  useEffect(() => () => previewController.current?.abort(), []);

  const listingRef = useRef(false);
  async function loadPlaylists() {
    if (listingRef.current) return;
    listingRef.current = true;
    setListing(true); setPlaylistError("");
    try {
      const response = await apiFetch("/api/spotify/library?list=playlists", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load playlists.");
      if (!Array.isArray(body.playlists) || body.limited || body.playlists.some((item: { id?: unknown; name?: unknown } | null) => !item || typeof item.id !== "string" || typeof item.name !== "string")) throw new Error("The playlist list was incomplete. Try loading it again; your previous list is still available.");
      setPlaylists([...new Map<string, { id: string; name: string }>(body.playlists.map((item: { id: string; name: string }) => [item.id, item])).values()]);
      if (!body.playlists.length) setPlaylistError("No playlists found. You can still import Liked Songs.");
    } catch (error) { setPlaylistError(error instanceof Error ? error.message : "Could not load playlists."); }
    finally { listingRef.current = false; setListing(false); }
  }
  const [attempt, setAttempt] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [storageError, setStorageError] = useState("");
  const pendingWrites = useRef(new Set<Promise<void>>());
  const [saving, setSaving] = useState(false);
  const latestAlbums = useRef(albums);
  useEffect(() => { latestAlbums.current = albums; }, [albums]);
  function persist(operation: Promise<void>) {
    setSaving(true);
    pendingWrites.current.add(operation);
    void operation.catch(() => setStorageError("This browser could not save your collection. Keep this page open to retain the albums currently shown.")).finally(() => {
      pendingWrites.current.delete(operation);
      if (!pendingWrites.current.size) setSaving(false);
    });
  }
  useEffect(() => {
    let active = true;
    void Promise.all([libraryStorage.load(), libraryStorage.loadCheckpoints()]).then(([saved, positions]) => {
      if (!active) return;
      checkpointRef.current = positions; setCheckpoints(positions);
      const current = (latestAlbums.current ?? []).filter(album => album.source !== "mock");
      const recovered = mergeAlbums(saved.albums, current);
      if (recovered.length) {
        latestAlbums.current = recovered;
        setAlbums(recovered);
        setRestored(true);
        setProgress({ loaded: 0, skipped: 0, total: null, complete: true });
      }
      setSource(saved.source);
      setSelectedSource(saved.source);
      // Preserve any records already in memory when Fast Refresh installs storage.
      for (const album of current) persist(libraryStorage.saveAlbum(album));
    }).catch(() => {
      if (active) setStorageError("Your saved collection could not be opened. Keep this page open; new imports may not survive a reload.");
    }).finally(() => { if (active) setStorageReady(true); });
    return () => { active = false; };
  }, [libraryStorage]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingWrites.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  async function startImport(nextSource: string, fresh = false) {
    if (running.current || previewing) return;
    if (!nextSource.startsWith("playlist:")) { confirmedPlaylist.current = null; setPreview(null); runImport(nextSource, fresh); return; }
    const controller = new AbortController(); previewController.current?.abort(); previewController.current = controller;
    setPreviewing(true); setPreview(null); setPlaylistError("");
    try {
      const response = await apiFetch("/api/spotify/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewPlaylist: nextSource.slice(9) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The playlist could not be checked.");
      if (data.id !== nextSource.slice(9) || !data.snapshotId || !Array.isArray(data.albums)) throw new Error("Spotify returned a different playlist. Nothing was imported.");
      if (controller.signal.aborted) return;
      setPreview({ ...data, fresh });
      setPlaylists(current => [...current.filter(item => item.id !== data.id), { id: data.id, name: data.name }]);
    } catch (error) { if (!controller.signal.aborted) setPlaylistError(error instanceof Error ? error.message : "Could not preview this playlist."); }
    finally { if (previewController.current === controller) { previewController.current = null; setPreviewing(false); } }
  }
  function runImport(nextSource: string, fresh = false) {
    if (running.current) return;
    running.current = true; importBatch.current = batchSize; freshImport.current = fresh;
    if (fresh) { checkpointRef.current = { ...checkpointRef.current, [nextSource]: null }; setCheckpoints(checkpointRef.current); }

    persist(libraryStorage.saveSource(nextSource));
    setRetryAt(null); setError("");
    setImportRequests(null); setUnchanged(false);
    setProgress({ loaded: 0, skipped: 0, total: null, complete: false });
    setSource(nextSource); setAttempt(value => value + 1);
  }
  useEffect(() => {
    if (!connected || !storageReady || attempt === 0) return;
    const controller = new AbortController();
    importController.current = controller;
    function releaseImport() {
      if (importController.current === controller) {
        importController.current = null;
        running.current = false;
      }
    }
    let timedOut = false;
    let watch = createImportWatch(Date.now());
    const watchdog = setInterval(() => {
      if (Date.now() <= watch.deadline || controller.signal.aborted) return;
      timedOut = true;
      controller.abort(); releaseImport();
      setRetryAt(null);
      setError(watch.retryAt ? "Spotify’s retry did not respond after the pause ended. Your loaded albums are still here. Choose Try again to resume importing." : "The import stopped making progress. Your loaded albums are still here. Choose Try again to resume importing.");
    }, 1000);
    let timer: ReturnType<typeof setTimeout>;
    const resetTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(); releaseImport();
        setRetryAt(null);
        setError("Spotify has not sent an update for 45 seconds. Try again, or reconnect Spotify if it keeps happening.");
      }, 45000);
    };
    resetTimeout();
    const forceFresh = freshImport.current;
    freshImport.current = false;
    libraryStorage.loadImportState(source).catch(() => { throw new Error("Import paused because this browser could not read your saved albums and position. No Spotify request was made. Try again when browser storage is available."); }).then(saved => {
      controller.signal.throwIfAborted();
      const checkpoint = forceFresh ? null : saved.checkpoint;
      checkpointRef.current = { ...checkpointRef.current, [source]: checkpoint };
      setCheckpoints(checkpointRef.current);
      return apiFetch(`/api/spotify/library?source=${encodeURIComponent(source)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchSize: importBatch.current, checkpoint, knownAlbumIds: saved.knownAlbumIds, completedSnapshot: forceFresh ? undefined : saved.completedSnapshot, confirmedSnapshot: confirmedPlaylist.current?.id === source.slice(9) ? confirmedPlaylist.current.snapshotId : undefined }),
        signal: controller.signal, cache: "no-store",
      });
    }).then(async response => {
      resetTimeout();
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || "Could not load your library.");
      }
      if (!response.body) throw new Error("The import connection could not open. Please try again.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let complete = false;
      try {
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted) return;
          resetTimeout();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          if (chunk.done && buffer.trim()) { lines.push(buffer); buffer = ""; }
          for (const line of lines) {
            if (controller.signal.aborted) return;
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            watch = observeImportEvent(watch, event, Date.now());
            if (event.type === "waiting") { setRetryAt(watch.retryAt); setRetryDeadline(watch.retryDeadline ?? Date.now()); }
            if (event.type === "requesting" || event.type === "progress" || event.type === "resuming" || event.type === "complete" || event.type === "error") setRetryAt(null);
            if (event.type === "artist-genres") {
              await libraryStorage.saveGenres({ [event.artistId]: { genres: event.genres, checkedAt: event.checkedAt } });
              window.dispatchEvent(new Event("record-cabinet-genres"));
            }
            if (event.usage) setImportRequests(Object.values(event.usage as Record<string, number>).reduce((sum, count) => sum + count, 0));
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "complete") {
              complete = true;
              setAlbums(current => current ?? []);
              setProgress(current => ({ ...current, complete: true }));
              // The protocol has finished; do not wait for the connection to
              // close before allowing the next saved batch to begin.
              clearTimeout(timer); clearInterval(watchdog);
              releaseImport(); controller.abort();
              return;
            } else if (event.type === "progress") {
              if (event.unchanged) setUnchanged(true);
              if (event.completedSnapshot) await libraryStorage.savePlaylistSnapshot(source, event.completedSnapshot);
              setProgress({ loaded: event.loaded, skipped: event.skipped ?? 0, total: event.total, complete: false });
              if (event.album) {
                event.album = await libraryStorage.prepareAlbumGenres(event.album);
                if (controller.signal.aborted) return;
                latestAlbums.current = mergeAlbums(latestAlbums.current ?? [], [event.album]);
                setAlbums(current => mergeAlbums(current ?? [], [event.album]));
              }
              if ("checkpoint" in event) {
                const operation = libraryStorage.saveProgress(source, event.checkpoint, event.album);
                persist(operation);
                try { await operation; }
                catch { throw new Error("Import paused because this browser could not save its position. Your loaded albums are still here. Free storage or download a backup before continuing."); }
                checkpointRef.current = { ...checkpointRef.current, [source]: event.checkpoint };
                setCheckpoints(checkpointRef.current);
              } else if (event.album) { const operation = libraryStorage.saveAlbum(event.album); persist(operation); await operation; }
            }
          }
          if (chunk.done) break;
        }
        if (!complete) throw new Error("Import connection closed early. Try again to finish loading.");
      } finally { await reader.cancel(); reader.releaseLock(); }
    }).catch(error => { releaseImport(); if (!controller.signal.aborted && !timedOut) { setRetryAt(null); setError(error.message); } }).finally(() => { clearTimeout(timer); clearInterval(watchdog); releaseImport(); });
    return () => { clearTimeout(timer); clearInterval(watchdog); controller.abort(); releaseImport(); };
  }, [connected, attempt, source, storageReady, apiFetch, libraryStorage]);
  return <>
    <nav className="cabinet-navigation" aria-label="Cabinet navigation">{settings ? <CabinetLink href="/">← Back to records</CabinetLink> : <CabinetLink href="/settings">Library & settings</CabinetLink>}</nav>
    {settings && <header className="settings-heading"><h1>Library & settings</h1><p>Add records, organize your library, and manage your account.</p></header>}
    {!settings && !connected && storageReady && !albums?.some(album => album.source !== "mock") && <FirstVisit onDemo={() => setShowDemo(true)} />}
    <ListeningGuide settings={settings} onStart={() => { setShowDemo(true); setTourSession(value => value + 1); window.history.pushState(null, "", "/?demo=1"); }} />
    {mobileSetup && <section className="library-message" role="alert"><h2>Spotify connection unavailable</h2><p>This address supports browsing, but Spotify sign-in needs Record Cabinet’s secure address restored.</p><p>Your saved records are still available.</p></section>}
    <div hidden={settings}>
    {(albums || showDemo) && <RecordBin key={showDemo ? `demo:${tourSession}` : "collection"} collection={showDemo ? demoCollection : albums!} genreEditing={!showDemo && !!albums?.some(album => album.source !== "mock") && storageReady && !saving && (progress.complete || !!error)} onGenreUpdate={updates => { const next = mergeAlbums(latestAlbums.current ?? [], updates); latestAlbums.current = next; setAlbums(next); }} />}
    {!settings && (error || storageError) && <section className="library-message" role="alert"><p>{error || storageError}</p><CabinetLink href="/settings">Open library & settings</CabinetLink></section>}
    </div>
    {!settings && genreActivity && <p className="library-storage-status" role="status">{genreActivity} <CabinetLink href="/settings">Genre progress</CabinetLink></p>}
    <div hidden={!settings} className="settings-tools">
    <section className="settings-section" aria-labelledby="library-heading">
    <h2 id="library-heading">Library</h2>
    {connected && <section className="import-options" aria-label="Import albums">
      <label>Import from <select value={selectedSource} disabled={previewing || running.current} onChange={event => { setSelectedSource(event.target.value); setPreview(null); }}><option value="saved">Saved albums</option><option value="liked">Liked Songs</option>{selectedSource.startsWith("playlist:") && !playlists.some(playlist => `playlist:${playlist.id}` === selectedSource) && <option value={selectedSource}>Previously selected playlist</option>}{playlists.map(playlist => <option key={playlist.id} value={`playlist:${playlist.id}`}>{playlist.name}</option>)}</select></label>
      <button disabled={listing || !progress.complete && !error} onClick={loadPlaylists}>{listing ? "Loading playlists…" : "Load my playlists"}</button>
      <button disabled={previewing || !storageReady || saving || (!progress.complete && !error)} onClick={() => void startImport(selectedSource)}>{previewing ? "Checking playlist…" : checkpoints[selectedSource] ? "Continue import" : "Import new albums"}</button>
      {storageReady && !progress.complete && !error && <button onClick={() => { importController.current?.abort(); importController.current = null; running.current = false; setRetryAt(null); setError("Import stopped. Your loaded albums are still available."); }}>Stop import</button>}
      <p role="status">{storageReady ? formatSavedPosition(checkpoints[selectedSource]) : "Checking saved import position…"} {albums?.filter(album => album.source === "spotify").length ?? 0} Spotify albums in this collection. Existing albums are skipped; import progress is saved automatically.</p>
      <details className="import-more"><summary>More import options</summary><div className="import-more-controls">
      <label>Batch size<select value={batchSize} disabled={!progress.complete && !error} onChange={event => setBatchSize(Number(event.target.value))}>{[50, 100, 250].map(size => <option key={size} value={size}>About {size} new albums</option>)}</select></label>
      {(checkpoints[selectedSource] || selectedSource.startsWith("playlist:")) && <button disabled={saving || (!progress.complete && !error)} onClick={() => startImport(selectedSource, true)}>Scan from beginning</button>}
      <label>Spotify playlist link<input value={playlistLink} onChange={event => setPlaylistLink(event.target.value)} placeholder="https://open.spotify.com/playlist/…" /></label>
      <button disabled={previewing || !storageReady || saving || (!progress.complete && !error) || !playlistLink.trim()} onClick={() => { try { const next = `playlist:${playlistId(playlistLink)}`; setSelectedSource(next); void startImport(next); } catch (error) { setPlaylistError((error as Error).message); } }}>Preview playlist link</button>
      </div></details>
      {preview && <div className="playlist-preview" role="region" aria-label="Confirm playlist import">
        <h2>Import from {preview.name}?</h2>
        <p><a href={`https://open.spotify.com/playlist/${preview.id}`} target="_blank" rel="noreferrer">Open this exact playlist in Spotify ↗</a>{preview.total !== null && ` · ${preview.total} playlist items`}</p>
        <p>Check these sample albums before adding anything. These are the releases attached to the playlist’s songs, including singles and compilations.</p>
        <ul>{preview.albums.map(album => <li key={album.id}><a href={`https://open.spotify.com/album/${album.id}`} target="_blank" rel="noreferrer">{album.title}</a> — {album.artist}</li>)}</ul>
        <button onClick={() => { confirmedPlaylist.current = preview; setSelectedSource(`playlist:${preview.id}`); runImport(`playlist:${preview.id}`, preview.fresh); setPreview(null); }}>Import this playlist</button>
        <button onClick={() => setPreview(null)}>Cancel</button>
      </div>}
      {playlistError && <p role="status">{playlistError} </p>}
    </section>}
    <p className="library-storage-status" role="status">{!storageReady ? "Restoring your collection…" : storageError || (saving ? "Saving albums to this browser…" : restored && attempt === 0 ? `Restored ${albums?.length ?? 0} albums. Import when you’re ready to add more.` : albums?.some(album => album.source !== "mock") ? "Collection saved in this browser." : "Imported albums will be saved in this browser.")}</p>
    {error && <section className="library-message" role="alert"><p>{error}</p>{connected && <button disabled={!storageReady || saving} onClick={() => startImport(source)}>Try again</button>} {(/session expired|sign-in|Reconnect Spotify once/.test(error)) && <a href="/api/spotify/login">Reconnect Spotify</a>}</section>}
    {connected && storageReady && attempt > 0 && !error && <section className="import-progress" aria-label="Library import">
      <div role="status" aria-live="polite"><strong>{retryAt ? <RetryStatus key={retryAt} retryAt={retryAt} deadline={retryDeadline} /> : progress.complete ? `${checkpoints[source] ? "Batch saved — continue when ready" : (unchanged ? "Playlist unchanged" : "Import complete")} · ${progress.loaded} new · ${progress.skipped} already saved` : progress.total === null ? progress.loaded || progress.skipped ? `Checking albums · ${progress.loaded} new · ${progress.skipped} already saved` : "Connecting to Spotify…" : `Checking albums · ${progress.loaded + progress.skipped} of ${progress.total}`}</strong><span>{retryAt ? "We’ll retry automatically from this point. Keep this page open; your records are safe to browse." : progress.complete ? "Pick a bin to start browsing." : `New albums: ${progress.loaded} · Already saved, skipped: ${progress.skipped}. You can browse while we finish.`}</span></div>
      {!progress.complete && <progress aria-label="Albums imported" max={progress.total || 1} value={progress.total === null ? undefined : progress.loaded + progress.skipped} />}
    </section>}
    {importRequests !== null && <p className="library-storage-status" role="status">This import used {importRequests} Spotify API requests, including retries. This is usage, not your remaining Spotify allowance.</p>}
    <ManualAlbum albums={albums ?? []} disabled={!storageReady || saving || (!progress.complete && !error)} onAdded={album => {
      const next = mergeAlbums((latestAlbums.current ?? []).filter(item => item.source !== "mock"), [album]);
      latestAlbums.current = next; setAlbums(next); setShowDemo(false);
    }} />
    <AutoGenres editingDisabled={!storageReady || !!storageError} importing={!progress.complete && !error} onActivity={setGenreActivity} albums={albums ?? []} connected={connected} disabled={!storageReady || saving || (!progress.complete && !error)} onUpdate={updates => {
      const next = mergeAlbums(latestAlbums.current ?? [], updates); latestAlbums.current = next; setAlbums(next);
    }} />
    {connected && !albums && !error && <div className="import-skeleton" aria-hidden="true">{[0, 1, 2, 3].map(i => <div key={i}><span /></div>)}</div>}
    </section>
    <section className="settings-section" aria-labelledby="organization-heading">
      <h2 id="organization-heading">Organization</h2>
      <p>Arrange records by artist, album or genre on the shelf, or create your own bins.</p>
      <button className="settings-action" disabled={!albums?.length} onClick={() => { window.dispatchEvent(new Event("record-cabinet-organize")); window.history.pushState(null, "", "/"); }}>Manage my systems</button>
    </section>
    <section className="settings-section" aria-labelledby="account-heading">
    <h2 id="account-heading">Account &amp; advanced</h2>
    <aside className="library-connection" aria-label="Spotify connection">
      <span>{connected ? "Your Spotify collection" : albums?.some(album => album.source !== "mock") ? "Your saved collection · Spotify disconnected" : "Browsing the demo collection"}</span>
      {connected ? <button disabled={saving || (!progress.complete && !error)} onClick={async () => { try { const response = await apiFetch("/api/spotify/logout", { method: "POST" }); if (response.ok) location.reload(); else setError("Sign-out could not complete. Reload and try again."); } catch { setError("Sign-out could not complete. Please try again."); } }}>Sign out</button> : <a href="/api/spotify/login">Connect Spotify ↗</a>}
    </aside>
    {connected && storageReady && <CloudLibrarySync disabled={saving || (!progress.complete && !error)} onUpdate={records => {
      latestAlbums.current = records;
      setAlbums(records);
      if (records.length) setRestored(true);
    }} />}
    <AccountTools connected={connected} disabled={!storageReady || saving || (!progress.complete && !error)} />
    <details className="settings-advanced"><summary>Advanced &amp; troubleshooting</summary>
    <div className="collection-mode"><button aria-pressed={showDemo} onClick={() => { setShowDemo(!showDemo); window.history.pushState(null, "", "/"); }}>{showDemo ? "Back to my collection" : "Listen to local demos"}</button><span>{showDemo ? "Local preview audio · no Spotify requests" : "You can test the player with local demo records."}</span></div>
    <RequestUsagePanel />
    {process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED === "true" && connected && <p className="library-storage-status">This test build keeps album browsing and listening history on this device for future discovery bins. It is not uploaded. Account and privacy can remove local data.</p>}
    <BetaTools connected={connected} storageReady={storageReady} storageError={!!storageError} importing={!progress.complete && !error} authError={authError} />
    {settings && process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED === "true" && connected && <EngagementDebug key={accountId} albums={albums ?? []} />}
    </details>
    <CollectionBackup albums={albums ?? []} disabled={!storageReady || saving || (!progress.complete && !error)} onRestore={next => { latestAlbums.current = next; setAlbums(next); setRestored(true); setShowDemo(false); }} />
    </section>
    </div>
  </>;
}
