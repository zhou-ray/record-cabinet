"use client";
import { ENGAGEMENT } from "./lib/engagement";
import type { EngagementSink } from "./lib/engagement-tracker";
import { recordPlaybackEvent } from "./lib/beta-diagnostics";
import { useAccount } from "./account-context";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Album } from "./data/types";
import type { PlaybackCommand, PlaybackState } from "./lib/spotify-playback";
import { albumCue, albumDuration, albumProgress, playbackTrackIndex, trackPlayable } from "./lib/album-timeline";
import { connectBrowserPlayer, type BrowserPlayback, type BrowserPlayer } from "./lib/spotify-browser";
import { createAlbumStop } from "./lib/album-stop";
import { playbackPosition } from "./lib/turntable";
import { pausePlayer, playerDeadline } from "./lib/pause-player";

export function useSpotifyPlayer(beforePlay?: () => void, engagement?: EngagementSink) {
  const { apiFetch } = useAccount();
  const [album, setAlbum] = useState<Album | null>(null);
  const selected = useRef<Album | null>(null);
  const [state, setState] = useState<PlaybackState | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [ended, setEnded] = useState(false);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [notice, setNotice] = useState("");
  const [volume, setVolumeState] = useState(.7);
  const volumeRef = useRef(.7);
  const inFlight = useRef(false);
  const sdk = useRef<{ player: BrowserPlayer; deviceId: string } | null>(null);
  const connection = useRef<Promise<{ player: BrowserPlayer; deviceId: string }> | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const connectionGeneration = useRef(0);
  const albumStop = useRef<ReturnType<typeof createAlbumStop> | null>(null);
  const completed = useRef(false);
  const preparing = useRef(false);
  const playbackErrors = useRef(0);
  const pendingSeek = useRef<{ position: number; until: number } | null>(null);
  const queuedCue = useRef<number | null>(null);
  const pausedUntil = useRef(0);
  const observationVersion = useRef(0);
  useEffect(() => () => { engagement?.end(); recordPlaybackEvent("player-unmounted"); connectionGeneration.current++; albumStop.current?.reset(null); lifecycle.current?.abort(); sdk.current?.player.disconnect(); sdk.current = null; connection.current = null; }, [engagement]);
  function observe(value: BrowserPlayback | null, checkEnd = true) {
    observationVersion.current++;
    if (preparing.current) { engagement?.interrupt(); return; }
    if (value && !value.paused && Date.now() < pausedUntil.current) return;
    const current = selected.current;
    if (pendingSeek.current) engagement?.interrupt();
    if (pendingSeek.current && current && value) {
      const index = playbackTrackIndex(current, value);
      const uri = index >= 0 ? current.tracks[index].id.replace(/^spotify:(?!track:)/, "spotify:track:") : null;
      const actual = albumProgress(current, uri, value.position / 1000);
      if (actual !== null && Math.abs(actual - pendingSeek.current.position) < 3) pendingSeek.current = null;
      else if (Date.now() < pendingSeek.current.until) return;
      else pendingSeek.current = null;
    }
    if (completed.current) {
      if (!value || value.paused || !current || playbackTrackIndex(current, value) < 0) return;
      // A genuine playing event must not remain trapped behind an old end latch.
      completed.current = false; setEnded(false); albumStop.current?.reset(current); setNotice("");
    }
    if (current) engagement?.observe(current, value);
    if (checkEnd) albumStop.current?.observe(value);
    if (completed.current) return;
    if (!value || !current) { setState(previous => previous ? { ...previous, playing: false } : null); return; }
    const track = value.track_window.current_track;
    const trackIndex = playbackTrackIndex(current, value);
    const matchedUri = trackIndex >= 0 ? current.tracks[trackIndex].id.replace(/^spotify:(?!track:)/, "spotify:track:") : null;
    const globalPosition = albumProgress(current, matchedUri, value.position / 1000);
    if (globalPosition !== null && queuedCue.current === null) { setPosition(globalPosition); setUpdatedAt(Date.now()); }
    setState({ playing: !value.paused, progress: value.position / 1000, duration: value.duration / 1000, track: track.name, trackUri: track.uri, albumUri: track.album.uri, externalUrl: current.externalUrl, device: sdk.current ? { id: sdk.current.deviceId, name: "This browser", type: "Computer", active: true, restricted: false } : null, disallowed: value.disallows ?? {} });
    if (globalPosition === null) setNotice("Spotify is playing a track we could not match. Pause remains available; put the record on again to resync.");
  }
  const recoverPlayback = useEffectEvent(async () => {
    const device = sdk.current;
    if (!device || !selected.current || inFlight.current) return;
    const version = observationVersion.current;
    try {
      const value = await playerDeadline(device.player.getCurrentState());
      if (lifecycle.current?.signal.aborted || sdk.current !== device || inFlight.current || version !== observationVersion.current) return;
      observe(value);
      setNotice(current => current === "Playback status could not refresh. Your record has not been stopped." ? "" : current);
      if (!value) {
        recordPlaybackEvent("status-missing"); setState(null);
        setNotice("Playback is unavailable in this browser. Press Play to reconnect your record.");
      }
    } catch {
      if (lifecycle.current?.signal.aborted || sdk.current !== device || inFlight.current || version !== observationVersion.current) return;
      // A failed background read says nothing about whether audio is playing.
      // Keep the SDK and transport state; later SDK events/focus checks recover it.
      engagement?.interrupt(); recordPlaybackEvent("status-timeout");
      setNotice("Playback status could not refresh. Your record has not been stopped.");
    }
  });
  useEffect(() => {
    let reading = false;
    const refresh = () => {
      if (reading || document.visibilityState !== "visible" || navigator.onLine === false) return;
      reading = true;
      void recoverPlayback().finally(() => { reading = false; });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const readingEngagement = useRef(false);
  const sampleEngagement = useEffectEvent(async () => {
    const device = sdk.current, current = selected.current, version = observationVersion.current;
    if (!engagement || !device || !current || preparing.current || inFlight.current || pendingSeek.current || readingEngagement.current) return;
    readingEngagement.current = true;
    try {
      const value = await playerDeadline(device.player.getCurrentState());
      if (device === sdk.current && current === selected.current && version === observationVersion.current && !inFlight.current && !preparing.current && !pendingSeek.current) engagement.observe(current, value);
    } catch { engagement.interrupt(); } finally { readingEngagement.current = false; }
  });
  useEffect(() => {
    if (!engagement) return;
    const timer = setInterval(() => { void sampleEngagement(); }, ENGAGEMENT.checkpointMs);
    return () => clearInterval(timer);
  }, [engagement]);
  async function browser() {
    if (sdk.current) return sdk.current;
    if (!connection.current) {
      if (!lifecycle.current || lifecycle.current.signal.aborted) lifecycle.current = new AbortController();
      const generation = ++connectionGeneration.current;
      connection.current = connectBrowserPlayer(value => { if (generation === connectionGeneration.current) observe(value); }, (message, needsReconnect, disconnected) => { if (generation !== connectionGeneration.current) return; engagement?.interrupt(); recordPlaybackEvent(disconnected ? "device-lost" : "sdk-error"); playbackErrors.current++; albumStop.current?.cancel(); setError(message); setState(current => current ? { ...current, playing: false } : current); if (needsReconnect) setReconnect(true); if (disconnected) { connectionGeneration.current++; sdk.current?.player.disconnect(); sdk.current = null; connection.current = null; setState(null); } }, lifecycle.current.signal, apiFetch, volumeRef.current).then(value => { if (generation !== connectionGeneration.current) { value.player.disconnect(); throw new Error("The browser player disconnected while connecting. Press Play to try again."); } sdk.current = value;
        albumStop.current = createAlbumStop(() => {
          engagement?.end(); completed.current = true; setEnded(true); queuedCue.current = null;
          setPosition(selected.current ? albumDuration(selected.current) : 0); setUpdatedAt(Date.now());
          setState(current => current ? { ...current, playing: false } : current);
          setNotice("The record has reached its end. Choose a record, or play this one again.");
          void playerDeadline(value.player.pause()).catch(() => {
            value.player.disconnect(); sdk.current = null; connection.current = null;
            setError("The player disconnected to stop playback at the end of the record. Press Play to reconnect.");
          });
        }, setTimeout, clearTimeout, async () => { const current = await playerDeadline(value.player.getCurrentState()); observe(current, false); return current; });
        return value; }).catch(error => { if (generation === connectionGeneration.current) connection.current = null; throw error; });
    }
    return connection.current;
  }
  async function command(body: PlaybackCommand) {
    const response = await apiFetch("/api/spotify/player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.any([lifecycle.current!.signal, AbortSignal.timeout(25000)]) });
    const data = await response.json();
    if (!response.ok) {
      if (data.reconnect) setReconnect(true);
      if (Number.isFinite(data.retryAt)) setRetryAt(data.retryAt);
      const deviceMissing = response.status === 404 && !["TRACK_NOT_PLAYABLE", "NON_PLAYABLE"].includes(data.reason);
      if (deviceMissing) {
        albumStop.current?.reset(null);
        const previous = sdk.current;
        connectionGeneration.current++;
        sdk.current = null; connection.current = null;
        previous?.player.disconnect(); setState(null);
      }
      throw Object.assign(new Error(data.error || "Spotify could not complete the request."), { reason: data.reason, deviceMissing });
    }
    setRetryAt(0);
  }
  async function run(task: () => Promise<void>, allowDuringCooldown = false) {
    if (inFlight.current || (!allowDuringCooldown && Date.now() < retryAt)) return false;
    observationVersion.current++; // Invalidate foreground reads started before this command.
    inFlight.current = true; setBusy(true); setError(""); setReconnect(false); setNotice("");
    try { await task(); return true; }
    catch (error) { if (!lifecycle.current?.signal.aborted) setError(error instanceof Error ? error.message : "Playback could not continue. Please try again."); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function playAt(current: Album, seconds: number) {
    albumStop.current?.reset(null);
    const device = await browser();
    let cue = albumCue(current, seconds);
    if (cue.trackIndex < 0) throw new Error("Spotify has no playable tracks on this album for your account right now. Choose another record.");
    const errorVersion = playbackErrors.current;
    for (let attempt = 0; ; attempt++) {
      try {
        await command({ action: "play", albumUri: current.playback.kind === "spotify" ? current.playback.uri : "", trackIndex: cue.trackIndex, positionMs: cue.positionMs, deviceId: device.deviceId });
        break;
      } catch (failure) {
        // Only a confirmed unavailable-track response permits another play.
        // Timeouts, quota limits, Premium/account errors never trigger skips.
        if (!(failure instanceof Error) || !("reason" in failure) || !["TRACK_NOT_PLAYABLE", "NON_PLAYABLE"].includes(String(failure.reason))) throw failure;
        const failedIndex = cue.trackIndex;
        current = { ...current, tracks: current.tracks.map((track, index) => index === failedIndex ? { ...track, playable: false } : track) };
        selected.current = current; setAlbum(current);
        const nextIndex = current.tracks.findIndex((track, index) => index > failedIndex && trackPlayable(track));
        if (nextIndex < 0 || attempt >= 2) throw new Error("Spotify could not play the remaining tracks from this point. Choose another record or place the needle earlier.");
        const nextPosition = albumDuration({ tracks: current.tracks.slice(0, nextIndex) });
        cue = albumCue(current, nextPosition);
        pendingSeek.current = null;
      }
    }
    if (errorVersion !== playbackErrors.current) throw new Error("Playback was interrupted. Press Play record to try again.");
    completed.current = false; setEnded(false); albumStop.current?.reset(current);
    queuedCue.current = null; setPosition(cue.position); setUpdatedAt(Date.now());
    const track = current.tracks[cue.trackIndex];
    albumStop.current?.observe({ paused: false, position: cue.positionMs, duration: (track?.duration ?? 0) * 1000, track_window: { current_track: { uri: track?.id.replace(/^spotify:(?!track:)/, "spotify:track:") ?? "", name: track?.title ?? "", album: { uri: "" } } } });
    setState({ playing: true, progress: cue.positionMs / 1000, duration: track?.duration ?? 0, track: track?.title ?? null, trackUri: track?.id.replace(/^spotify:(?!track:)/, "spotify:track:") ?? null, albumUri: current.playback.kind === "spotify" ? current.playback.uri : null, externalUrl: current.externalUrl, device: { id: device.deviceId, name: "This browser", type: "Computer", active: true, restricted: false }, disallowed: {} });
  }
  async function reconnectRecord(current: Album, seconds: number) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const device = await browser();
        await playerDeadline(device.player.activateElement());
        await command({ action: "transfer", deviceId: device.deviceId });
        await command({ action: "shuffle-off", deviceId: device.deviceId });
        await command({ action: "repeat-off", deviceId: device.deviceId });
        await playAt(current, seconds);
        setNotice("");
        return;
      } catch (failure) {
        // A rejected device command is safe to retry once with a new SDK device.
        // Never replay a command whose result is unknown (timeout/network error).
        if (attempt || !(failure instanceof Error) || !("deviceMissing" in failure) || !failure.deviceMissing) throw failure;
        setNotice("Reconnecting the browser player…");
      }
    }
  }
  async function prepare() {
    return run(async () => {
      const device = await browser(); await playerDeadline(device.player.activateElement());
      setNotice("Player connected. Choose a record when you’re ready.");
    });
  }
  // Call directly in the vinyl click handler, before album/cache/network awaits.
  // A not-yet-connected SDK still needs its normal first-connection path.
  function activateFromGesture() {
    void sdk.current?.player.activateElement().catch(() => {});
  }
  async function start(next: Album) {
    recordPlaybackEvent("starting");
    if (next.playback.kind !== "spotify" || !next.tracks.length || inFlight.current || Date.now() < retryAt) return false;
    if (albumDuration(next) <= 0) { setError("Spotify has no playable tracks on this album for your account right now. Choose another record."); return false; }
    engagement?.begin(next);
    pausedUntil.current = 0;
    albumStop.current?.reset(null); completed.current = false; setEnded(false);
    pendingSeek.current = null;
    selected.current = next; setAlbum(next); queuedCue.current = null;
    setState(null); setPosition(0); setUpdatedAt(Date.now()); preparing.current = true;
    activateFromGesture();
    try {
      const succeeded = await run(async () => { beforePlay?.(); await reconnectRecord(next, 0); });
      if (!succeeded) engagement?.end();
      return succeeded;
    } finally { preparing.current = false; }
  }
  async function pause() {
    engagement?.interrupt();
    recordPlaybackEvent("pause-request");
    return run(async () => {
      const device = await browser();
      pendingSeek.current = null;
      const confirmed = await pausePlayer(device.player, () => command({ action: "pause", deviceId: device.deviceId }));
      pausedUntil.current = Date.now() + 2000;
      albumStop.current?.cancel();
      if (confirmed) observe(confirmed, false);
      else setPosition(playbackPosition(position, album ? albumDuration(album) : 0, !!state?.playing, updatedAt, Date.now()));
      setUpdatedAt(Date.now()); setState(current => current ? { ...current, playing: false } : current);
    }, true);
  }
  async function eject() {
    return run(async () => {
      // Keep the sleeve visible if pausing fails, so the listener can retry.
      if (sdk.current) await playerDeadline(sdk.current.player.pause());
      albumStop.current?.reset(null); completed.current = false; setEnded(false);
      pendingSeek.current = null;
      engagement?.end();
      selected.current = null; queuedCue.current = null;
      setAlbum(null); setState(null); setPosition(0); setUpdatedAt(0);
    }, true);
  }
  async function resume() {
    recordPlaybackEvent("resume-request");
    void sdk.current?.player.activateElement().catch(() => {});
    return run(async () => {
      pausedUntil.current = 0;
      if (selected.current) engagement?.resume(selected.current);
      beforePlay?.();
      if ((!sdk.current || !state) && selected.current) {
        preparing.current = true;
        try { await reconnectRecord(selected.current, queuedCue.current ?? (completed.current ? 0 : position)); }
        finally { preparing.current = false; }
        return;
      }
      const device = await browser(); await playerDeadline(device.player.activateElement());
      if (queuedCue.current !== null && selected.current) await playAt(selected.current, queuedCue.current);
      else { await playerDeadline(device.player.resume()); setUpdatedAt(Date.now()); setState(current => current ? { ...current, playing: true } : current); observe(await playerDeadline(device.player.getCurrentState())); }
    });
  }
  async function refresh() { return run(async () => { const device = await browser(); observe(await playerDeadline(device.player.getCurrentState())); }, true); }
  async function seek(seconds: number) {
    engagement?.interrupt();
    recordPlaybackEvent("seek-request");
    if (!album || !Number.isFinite(seconds)) return;
    const cue = albumCue(album, seconds);
    if (cue.trackIndex < 0) { setError("There are no playable tracks to place the needle on."); return false; }
    if (!state?.playing) {
      completed.current = false; setEnded(false); albumStop.current?.reset(album);
      queuedCue.current = cue.position; setPosition(cue.position); setUpdatedAt(Date.now()); setNotice("Needle placed. Press Play record when you’re ready."); return;
    }
    if (inFlight.current || Date.now() < retryAt) return false;
    // Adopt the released position before awaiting Spotify. Older SDK events
    // must not pull the arm back while the seek command is being applied.
    pendingSeek.current = { position: cue.position, until: Infinity };
    albumStop.current?.cancel();
    setPosition(cue.position); setUpdatedAt(Date.now());
    const succeeded = await run(async () => {
      const device = await browser();
      const current = await playerDeadline(device.player.getCurrentState());
      if (current && playbackTrackIndex(album, current) === cue.trackIndex) {
        await playerDeadline(device.player.seek(cue.positionMs));
        observe(await playerDeadline(device.player.getCurrentState()));
      } else await playAt(album, cue.position);
    });
    if (succeeded && pendingSeek.current) pendingSeek.current.until = Date.now() + 10000;
    if (!succeeded) {
      pendingSeek.current = null;
      // A rejected seek returns to confirmed playback, rather than pretending
      // the record moved. Preserve the command error so the listener can retry.
      const actual = await (sdk.current ? playerDeadline(sdk.current.player.getCurrentState()).catch(() => null) : null);
      if (actual) observe(actual);
    }
    return succeeded;
  }
  async function restart() {
    const current = selected.current;
    if (!current) return false;
    engagement?.begin(current);
    if (!sdk.current || !state) return start(current);
    void sdk.current.player.activateElement().catch(() => {});
    return run(async () => {
      pausedUntil.current = 0;
      preparing.current = true; pendingSeek.current = null;
      try { beforePlay?.(); await playerDeadline(sdk.current!.player.activateElement()); await playAt(current, 0); }
      catch (error) {
        preparing.current = false; albumStop.current?.reset(current);
        observe(await (sdk.current ? playerDeadline(sdk.current.player.getCurrentState()).catch(() => null) : null) ?? null);
        throw error;
      } finally { preparing.current = false; }
    });
  }
  async function setVolume(value: number) {
    if (!Number.isFinite(value) || !sdk.current) return false;
    return run(async () => {
      const next = Math.max(0, Math.min(1, value)), previous = volumeRef.current;
      setVolumeState(next);
      try { await playerDeadline(sdk.current!.player.setVolume(next)); volumeRef.current = next; }
      catch { setVolumeState(previous); throw new Error("Volume could not change. Try again or use your device’s volume controls."); }
    }, true);
  }
  return { album, state, ended, updatedAt, position, busy, error, reconnect, retryAt, notice, volume, setVolume, restart, prepare, activateFromGesture, start, pause, eject, resume, refresh, seek };
}
