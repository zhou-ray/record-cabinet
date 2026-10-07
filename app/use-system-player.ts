"use client";
import { useEffect, useRef } from "react";
import { installMediaControls, updateSystemPosition, type SystemPlayback } from "./lib/media-session";
export function useSystemPlayer(album: { id: string; title: string; artist: string; artworkUrl: string | null } | null, playing: boolean, duration: number, position: number, controls: SystemPlayback) {
  const latest = useRef(controls);
  useEffect(() => { latest.current = controls; }, [controls]);
  const id = album?.id, title = album?.title, artist = album?.artist, artwork = album?.artworkUrl;
  useEffect(() => {
    if (!id || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const remove = installMediaControls(session, {
      play: () => latest.current.play(), pause: () => latest.current.pause(), seek: value => latest.current.seek(value), position: () => latest.current.position(),
      canPlay: () => latest.current.canPlay(), canPause: () => latest.current.canPause(), canSeek: () => latest.current.canSeek(),
    });
    return () => { remove(); session.metadata = null; session.playbackState = "none"; updateSystemPosition(session, 0, 0); };
  }, [id]);
  useEffect(() => {
    if (!id || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    const publish = () => {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: title, artwork: artwork ? [{ src: artwork }] : [] }); }
      catch { navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: title }); }
    };
    publish();
    window.addEventListener("pageshow", publish);
    document.addEventListener("visibilitychange", publish);
    return () => { window.removeEventListener("pageshow", publish); document.removeEventListener("visibilitychange", publish); };
  }, [id, title, artist, artwork, playing]);
  useEffect(() => {
    if (!id || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    updateSystemPosition(navigator.mediaSession, duration, position);
  }, [id, playing, duration, position]);
}
