"use client";
import { useDiscovery } from "./use-discovery";
import BinDividerTabs from "./bin-divider-tabs";
import { binStackDepth, binDividers, binPositionKey, rememberedAlbumIndex } from "./lib/bin-dividers";
import { useAccount } from "./account-context";

import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import Image from "next/image";
import type { Album } from "./data/types";
import { recentBin, getBins, type Arrangement, type Bin, type CustomSystem } from "./catalog";
import { albumNameKey, needsAlbumDetails, needsAvailabilityRefresh, spotifyLibraryId } from "./lib/spotify-export";
import { loadAlbumDetails } from "./lib/load-album-details";
import { createRecordShuffle } from "./lib/record-shuffle";
import { readDiggingPosition, resolveDiggingPosition, type DiggingPosition } from "./lib/digging-position";
import { readOrganization } from "./lib/collection-backup";
import DiscoveryActions from "./discovery-actions";
import BinOrganizer, { AlbumFiling } from "./bin-organizer";
import { shouldReturnRecord } from "./lib/bin-organization";
import { RECORD_STEP as STEP, recordReleaseTarget } from "./lib/bin-gesture";
import GenreEditor from "./genre-editor";
import SpotifyPlayer from "./spotify-player";
import { useEngagement } from "./use-engagement";
import { traceEngagement } from "./lib/engagement-debug";
import { useSpotifyPlayer } from "./use-spotify-player";
import { usePlayer } from "./use-player";
import styles from "./record-bin.module.css";

function subscribeDigging(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener("record-cabinet-digging", update);
  return () => { window.removeEventListener("storage", update); window.removeEventListener("record-cabinet-digging", update); };
}

function ShelfBinPreview({ bin, positionKey }: { bin: Bin; positionKey: string }) {
  const albumId = useSyncExternalStore(subscribeDigging, () => {
    try { return localStorage.getItem(positionKey); } catch { return null; }
  }, () => null);
  const start = rememberedAlbumIndex(bin.albums, albumId);
  const records = Array.from({ length: Math.min(3, bin.albums.length) }, (_, offset) => bin.albums[(start + offset) % bin.albums.length]);
  return <span className={styles.miniBin} aria-hidden="true"><span className={styles.miniBinBack} />{records.reverse().map((record, i, items) => <span key={record.id} data-album-id={record.id} className={`${styles.shelfSleeve} ${styles[record.color]}`} style={{ bottom: 39 + (items.length - 1 - i) * 12, transform: `rotate(${(items.length - 1 - i) * -3}deg)` }}>{record.artworkUrl ? <Image src={record.artworkUrl} alt="" fill unoptimized sizes="200px" className={styles.spotifyArtwork} /> : <><span>{record.title}</span><i>◉</i></>}</span>)}<span className={styles.miniBinFront}><span>{bin.label}</span></span></span>;
}

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function Sleeve({ album, index, position, stackPosition, returning, reduced, pulled, raised, flipped, onFlip, onLiftComplete, onFlipComplete }: { album: Album; index: number; position: MotionValue<number>; stackPosition: MotionValue<number>; returning: boolean; reduced: boolean; pulled: boolean; raised: boolean; flipped: boolean; onLiftComplete: () => void; onFlip: () => void; onFlipComplete: () => void }) {
  const backGesture = useRef<{ x: number; y: number; time: number; moved: boolean; canReturn: boolean; scrolled: boolean } | null>(null);
  function beginBackGesture(x: number, y: number, time: number, target: EventTarget) {
    const scroll = target instanceof Element ? target.closest(`.${styles.backTrackScroll}, .${styles.backTitle}`) : null;
    backGesture.current = { x, y, time, moved: false, canReturn: !scroll || scroll.scrollTop <= 0, scrolled: false };
  }
  function moveBackGesture(x: number, y: number) {
    const gesture = backGesture.current;
    if (gesture && Math.hypot(x - gesture.x, y - gesture.y) > 8) gesture.moved = true;
  }
  function endBackGesture(x: number, y: number, time: number) {
    const gesture = backGesture.current;
    if (!gesture) return;
    moveBackGesture(x, y);
    const dy = y - gesture.y;
    if (gesture.canReturn && !gesture.scrolled && shouldReturnRecord(x - gesture.x, dy, dy / Math.max(1, time - gesture.time) * 1000, false)) {
      gesture.moved = true;
      onFlip();
    }
  }
  // Lift clear of the lip before tipping forward; dragging back retraces the same arc.
  const y = useTransform(position, p => {
    const d = index - p;
    if (d >= 0) return -binStackDepth(d) * 23;
    if (reduced) return 0;
    const progress = Math.min(-d, 1);
    return progress < .3
      ? -44 * Math.sin(progress / .3 * Math.PI / 2)
      : -44 * Math.cos((progress - .3) / .7 * Math.PI / 2);
  });
  const rotateX = useTransform(position, p => reduced ? 0 : Math.max(0, Math.min(1, (p - index - .25) / .75)) * -78);
  const scale = useTransform(position, p => 1 - binStackDepth(index - p) * 0.035);
  const opacity = useTransform(position, p => Math.max(0, Math.min(1, (1 - (p - index)) / .4)));
  const zIndex = useTransform(() => {
    const p = position.get();
    const order = returning ? Math.floor(stackPosition.get()) : p;
    return p > index + .3 && p < index + 1 ? 55 : 40 - Math.round(binStackDepth(Math.abs(order - index)) * 4);
  });
  return <motion.div className={styles.sleeveLayer} style={{ zIndex: pulled ? 65 : zIndex }} animate={{ y: raised ? -185 : 0 }} onAnimationComplete={onLiftComplete} transition={reduced ? { duration: 0 } : !raised ? { duration: 0.32, ease: "easeInOut" } : { type: "spring", stiffness: 260, damping: 25 }} aria-hidden={!pulled || !flipped}><motion.div className={styles.sleeve} style={{ y, rotateX, scale, opacity, transformOrigin: pulled ? "center bottom" : "center calc(100% - 93px)" }}>
    <motion.div className={styles.sleeveFlip} animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.4, ease: "easeInOut" }} onAnimationComplete={onFlipComplete}>
    <div aria-hidden="true" className={`${styles.cover} ${styles.coverFace} ${styles[album.color]}`}>
      {album.artworkUrl ? <Image src={album.artworkUrl} alt="" fill unoptimized sizes="354px" className={styles.spotifyArtwork} /> : <>
      <div className={styles.coverTop}><span>{album.artist}</span><span>STEREO<br />33⅓ RPM</span></div>
      <strong className={styles.coverTitle}>{album.title}</strong>
      <div className={styles.art}><i /><i /><i /><i /><i /></div>
      <div className={styles.coverBottom}><span>LONG PLAY · {album.year}</span><span>{album.catalogNumber}</span></div>
      </>}
    </div>
    <div className={`${styles.cover} ${styles.coverFace} ${styles.backCover} ${pulled && flipped ? styles.activeBack : ""} ${styles[album.color]}`}
      onPointerDown={event => { if (event.pointerType !== "touch" && event.isPrimary && event.button === 0) { beginBackGesture(event.clientX, event.clientY, event.timeStamp, event.target); event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={event => { if (event.pointerType !== "touch") moveBackGesture(event.clientX, event.clientY); }}
      onPointerUp={event => { if (event.pointerType !== "touch") endBackGesture(event.clientX, event.clientY, event.timeStamp); }}
      onPointerCancel={event => { if (event.pointerType !== "touch") backGesture.current = null; }}
      onTouchStart={event => { if (event.touches.length === 1) { const touch = event.touches[0]; beginBackGesture(touch.clientX, touch.clientY, event.timeStamp, event.target); } else backGesture.current = null; }}
      onTouchMove={event => { if (event.touches.length === 1) moveBackGesture(event.touches[0].clientX, event.touches[0].clientY); else backGesture.current = null; }}
      onTouchEnd={event => { if (!event.touches.length && event.changedTouches.length === 1) { const touch = event.changedTouches[0]; endBackGesture(touch.clientX, touch.clientY, event.timeStamp); } }}
      onTouchCancel={() => { backGesture.current = null; }}
      onScrollCapture={() => { if (backGesture.current) { backGesture.current.scrolled = true; backGesture.current.moved = true; } }}
      onClick={() => { const gesture = backGesture.current; backGesture.current = null; if (gesture && !gesture.moved) onFlip(); }}>

      <div className={styles.coverTop}><span>{album.artist}</span><span>{album.catalogNumber}</span></div>
      <strong className={styles.backTitle}>{album.title}</strong>
      
      <p className={styles.backLabel}>THE TRACKS{album.tracks.some(track => track.duration > 0) && ` · ${formatDuration(album.tracks.reduce((total, track) => total + track.duration, 0))}`}</p>
      {pulled && flipped && <div className={styles.backTrackScroll} role="region" aria-label={`Full track list for ${album.title}`} tabIndex={0}>
        {needsAlbumDetails(album) && <p>Full track list loads when you play this album.</p>}
        <ol className={styles.backTracks}>{album.tracks.map((track, i) => <li key={track.id} className={track.playable === false ? styles.unavailableTrack : undefined}><span>{String(i + 1).padStart(2, "0")}</span><span>{track.title}{track.playable === false && <small> · Unavailable on Spotify</small>}</span></li>)}</ol>
      </div>}
      <div className={styles.coverBottom}><span>RECORD CABINET · {album.year}</span><span>33⅓ RPM · STEREO</span></div>
    </div>
    </motion.div>
  </motion.div></motion.div>;
}

export default function RecordBin({ collection, genreEditing, onGenreUpdate }: { collection: Album[]; genreEditing: boolean; onGenreUpdate: (updates: Album[]) => void }) {
  const { organizationKey, accountId, storage, apiFetch } = useAccount();
  const [index, setIndex] = useState(0);
  const [arrangement, setArrangement] = useState<Arrangement>("artist");
  const [genreBinCount, setGenreBinCount] = useState(0);
  const discovery = useDiscovery(collection);
  const [discoveryView, setDiscoveryView] = useState(false);
  const [selectedBin, setActiveBin] = useState<Bin | null>(null);
  // Membership removals, expiry and reset immediately retire an open generated view.
  // The player remains mounted independently below the cabinet browser.
  const activeBin = selectedBin?.id.startsWith("discovery:")
    ? discovery.bins.find(bin => bin.id === selectedBin.id && bin.albums.length > 0 && bin.albums.map(a => a.id).join() === selectedBin.albums.map(a => a.id).join()) ?? null
    : selectedBin;
  const remembered = useRef<Record<string, string>>({});
  const shelfScroll = useRef(0);
  const binButtons = useRef(new Map<string, HTMLButtonElement>());
  const binHeading = useRef<HTMLHeadingElement>(null);
  const [systems, setSystems] = useState<CustomSystem[]>([]);
  const [systemId, setSystemId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const diggingKey = `${organizationKey}:digging:${collection.some(album => album.source === "mock") ? "demo" : "library"}`;
  const savedDig = useSyncExternalStore(subscribeDigging, () => {
    try { return localStorage.getItem(diggingKey); } catch { return null; }
  }, () => null);
  const lastDig = readDiggingPosition(savedDig);
  const resumeDig = resolveDiggingPosition(lastDig, collection, systems);

  useEffect(() => {
    function restoreOrganization() {
      try { const saved = readOrganization(organizationKey); setGenreBinCount(saved.genreBinCount ?? 0); setSystems(saved.systems); setSystemId(saved.systemId); setArrangement(saved.arrangement === "all" ? "artist" : saved.arrangement); }
      catch { setStorageMessage("Saved organization could not be loaded."); }
    }
    restoreOrganization();
    window.addEventListener("record-cabinet-organization", restoreOrganization);
    return () => window.removeEventListener("record-cabinet-organization", restoreOrganization);
  }, [organizationKey]);
  function saveOrganization(nextSystems = systems, nextId = systemId, nextArrangement = arrangement, nextGenreBinCount = genreBinCount) {
    setDiscoveryView(false); setGenreBinCount(nextGenreBinCount); setSystems(nextSystems); setSystemId(nextId); setArrangement(nextArrangement);
    try { localStorage.setItem(organizationKey, JSON.stringify({ systems: nextSystems, systemId: nextId, arrangement: nextArrangement, genreBinCount: nextGenreBinCount })); window.dispatchEvent(new CustomEvent("record-cabinet-local-change", { detail: { scope: accountId } })); }
    catch { setStorageMessage("Changes are available for this visit, but this browser could not save them."); }
  }
  const system = systems.find(item => item.id === systemId);
  function createSystem(next: CustomSystem) { saveOrganization([...systems, next], next.id, activeBin ? arrangement : "custom"); }
  function updateSystem(next: CustomSystem) { saveOrganization(systems.map(item => item.id === next.id ? next : item)); }
  const libraryBins = useMemo(() => getBins(collection, arrangement, system, genreBinCount), [collection, arrangement, system, genreBinCount]);
  const bins = discoveryView && discovery.enabled ? discovery.bins : libraryBins;
  const allRecords = useMemo(() => getBins(collection, "all")[0], [collection]);
  const recentRecords = useMemo(() => recentBin(collection), [collection]);
  const randomPicker = useRef(createRecordShuffle());
  const albums = useMemo(() => { const currentAlbums = new Map(collection.map(album => [album.id, album])); return activeBin ? activeBin.albums.map(album => currentAlbums.get(album.id) ?? album) : collection; }, [activeBin, collection]);
  const dividers = useMemo(() => binDividers(albums, arrangement === "artist" && !activeBin?.id.startsWith("discovery:") && activeBin?.id !== "all" && activeBin?.id !== "recent"), [albums, arrangement, activeBin?.id]);
  const reduced = !!useReducedMotion();
  const wrap = (n: number) => albums.length ? ((n % albums.length) + albums.length) % albums.length : 0;
  const [pulled, setPulled] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [flipPhase, setFlipPhase] = useState<"idle" | "lifting" | "lowering" | "turning" | "returning" | "returning-front">("idle");
  // Retire invalid selections during reconciliation so they cannot reopen on a later read.
  if (selectedBin?.id.startsWith("discovery:") && !activeBin) {
    setActiveBin(null); setPulled(false); setFlipped(false); setFlipPhase("idle");
  }
  useEffect(() => {
    const current = activeBin?.albums[index];
    if (!current || flipPhase !== "idle") return;
    const binKey = binPositionKey(activeBin!.id, arrangement, systemId, genreBinCount);
    remembered.current[binKey] = current.id;
    try { localStorage.setItem(`${diggingKey}:bin:${binKey}`, current.id); window.dispatchEvent(new Event("record-cabinet-digging")); } catch { /* Retain the position for this visit. */ }
    // Discover remembers its own place without replacing Continue digging in the library.
    if (activeBin?.id.startsWith("discovery:")) return;
    const saved: DiggingPosition = { albumId: current.id, binId: activeBin!.id, arrangement, systemId, genreBinCount, opened: pulled, flipped };
    try { localStorage.setItem(diggingKey, JSON.stringify(saved)); window.dispatchEvent(new Event("record-cabinet-digging")); }
    catch { /* Browsing remains available if local persistence is blocked. */ }
  }, [activeBin, index, arrangement, systemId, genreBinCount, pulled, flipped, flipPhase, diggingKey]);

  const coverButton = useRef<HTMLButtonElement>(null);
  const position = useMotionValue(0);
  const sleevePosition = position;
  const [returningRecords, setReturningRecords] = useState(false);
  const settledPosition = useRef(0);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [sleeveIndex, setSleeveIndex] = useState(0);
  useMotionValueEvent(position, "change", value => {
    const backwards = value < (position.getPrevious() ?? value);
    setReturningRecords(backwards);
    setVisibleIndex(backwards ? Math.floor(value) : Math.round(value));
    setSleeveIndex(Math.round(value));
  });
  const gesture = useRef<{ id: number; x: number; y: number; start: number; lastY: number; time: number; velocity: number; moved: boolean; pulled: boolean } | null>(null);
  const suppressClick = useRef(false);
  const album = albums[index];
  const engagement = useEngagement();
  const inspectionPending = useRef<{ id: string; timestamp: number; albumId: string; inspect: ReturnType<typeof engagement.captureInspection> } | null>(null);
  const player = usePlayer();
  const spotifyPlayer = useSpotifyPlayer(() => player.stop(), engagement.sink);
  const [preferLocal, setPreferLocal] = useState(false);
  const [preparingAlbum, setPreparingAlbum] = useState(false);
  const [albumMessage, setAlbumMessage] = useState("");
  const preparation = useRef<AbortController | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);
  function cancelPreparation() { inspectionPending.current = null; preparation.current?.abort(); preparation.current = null; setPreparingAlbum(false); setAlbumMessage(""); }

  const hasRecord = preferLocal ? !!player.album : !!spotifyPlayer.album;
  const turntable = useRef<HTMLElement>(null);
  function revealPlayer() {
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1000px)").matches) turntable.current?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
    });
  }
  const availabilityAttempts = useRef(new Set<string>());
  async function playAlbum() {
    if (album.playback.kind === "none" || preparation.current) return;
    if (album.playback.kind === "spotify" || album.playback.kind === "spotify-pending") spotifyPlayer.activateFromGesture();
    let ready = album;
    const requiredDetails = needsAlbumDetails(album);
    if (requiredDetails || (needsAvailabilityRefresh(album) && !availabilityAttempts.current.has(album.id))) {
      availabilityAttempts.current.add(album.id);
      const controller = new AbortController(); preparation.current = controller;
      setPreparingAlbum(true); setAlbumMessage(requiredDetails ? "Loading this album’s cover and complete track list…" : "Checking which tracks Spotify can play…");
      try {
        const saved = await storage.load();
        const cached = saved.albums.find(item => item.playback.kind === "spotify" && !needsAlbumDetails(item) && !needsAvailabilityRefresh(item) && (item.id === album.id || spotifyLibraryId(item) === spotifyLibraryId(album) || (album.playback.kind === "spotify-pending" && albumNameKey(item) === albumNameKey(album))));
        const loaded = cached ?? await loadAlbumDetails(album, apiFetch, AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]), !requiredDetails);
        controller.signal.throwIfAborted();
        ready = await storage.saveAlbumDetails(album, await storage.prepareAlbumGenres(loaded));
        controller.signal.throwIfAborted();
        onGenreUpdate([ready]); setAlbumMessage("");
      } catch (error) {
        if (!controller.signal.aborted) setAlbumMessage(error instanceof Error ? error.message : "Album details could not load. Your saved record is safe; try again later.");
        if (requiredDetails || controller.signal.aborted) return;
        setAlbumMessage("Track availability could not refresh. Using your saved track list for now.");
      } finally { if (preparation.current === controller) { preparation.current = null; setPreparingAlbum(false); } }
    }
    if (ready.playback.kind === "spotify") {
      if (!ready.tracks.some(track => track.playable !== false && track.duration > 0)) { setAlbumMessage("Spotify has no playable tracks on this album for your account right now. Your record is still saved."); return; }
      player.stop(); setPreferLocal(false);
      await spotifyPlayer.start(ready); revealPlayer();
    } else if (ready.playback.kind === "local") {
      if (spotifyPlayer.state?.playing && !await spotifyPlayer.pause()) return;
      setPreferLocal(true); await player.start(ready); revealPlayer();
    }
  }

  useEffect(() => () => position.stop(), [position]);

  function openBin(bin: Bin, selectedIndex?: number, riffle = false) {
    cancelPreparation();
    if (!activeBin) shelfScroll.current = window.scrollY;
    if (!bin.albums.length) return;
    const binKey = binPositionKey(bin.id, arrangement, systemId, genreBinCount);
    let albumId = remembered.current[binKey];
    try { albumId = localStorage.getItem(`${diggingKey}:bin:${binKey}`) ?? albumId; } catch { /* Use the in-memory position. */ }
    const next = Math.max(0, Math.min(selectedIndex ?? rememberedAlbumIndex(bin.albums, albumId), bin.albums.length - 1));
    position.stop();
    gesture.current = null;
    const flyThrough = riffle && !reduced && bin.albums.length > 1;
    const distance = Math.min(24, bin.albums.length - 1);
    position.jump(flyThrough ? next - distance : next);
    setReturningRecords(false);
    settledPosition.current = next;
    setIndex(next);
    setPulled(false);
    setFlipped(false);
    setFlipPhase("idle");
    setActiveBin(bin);
    if (flyThrough) animate(position, next, { duration: 1.45, ease: [.3, 0, .15, 1] });
    requestAnimationFrame(() => {
      const target = selectedIndex !== undefined ? coverButton.current : binHeading.current;
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      if (bounds.top < 24 || bounds.bottom > window.innerHeight - 24) {
        target.scrollIntoView({ behavior: "instant", block: selectedIndex !== undefined ? "center" : "start" });
      }
      target.focus({ preventScroll: true });
    });
  }

  function continueDigging() {
    if (!lastDig || !resumeDig) return;
    saveOrganization(systems, lastDig.systemId, lastDig.arrangement === "all" ? "artist" : lastDig.arrangement, lastDig.genreBinCount);
    openBin(resumeDig.bin, resumeDig.index);
    setPulled(lastDig.opened);
    setFlipped(false);
    setFlipPhase(lastDig.opened ? "lifting" : "idle");
  }

  function randomRecord() {
    if (!activeBin && discoveryView) {
      const id = randomPicker.current(discovery.bins.flatMap(bin => bin.albums.map(record => record.id)));
      const bin = discovery.bins.find(bin => bin.albums.some(record => record.id === id));
      if (bin) openBin(bin, bin.albums.findIndex(record => record.id === id), true);
      return;
    }
    const selection = activeBin ?? allRecords;
    if (!selection) return;
    const id = randomPicker.current(selection.albums.map(record => record.id), activeBin ? album?.id : undefined);
    if (!id) return;
    openBin(selection, selection.albums.findIndex(item => item.id === id), true);
  }

  function backToShelf() {
    cancelPreparation();
    if (!activeBin) return;
    const id = activeBin.id;
    remembered.current[binPositionKey(id, arrangement, systemId, genreBinCount)] = albums[index]?.id;
    position.stop();
    gesture.current = null;
    setPulled(false);
    setFlipped(false);
    setFlipPhase("idle");
    setActiveBin(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: shelfScroll.current, behavior: "instant" });
      binButtons.current.get(id)?.focus({ preventScroll: true });
    });
  }

  function finishReturn() {
    setFlipped(false);
    setFlipPhase("lowering");
  }

  function selectSleeve(timestamp: number) {
    inspectionPending.current = engagement.sink ? { id: crypto.randomUUID(), timestamp, albumId: album.id, inspect: engagement.captureInspection() } : null;
    if (inspectionPending.current) traceEngagement(accountId, "Sleeve opened", album.id, inspectionPending.current.id);
    setFlipped(false); setPulled(true); setFlipPhase("lifting");
  }
  const openOrganization = useEffectEvent(() => {
    backToShelf();
    saveOrganization(systems, systemId || systems[0]?.id || "", "custom");
    setEditorOpen(true);
  });
  useEffect(() => {
    const open = () => openOrganization();
    window.addEventListener("record-cabinet-organize", open);
    return () => window.removeEventListener("record-cabinet-organize", open);
  }, []);
  function captureInspection(ready: Album) {
    const pending = inspectionPending.current;
    if (!pending) return;
    // Unresolved export albums get the same deliberate interaction after hydration.
    if (ready.playback.kind === "spotify-pending") return;
    inspectionPending.current = null;
    pending.inspect(ready, pending.id, pending.timestamp);
  }
  function finishLift() {
    if (flipPhase === "lifting") {
      setFlipped(true);
      setFlipPhase("turning");
      captureInspection(album);
      void loadSleeveTracks();
    } else if (flipPhase === "lowering") {
      setPulled(false);
      setFlipPhase("idle");
      coverButton.current?.focus({ preventScroll: true });
    }
  }

  function returnRecord() {
    if (!pulled || flipPhase !== "idle") return;
    cancelPreparation();
    if (album.playback.kind === "none" || reduced) {
      setFlipped(false);
      setFlipPhase("returning-front");
    } else setFlipPhase("returning");
  }

  async function loadSleeveTracks() {
    if (!needsAlbumDetails(album) || preparation.current) return;
    const controller = new AbortController(); preparation.current = controller;
    setPreparingAlbum(true); setAlbumMessage("Loading the full track list…");
    try {
      const saved = await storage.load();
      const cached = saved.albums.find(item => item.playback.kind === "spotify" && !needsAlbumDetails(item) && (item.id === album.id || spotifyLibraryId(item) === spotifyLibraryId(album) || (album.playback.kind === "spotify-pending" && albumNameKey(item) === albumNameKey(album))));
      const loaded = cached ?? await loadAlbumDetails(album, apiFetch, AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]));
      controller.signal.throwIfAborted();
      const ready = await storage.saveAlbumDetails(album, await storage.prepareAlbumGenres(loaded));
      controller.signal.throwIfAborted();
      if (inspectionPending.current?.albumId === album.id) captureInspection(ready);
      onGenreUpdate([ready]); setAlbumMessage("");
    } catch (error) {
      if (!controller.signal.aborted) setAlbumMessage(error instanceof Error ? error.message : "The track list could not load. Your record is saved; try again later.");
    } finally {
      if (preparation.current === controller) { preparation.current = null; setPreparingAlbum(false); }
    }
  }

  function flipSleeve() {
    returnRecord();
  }

  function settle(next: number) {
    const target = albums.length > 1 ? next : 0;
    settledPosition.current = target;
    setIndex(wrap(target));
    position.stop();
    if (reduced) position.set(target);
    else animate(position, target, { duration: 0.42, ease: [0.22, 0.68, 0, 1] });
  }

  const browseWithKeyboard = useEffectEvent((event: KeyboardEvent) => {
    if (!activeBin || !albums.length || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || coverButton.current?.closest("[hidden]")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"], [role="region"][aria-label="Record player"]')) return;
    if (target !== coverButton.current && target.closest('button, a, summary, [role="button"]')) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (!pulled) settle(settledPosition.current + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.repeat || flipPhase !== "idle") return;
      if (pulled) returnRecord();
      else { position.jump(settledPosition.current); selectSleeve(performance.timeOrigin + event.timeStamp); }
    } else if (event.key === "Escape" && pulled) {
      event.preventDefault(); returnRecord();
    }
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => browseWithKeyboard(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    position.stop();
    suppressClick.current = false;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position.get(), lastY: event.clientY, time: event.timeStamp, velocity: 0, moved: false, pulled };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const delta = event.clientY - g.y;
    g.moved ||= Math.hypot(delta, event.clientX - g.x) > 8;
    const elapsed = event.timeStamp - g.time;
    if (elapsed > 0) g.velocity = (event.clientY - g.lastY) / elapsed * 1000;
    g.lastY = event.clientY;
    g.time = event.timeStamp;
    if (g.moved && !g.pulled) {
      const next = g.start + delta / STEP;
      position.set(albums.length > 1 ? next : 0);
      settledPosition.current = Math.round(position.get());
    }
  }

  function pointerEnd(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    suppressClick.current = g.moved || cancelled;
    if (g.pulled) {
      const velocity = event.timeStamp - g.time > 100 ? 0 : g.velocity;
      if (shouldReturnRecord(event.clientX - g.x, event.clientY - g.y, velocity, cancelled)) { suppressClick.current = true; returnRecord(); }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const velocity = event.timeStamp - g.time > 100 ? 0 : g.velocity;
    const target = g.moved || cancelled
      ? recordReleaseTarget(position.get(), velocity, albums.length, cancelled, true)
      : Math.round(position.get());
    settle(target);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <main data-tour-bin={activeBin?.id ?? ""} data-tour-index={index} data-tour-flipped={flipped && flipPhase === "idle"} data-tour-playing={preferLocal ? player.playing && player.album?.id === album?.id : spotifyPlayer.state?.playing && spotifyPlayer.album?.id === album?.id} className={`${styles.page} ${styles.integratedCabinet}`}>
    <header className={styles.header}><button onClick={backToShelf} aria-label="Record Cabinet shelf" className={styles.brand}><span className={styles.logo} aria-hidden="true">◉</span> record cabinet<span className={styles.brandDot}>®</span></button><span className={styles.edition}>A LITTLE OFFLINE FEELING.</span></header>
    <div className={`${styles.cabinetLayout} ${!hasRecord ? styles.browsingOnly : ""}`}><div className={styles.cabinetBrowser}>
    {!activeBin ? <>
      <section className={styles.intro}><p className={styles.eyebrow}><span /> YOUR RECORD COLLECTION</p><h1>A little world<br />of good records.</h1><p>Pick a bin. Find something worth sitting with.</p></section>
      <section className={styles.shelfSection} aria-label="Record shelf">
        <div className={styles.shelfToolbar}><span>ARRANGE BY</span><div role="group" aria-label="Arrange bins by">{discovery.enabled && <button aria-pressed={discoveryView} onClick={() => setDiscoveryView(true)}>Discover</button>}<button aria-pressed={!discoveryView && arrangement === "artist"} onClick={() => saveOrganization(systems, systemId, "artist")}>Artist</button><button aria-pressed={!discoveryView && arrangement === "album"} onClick={() => saveOrganization(systems, systemId, "album")}>Album</button><button aria-pressed={!discoveryView && arrangement === "genre"} onClick={() => saveOrganization(systems, systemId, "genre")}>Genre</button><button aria-pressed={!discoveryView && arrangement === "custom"} onClick={() => saveOrganization(systems, systemId || systems[0]?.id || "", "custom")}>My systems</button></div></div>
        {!discoveryView && arrangement === "genre" && <>
          <div className={styles.systemEditorBar}><label>Genre bins<select value={genreBinCount} onChange={event => saveOrganization(systems, systemId, arrangement, Number(event.target.value))}>
            <option value={0}>One bin per genre</option>
            {[1, 2, 3, 4, 5, 6].map(count => <option key={count} value={count}>{count === 1 ? "1 bin for all genres" : `Up to ${count} genre bins`}</option>)}
          </select></label></div>
          {genreBinCount > 0 && <p className={styles.shelfSummary}>Whole genres are grouped to balance bin sizes. Uncategorized stays separate.</p>}
          <GenreEditor albums={collection} disabled={!genreEditing} onUpdate={onGenreUpdate} />
        </>}
        {!discoveryView && arrangement === "custom" && <div className={styles.systemEditorBar}>
          {arrangement === "custom" && systems.length > 0 && !editorOpen && <label>System<select value={systemId} onChange={event => saveOrganization(systems, event.target.value, "custom")}>{systems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <button aria-expanded={editorOpen} aria-controls="system-editor" onClick={() => setEditorOpen(!editorOpen)}>{editorOpen ? "Done editing bins" : systems.length ? "Edit bins" : "Create your own bins"}</button>
        </div>}
        {!discoveryView && arrangement === "custom" && editorOpen && <div id="system-editor"><BinOrganizer collection={collection} systems={systems} systemId={systemId} onSelect={id => saveOrganization(systems, id, "custom")} onCreate={createSystem} onChange={updateSystem} /></div>}
        {discoveryView && discovery.enabled && <section aria-label="Discovery preparation" className={styles.discoveryControls}>
          <p>Small paths through your Spotify saved albums. Each set stays for seven days.</p>
          {process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED !== "true" && <p>History collection is off. These bins use only history already saved on this device.</p>}
          <button disabled={discovery.busy} onClick={() => void discovery.prepare()}>{discovery.current ? "Check saved albums" : discovery.progress.status === "partial" ? "Continue preparing bins" : "Prepare discovery bins"}</button>
          {process.env.NODE_ENV === "development" && <button disabled={discovery.busy} onClick={() => void discovery.regenerate()}>Regenerate discovery bins (local test)</button>}
          {discovery.busy && <button onClick={discovery.cancel}>Cancel</button>}
          <p role="status">{discovery.message}{discovery.progress.total > 0 && ` ${discovery.progress.checked} of ${discovery.progress.total} albums checked.`}</p>
          {discovery.expiresAt && <p>This set lasts until {new Date(discovery.expiresAt).toLocaleDateString()}.</p>}
        </section>}
        {storageMessage && <p role="status">{storageMessage}</p>}
        {!discoveryView && resumeDig && <button className={styles.continueDigging} onClick={continueDigging}><strong>Continue digging</strong><span>{resumeDig.album.title} · {resumeDig.bin.label}</span></button>}
        <div className={styles.shelfChoices}>
          <button data-tour-target="all" ref={node => { if (node) binButtons.current.set("all", node); else binButtons.current.delete("all"); }} disabled={!allRecords} onClick={() => allRecords && openBin(allRecords)} aria-label={`Open All records, ${allRecords?.albums.length ?? 0} ${(allRecords?.albums.length ?? 0) === 1 ? "record" : "records"}`}>All records</button>
          <button disabled={!recentRecords.albums.length} onClick={() => openBin(recentRecords)} aria-label={`Open Recently added, ${recentRecords.albums.length} records`}>Recently added</button>
          <button aria-label="Random record" disabled={discoveryView ? !discovery.bins.some(bin => bin.albums.length) : !allRecords} onClick={randomRecord}>Random record</button>
        </div>
        <p className={styles.shelfSummary} role="status">{collection.length} records · {bins.length} bins{!discoveryView && " · A–Z"}{!discoveryView && arrangement === "genre" ? " · Records can appear in more than one genre" : ""}</p>
        {collection.length === 0 && <p className={styles.armHelp}>Your shelf is empty. Saved albums will appear here.</p>}
        <div className={styles.shelfGrid}>
          {bins.map((bin) => <button key={bin.id} ref={(node) => { if (node) binButtons.current.set(bin.id, node); else binButtons.current.delete(bin.id); }} data-tour-target="bin" className={styles.shelfBin} disabled={!bin.albums.length} onClick={() => openBin(bin)} aria-label={`Open ${bin.label}, ${bin.albums.length} ${bin.albums.length === 1 ? "record" : "records"}`}>
            <ShelfBinPreview bin={bin} positionKey={`${diggingKey}:bin:${binPositionKey(bin.id, arrangement, systemId, genreBinCount)}`} />
            {discoveryView && "blurb" in bin && <span className={styles.discoveryBlurb}>{String(bin.blurb)}{!bin.albums.length && "empty" in bin && <span>{String(bin.empty)}</span>}</span>}
          </button>)}
        </div>
      </section>
    </> : <>
    <section className={styles.binIntro}><button className={styles.backToShelf} onClick={backToShelf}>← Back to shelf</button><button className={styles.randomRecord} onClick={randomRecord}>Random record</button><p className={styles.eyebrow}>{activeBin.id.startsWith("discovery:") ? "DISCOVER" : `${arrangement} / A–Z`}</p><h1 ref={binHeading} tabIndex={-1}>{activeBin.label}</h1><p>{albums.length === 1 ? "One good record. Take a closer look." : "Slow down. Dig a little. Find your next favorite."}</p></section>
    <section className={styles.collection} aria-label={`${activeBin.label} album bin`}>
      <div className={styles.binHeading}><span>{activeBin.label.toUpperCase()}</span><span>{albums.length} {albums.length === 1 ? "RECORD" : "RECORDS"}</span></div>
      <div className={styles.stage} onKeyDown={(event) => { if (event.key === "Escape" && pulled) returnRecord(); }}>
        <div className={styles.binBack}>

        </div>
        <div className={`${styles.stack} ${pulled ? styles.pulledStack : ""} ${flipPhase === "lowering" ? styles.returningStack : ""}`}>
      <BinDividerTabs key={`${arrangement}:${systemId}:${activeBin.id}`} sections={dividers} position={wrap(visibleIndex)} disabled={pulled} onSelect={next => { cancelPreparation(); position.stop(); gesture.current = null; position.jump(wrap(Math.round(position.get()))); settledPosition.current = next; setIndex(next); if (reduced) position.jump(next); else animate(position, next, { duration: Math.min(1.1, .42 + Math.abs(next - position.get()) * .017), ease: [.25, .1, .25, 1] }); }} />
          {pulled && album.playback.kind !== "none" && <motion.div key={`vinyl:${album.id}`} className={styles.peekRecordLayer} initial={{ y: 0 }} animate={{ y: flipPhase === "lowering" ? 0 : -185 }} transition={reduced ? { duration: 0 } : flipPhase === "lowering" ? { duration: 0.32, ease: "easeInOut" } : { type: "spring", stiffness: 260, damping: 25 }}>
            <motion.button data-tour-target="vinyl" type="button" className={styles.peekRecord} aria-label={`Play ${album.title} by tapping the vinyl`} title="Play this album" disabled={spotifyPlayer.busy || preparingAlbum || flipPhase !== "idle"} onClick={() => void playAlbum()}
              initial={{ x: reduced ? "0%" : "-109.375%" }} animate={{ x: flipPhase === "idle" ? "0%" : "-109.375%", opacity: flipPhase === "turning" || flipPhase === "returning-front" || flipPhase === "lifting" || flipPhase === "lowering" ? 0 : 1 }} transition={{ duration: reduced ? 0 : 0.22, ease: "easeInOut" }}
              onAnimationComplete={() => { if (flipPhase === "returning") { if (flipped) { setFlipPhase("returning-front"); setFlipped(false); } else finishReturn(); } }}>
              <span className={styles.peekVinyl} aria-hidden="true"><span className={`${styles.peekLabel} ${styles[album.color]}`}>{album.artworkUrl && <Image src={album.artworkUrl} alt="" fill unoptimized sizes="100px" />}</span></span>
            </motion.button>
          </motion.div>}
          {[...new Set([...Array.from({ length: albums.length > 1 ? 8 : albums.length }, (_, offset) => sleeveIndex - Math.min(2, albums.length - 1) + offset), ...dividers.filter(section => section.start > wrap(sleeveIndex)).slice(0, 2).flatMap(section => { const start = sleeveIndex - wrap(sleeveIndex) + section.start; return [start, start + 1]; })])].map(i => { const item = albums[wrap(i)]; return <Sleeve key={`${item.id}:${i}`} album={item} index={i} position={sleevePosition} stackPosition={position} returning={returningRecords} reduced={reduced} pulled={pulled && i === Math.round(position.get())} raised={pulled && flipPhase !== "lowering" && i === Math.round(position.get())} onLiftComplete={() => { if (pulled && i === Math.round(position.get())) finishLift(); }} flipped={pulled && flipped && i === Math.round(position.get())} onFlip={flipSleeve} onFlipComplete={() => { if (pulled && i === Math.round(position.get())) { if (flipPhase === "turning") setFlipPhase("idle"); else if (flipPhase === "returning-front") finishReturn(); } }} />; })}
          <motion.button data-tour-target="sleeve" ref={coverButton} style={{ zIndex: pulled ? 60 : 40 }} animate={{ y: pulled && flipPhase !== "lowering" ? -185 : 0 }} transition={reduced ? { duration: 0 } : flipPhase === "lowering" ? { duration: 0.32, ease: "easeInOut" } : { type: "spring", stiffness: 260, damping: 25 }} className={styles.touchSurface} aria-label={`${pulled ? flipped ? "Show front cover of" : "Show back cover and tracks of" : "Show back cover and tracks of"} ${album.title} by ${album.artist}`} aria-expanded={pulled} aria-controls="album-details" aria-describedby="gesture-help"
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={(e) => pointerEnd(e)} onPointerCancel={(e) => pointerEnd(e, true)} onLostPointerCapture={(e) => pointerEnd(e, true)}
            onClick={() => { if (!suppressClick.current) { settle(Math.round(position.get())); if (pulled) flipSleeve(); else { selectSleeve(Date.now()); } } suppressClick.current = false; }}
            onKeyDown={(e) => {

              if (e.key === "Escape" || (pulled && e.key === "ArrowDown")) { e.preventDefault(); returnRecord(); return; }
              if (!pulled && ["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                settle(e.key === "Home" ? 0 : e.key === "End" ? albums.length - 1 : settledPosition.current + (e.key === "ArrowDown" ? 1 : -1));
              }
            }} />
        </div>
        <div className={styles.binFront} style={{ zIndex: 50 }}><button type="button" className={styles.handle} onClick={backToShelf} aria-label="Return to shelf" /><span className={styles.binLabel}>GOOD RECORDS.<br />NO WRONG TURNS.</span><span className={styles.screwLeft}>⊕</span><span className={styles.screwRight}>⊕</span></div>
      </div>
      <div className={styles.controls}><button aria-label="Previous album" disabled={albums.length < 2 || pulled} onClick={() => settle(settledPosition.current - 1)}>←</button><p id="gesture-help">{pulled ? flipped ? "Tap or swipe down to put back · scroll for tracks" : "Opening the sleeve…" : albums.length === 1 ? "Tap the cover to see the tracks" : "Pull down to dig · ← / → to browse"}<span>{pulled ? album.playback.kind !== "none" ? "Tap the vinyl at the side to play" : "Tap the cover to flip · ↓ / Escape to put back" : "Tap, Enter or Space to open"}</span></p><button data-tour-target="browse" aria-label="Next album" disabled={albums.length < 2 || pulled} onClick={() => settle(settledPosition.current + 1)}>→</button></div>
      {albumMessage && <p role="status">{albumMessage}</p>}
      <div className={styles.albumInfo} aria-live="polite" aria-atomic="true"><p className={styles.eyebrow}>{album.genre} <span>·</span> {album.year}</p><h2>{album.title}</h2><p>{album.artist}</p><span className={styles.recordNumber}>{String(index + 1).padStart(2, "0")} <span>/ {String(albums.length).padStart(2, "0")}</span></span></div>
      {pulled && <section id="album-details" className={styles.details} aria-label={`${album.title} details`} onKeyDown={(event) => { if (event.key === "Escape") returnRecord(); }}>
        <p className={styles.eyebrow} role="status">{flipped ? "BACK COVER · THE TRACKS" : "FRONT COVER · ON THE RECORD"}</p>
        <p>{album.note}</p>
        {album.importOrigin && <p>Imported from {album.importOrigin.source.startsWith("playlist:") ? <a href={`https://open.spotify.com/playlist/${album.importOrigin.source.slice(9)}`} target="_blank" rel="noreferrer">Spotify playlist ↗</a> : album.importOrigin.source === "liked" ? "Liked Songs" : "Saved albums"}{album.importOrigin.trackId && <> · <a href={`https://open.spotify.com/track/${album.importOrigin.trackId}`} target="_blank" rel="noreferrer">Source song ↗</a></>}</p>}
        {album.externalUrl && <a className={styles.spotifyLink} href={album.externalUrl} target="_blank" rel="noreferrer">{album.playback.kind === "spotify-pending" ? "Open source song in Spotify ↗" : "Open album in Spotify ↗"}</a>}
        <p className={styles.previewNote}>{album.playback.kind === "none" ? "Manually added record · no audio attached." : album.playback.kind === "local" ? "A 30-second demo of the whole record, in order." : "A whole album, played here. Spotify Premium required."}</p>
        <div className={`${styles.albumTools} ${activeBin.id.startsWith("discovery:") ? styles.discoveryTools : ""}`}>
        {activeBin.id.startsWith("discovery:") ? <DiscoveryActions key={`${activeBin.id}:${album.id}`} album={album} systems={systems} feedback={discovery.feedback} busy={discovery.busy} onAction={destination => discovery.act(activeBin.id, album, destination)} onCreate={discovery.createSystem} /> : <AlbumFiling key={album.id} album={album} systems={systems} systemId={systemId} onSelect={id => saveOrganization(systems, id)} onChange={updateSystem} onCreate={createSystem} />}
        <GenreEditor key={`genres:${album.id}`} albums={collection} album={album} disabled={!genreEditing} onUpdate={onGenreUpdate} />
        </div>
        {storageMessage && <p role="status">{storageMessage}</p>}
        {flipped && needsAlbumDetails(album) && !preparingAlbum && albumMessage && <button onClick={() => void loadSleeveTracks()}>Retry track list</button>}
      </section>}
    </section>
    </>}
    </div>{hasRecord && <aside ref={turntable} className={styles.cabinetTurntable}><SpotifyPlayer player={spotifyPlayer} local={player} preferLocal={preferLocal} /></aside>}</div>
    <footer className={styles.footer}><span>CURATED BY CURIOSITY.</span><span>{collection.length} records. Endless good taste.</span></footer>

  </main>;
}
