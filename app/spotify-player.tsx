"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { useSpotifyPlayer } from "./use-spotify-player";
import type { usePlayer } from "./use-player";
import { useAccount } from "./account-context";
import TurntableDeck from "./turntable-deck";
import { albumDuration } from "./lib/album-timeline";
import { playbackPosition } from "./lib/turntable";
import styles from "./record-bin.module.css";
import { recordDiagnostic, setPlaybackSnapshot } from "./lib/beta-diagnostics";
import { useSystemPlayer } from "./use-system-player";
const volumeQuery = "(min-width: 601px) and (pointer: fine)";
function subscribeVolume(callback: () => void) { const media = matchMedia(volumeQuery); media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); }
function desktopVolume() { return matchMedia(volumeQuery).matches && !(/iPad|iPhone|iPod/.test(navigator.userAgent) || /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); }

export default function SpotifyPlayer({ player, local, preferLocal }: { player: ReturnType<typeof useSpotifyPlayer>; local: ReturnType<typeof usePlayer>; preferLocal: boolean }) {
  const volumeAvailable = useSyncExternalStore(subscribeVolume, desktopVolume, () => false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!player.retryAt && !player.state?.playing) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [player.retryAt, player.state?.playing]);
  const { storage, accountId } = useAccount();
  const firstPlay = useRef(false);
  const album = preferLocal ? local.album : player.album;
  const blocked = preferLocal ? local.loading : player.busy || now < player.retryAt;
  const duration = preferLocal ? local.duration : player.album ? albumDuration(player.album) : 0;
  const playing = preferLocal ? local.playing : !!player.state?.playing;
  const position = preferLocal ? local.elapsed : playbackPosition(player.position, duration, playing, player.updatedAt, Math.max(now, player.updatedAt));
  const ended = preferLocal ? duration > 0 && position >= duration : player.ended;
  useEffect(() => { setPlaybackSnapshot({ source: album ? preferLocal ? "local" : "spotify" : "none", playing, busy: blocked, ended, positionSeconds: position, durationSeconds: duration }); }, [album, preferLocal, playing, blocked, ended, position, duration]);
  useEffect(() => {
    if (!playing || firstPlay.current) return;
    firstPlay.current = true;
    void storage.finishListeningGuide().then(() => window.dispatchEvent(new CustomEvent("record-cabinet-first-play", { detail: { scope: accountId } }))).catch(() => { firstPlay.current = false; });
  }, [playing, storage, accountId]);
  useEffect(() => () => setPlaybackSnapshot({ source: "none", playing: false, busy: false, ended: false, positionSeconds: 0, durationSeconds: 0 }), []);
  const error = preferLocal ? local.error : player.error;
  useEffect(() => { if (error) recordDiagnostic("playback", 0, error); }, [error]);
  const transportBlocked = (preferLocal ? blocked : player.busy || (!playing && now < player.retryAt)) || (!preferLocal && !!(playing ? player.state?.disallowed.pausing : (!ended && player.state?.disallowed.resuming)));
  const togglePlayback = () => {
        if (preferLocal) { if (playing) local.pause(); else void local.play(); }
        else if (ended || !player.state) void player.start(player.album!);
        else if (playing) void player.pause(); else void player.resume();
      };
  useSystemPlayer(album, playing && !ended, duration, position, {
    play: () => { if (preferLocal) void local.play(); else if (ended || !player.state) void player.start(player.album!); else void player.resume(); },
    pause: () => { if (preferLocal) local.pause(); else void player.pause(); },
    seek: seconds => { if (preferLocal) local.seek(seconds); else void player.seek(seconds); },
    position: () => preferLocal ? local.elapsed : playbackPosition(player.position, duration, playing, player.updatedAt, Date.now()),
    canPlay: () => !!album && !playing && !transportBlocked,
    canPause: () => playing && !transportBlocked,
    canSeek: () => !!album && !blocked && (preferLocal || !player.state?.disallowed.seeking),
  });
  return <section className={styles.spotifyPlayer} aria-label="Record player">
    <div className={styles.spotifyPlayerHeader}><div><p className={styles.eyebrow}>ON THE TURNTABLE</p><h2>{album?.title ?? "Room for a record."}</h2><p>{album?.artist ?? "Pick an album from your cabinet and put it on."}</p></div></div>
    <TurntableDeck key={album?.id ?? "empty"} title={album?.title ?? "Your next good record"} artist={album?.artist ?? "Record Cabinet"} artworkUrl={album?.artworkUrl} onTogglePlayback={togglePlayback} transportDisabled={transportBlocked || !album} duration={duration} position={position} playing={playing && !ended} disabled={blocked || !album || (!preferLocal && !ended && !!player.state?.disallowed.seeking)} empty={!album} onSeek={seconds => { if (preferLocal) local.seek(seconds); else void player.seek(seconds); }}
      volumeAvailable={volumeAvailable} volume={preferLocal ? local.volume : player.volume} volumeDisabled={!album || (preferLocal ? local.loading : player.busy)} onVolume={value => { if (preferLocal) local.setVolume(value); else void player.setVolume(value); }} />
    {player.album && !preferLocal && player.album.tracks.some(track => track.playable === false) && <p role="status">Spotify cannot play {player.album.tracks.filter(track => track.playable === false).length} tracks on this record right now. Playback and the needle skip unavailable tracks.</p>}
    {!album && !preferLocal && <button disabled={blocked} onClick={() => void player.prepare()}>Prepare Spotify player</button>}
    <p className={styles.listeningSubtitle}>{ended ? "The record has reached its end." : album ? preferLocal ? "Local demo recording · no Spotify requests." : "The whole album, from the outside groove to the center." : "No shuffle. No rush."}</p>
    {album && !preferLocal && <details className={styles.playerConnections}><summary>Playback connection</summary><p>Spotify plays here in your browser. Premium is required.</p>{player.album?.externalUrl && <p><a href={player.album.externalUrl} target="_blank" rel="noreferrer">Album on Spotify ↗</a></p>}</details>}
    {blocked && <p role="status">{!preferLocal && now < player.retryAt ? `Spotify needs a pause until ${new Date(player.retryAt).toLocaleString()}.` : "Getting the record ready…"}</p>}
    {!preferLocal && player.notice && <p role="status">{player.notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!preferLocal && player.reconnect && <a href="/api/spotify/login">Connect Spotify for in-app playback ↗</a>}
  </section>;
}
