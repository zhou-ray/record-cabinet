"use client";

import { useEffect, useRef, useState } from "react";

import type { Album } from "./data/types";

export type PlayableAlbum = Pick<Album, "id" | "title" | "artist" | "color" | "playback" | "artworkUrl">;

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const request = useRef(0);
  const selected = useRef<PlayableAlbum | null>(null);
  const [album, setAlbum] = useState<PlayableAlbum | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [volume, setVolumeState] = useState(.7);

  useEffect(() => {
    const audio = new Audio();
    audio.volume = .7;
    audio.preload = "metadata";
    audioRef.current = audio;
    const syncTime = () => setElapsed(audio.currentTime);
    const syncDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlaying = () => { setPlaying(true); setLoading(false); setError(""); };
    const onPause = () => { setPlaying(false); setLoading(false); };
    const onWaiting = () => setLoading(true);
    const onError = () => { setPlaying(false); setLoading(false); setError("This preview could not load. Start the record again to retry."); };
    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, []);

  async function start(next: PlayableAlbum | null = selected.current) {
    const audio = audioRef.current;
    if (!audio || !next) return;
    if (next.playback.kind !== "local") {
      setError("Spotify playback is not connected yet.");
      return;
    }
    audio.pause();
    if (selected.current?.id !== next.id || audio.error) {
      audio.src = next.playback.url;
      setDuration(0);
    }
    audio.currentTime = 0;
    selected.current = next;
    setAlbum(next);
    setElapsed(0);
    setPlaying(false);
    await play();
  }

  async function play() {
    const audio = audioRef.current;
    if (!audio || !selected.current) return;
    const token = ++request.current;
    if (audio.error) audio.load();
    if (audio.ended) audio.currentTime = 0;
    setError("");
    setLoading(true);
    try {
      await audio.play();
    } catch {
      if (request.current === token && audioRef.current === audio) {
        setLoading(false);
        setPlaying(false);
        setError("Playback could not start. Start the record again to retry.");
      }
    }
  }

  function pause() {
    request.current++; audioRef.current?.pause(); setPlaying(false); setLoading(false);
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    request.current++;
    audio.pause();
    audio.currentTime = 0;
    setElapsed(0);
    setLoading(false);
    setPlaying(false);
  }

  function eject() {
    stop();
    selected.current = null; setAlbum(null); setDuration(0); setError("");
    audioRef.current?.removeAttribute("src");
    audioRef.current?.load();
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
    setElapsed(audio.currentTime);
  }

  function setVolume(value: number) {
    if (!audioRef.current || !Number.isFinite(value)) return;
    audioRef.current.volume = Math.max(0, Math.min(1, value));
    setVolumeState(audioRef.current.volume);
  }
  return { album, playing, loading, elapsed, duration, error, volume, setVolume, start, play, pause, stop, eject, seek };
}
