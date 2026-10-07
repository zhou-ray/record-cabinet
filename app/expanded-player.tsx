"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { usePlayer } from "./use-player";
import styles from "./record-bin.module.css";

const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function ExpandedPlayer({ player }: { player: ReturnType<typeof usePlayer> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ id: number; start: number } | null>(null);
  const [cue, setCue] = useState<number | null>(null);
  const position = cue ?? player.elapsed;
  const angle = player.duration ? 20 + position / player.duration * 30 : 20;

  function move(event: PointerEvent<SVGGElement>) {
    if (gesture.current?.id !== event.pointerId || !svg.current) return;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const degrees = Math.atan2(270 - point.x, point.y - 40) * 180 / Math.PI;
    setCue(Math.max(0, Math.min(1, (degrees - 20) / 30)) * player.duration);
  }

  function finish(event: PointerEvent<SVGGElement>, cancel = false) {
    if (gesture.current?.id !== event.pointerId) return;
    if (!cancel && cue !== null) player.seek(cue);
    gesture.current = null;
    setCue(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!player.album) return null;
  return <>
    <button ref={trigger} className={styles.expandPlayer} onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">Expand player ↗</button>
    <dialog ref={dialog} className={styles.playerDialog} aria-labelledby="expanded-title" onClose={() => { gesture.current = null; setCue(null); trigger.current?.focus(); }}>
      <header className={styles.expandedHeader}><span>THE LISTENING ROOM / RC—01</span><button onClick={() => dialog.current?.close()} aria-label="Close expanded player">✕</button></header>
      <h2 id="expanded-title">{player.album.title}</h2><p className={styles.expandedArtist}>{player.album.artist}</p>
      <div className={styles.largeDeck}>
        <svg ref={svg} viewBox="0 0 320 300" className={styles.deckSvg} aria-label="Turntable with adjustable tonearm">
          <rect x="4" y="4" width="312" height="292" rx="8" fill="#353b32" />
          <g aria-hidden="true">
            <circle cx="145" cy="155" r="124" fill="#979b8e" />
            <circle cx="145" cy="155" r="119" fill="#191c18" />
            {Array.from({ length: 18 }, (_, i) => <circle key={i} cx="145" cy="155" r={48 + i * 4} fill="none" stroke="#363c32" strokeWidth="1" />)}
            <g className={styles.largeRecordLabel} style={{ animationPlayState: player.playing ? "running" : "paused" }}>
              <circle cx="145" cy="155" r="43" fill="#d4ad62" />
              <text x="145" y="141" textAnchor="middle" fill="#423621" fontSize="10">RECORD CABINET</text>
              <text x="145" y="173" textAnchor="middle" fill="#423621" fontSize="8">SIDE A · 33⅓</text>
            </g>
            <circle cx="145" cy="155" r="4" fill="#cdd0c6" />
          </g>
          <g role="slider" tabIndex={player.duration ? 0 : -1} aria-label="Tonearm position" aria-disabled={!player.duration} aria-valuemin={0} aria-valuemax={player.duration || 30} aria-valuenow={Math.floor(position)} aria-valuetext={`${time(position)} of ${time(player.duration)}`} aria-describedby="arm-help"
            transform={`rotate(${angle} 270 40)`} className={styles.armControl}
            onPointerDown={(event) => { if (!event.isPrimary || event.button !== 0 || !player.duration) return; gesture.current = { id: event.pointerId, start: player.elapsed }; setCue(player.elapsed); event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)}
            onKeyDown={(event) => {
              if (!player.duration) return;
              const offsets: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 5, PageDown: -5 };
              if (event.key in offsets || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                player.seek(event.key === "Home" ? 0 : event.key === "End" ? player.duration : player.elapsed + offsets[event.key]);
              }
            }}>
            <path d="M270 40 V230" stroke="transparent" strokeWidth="44" />
            <path d="M270 40 V230" stroke="#242920" strokeWidth="12" />
            <path d="M270 40 V230" stroke="#c6ccbe" strokeWidth="7" />
            <circle cx="270" cy="40" r="13" fill="#9ba18e" stroke="#626b59" strokeWidth="5" />
            <rect x="260" y="222" width="20" height="26" rx="3" fill="#dfd8b9" />
            <rect x="264" y="245" width="12" height="5" fill="#af5636" />
          </g>
        </svg>
        <span className={styles.largeDeckCaption}>BELT DRIVE · STEREO · RC—01</span>
      </div>
      <p id="arm-help" className={styles.armHelp}>Drag the arm inward to move ahead, outward to go back.<br />Or focus the arm and use the arrow keys.</p>
      <div className={styles.transport}><button disabled={player.playing || player.loading} onClick={() => void player.play()}>▶ Play</button><button onClick={() => { setCue(null); player.stop(); }}>■ Stop</button></div>
      <p className={styles.expandedTime}>{time(position)} / {time(player.duration)} · ALBUM DEMO</p>
      <p className={styles.armHelp} role="status">{cue !== null ? "Release to place the needle" : player.loading ? "Lowering the needle…" : player.playing ? "Playing the record" : "Press Play to lower the needle. Stop returns to the start."}</p>
      {player.error && <p role="alert" className={styles.playerError}>{player.error}</p>}
    </dialog>
  </>;
}
