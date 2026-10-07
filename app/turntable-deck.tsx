"use client";
import { useId, useRef, useState, type PointerEvent } from "react";
import { ARM, clampPosition, pointToPosition, positionToAngle } from "./lib/turntable";
import styles from "./record-bin.module.css";
const seekKeys: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };

export default function TurntableDeck({ title, artist, duration, position, playing, disabled, empty = false, artworkUrl, transportDisabled, onTogglePlayback, onSeek, volumeAvailable, volume, volumeDisabled, onVolume }: {
  title: string; artist: string; duration: number; position: number; playing: boolean; disabled: boolean; empty?: boolean; artworkUrl?: string | null; transportDisabled: boolean; onTogglePlayback: () => void; onSeek: (seconds: number) => void;
  volumeAvailable: boolean; volume: number; volumeDisabled: boolean; onVolume: (value: number) => void;
}) {
  const id = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const mechanism = useRef<SVGGElement>(null);
  const arm = useRef<SVGGElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean; value: number } | null>(null);
  const keyboard = useRef<number | null>(null);
  const [cue, setCue] = useState<number | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const volumeHeld = useRef(false);
  const displayedVolume = volumeDraft ?? volume;
  const inactive = disabled || duration <= 0;
  const shown = clampPosition(cue ?? position, duration);
  const angle = empty ? -10 : positionToAngle(shown, duration);
  function point(event: PointerEvent<SVGGElement>) {
    const matrix = mechanism.current?.getScreenCTM();
    if (!matrix) return null;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return pointToPosition(local.x, local.y, duration);
  }
  function cancel() {
    const held = pointer.current;
    pointer.current = null; keyboard.current = null; setCue(null);
    if (held && arm.current?.hasPointerCapture(held.id)) arm.current.releasePointerCapture(held.id);
  }
  function finish(event: PointerEvent<SVGGElement>, cancelled = false) {
    const held = pointer.current;
    if (!held || held.id !== event.pointerId) return;
    // Read the release point directly; React may not have rendered the last move.
    const value = point(event) ?? held.value;
    const commit = !cancelled && !inactive && held.moved;
    cancel();
    if (commit) onSeek(value);
  }
  return <div className={`${styles.recordDeck} ${empty ? styles.emptyDeck : ""}`}>
    <div className={styles.deckTopline}><span>RECORD CABINET / RC—01</span><span>DIRECT DRIVE · STEREO</span></div>
    <div className={styles.deckFace}>
    <svg ref={svg} viewBox="0 0 640 610" className={styles.physicalDeck} aria-label="Record player with draggable tonearm">
      <defs>
        <clipPath id={`${id}cover`}><circle cx="260" cy="245" r="64" /></clipPath>
        <linearGradient id={`${id}metal`} x1="0" x2="1"><stop offset="0" stopColor="#596057" /><stop offset=".28" stopColor="#c4c9bb" /><stop offset=".52" stopColor="#f4f3de" /><stop offset=".76" stopColor="#9b9f92" /><stop offset="1" stopColor="#646b60" /></linearGradient>
        <radialGradient id={`${id}vinyl`}><stop offset="0" stopColor="#262923" /><stop offset=".7" stopColor="#111611" /><stop offset="1" stopColor="#20271f" /></radialGradient>
        <linearGradient id={`${id}glint`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity="0" /><stop offset=".4" stopColor="#ffffff" stopOpacity=".07" /><stop offset=".5" stopColor="#ffffff" stopOpacity="0" /><stop offset=".85" stopColor="#ffffff" stopOpacity=".06" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" /></linearGradient>
        <filter id={`${id}shadow`} x="-50%" y="-30%" width="200%" height="180%"><feDropShadow dx="4" dy="7" stdDeviation="4" floodColor="#000" floodOpacity=".5" /></filter>
      </defs>
      <g>
        {[ [29,29], [611,29], [29,581], [611,581] ].map(([x, y]) => <g key={`${x}-${y}`}><circle cx={x} cy={y} r="5" fill="#828877" /><path d={`M${x - 3} ${y}h6`} stroke="#333a2d" /></g>)}
      </g>
      <g ref={mechanism} data-turntable-mechanism transform="translate(11 -36.75) scale(1.15)">
      <g>
        <circle cx="260" cy="249" r="205" fill="#171c16" />
        <circle cx="260" cy="245" r="200" fill={`url(#${id}metal)`} />
        <circle cx="260" cy="245" r="195" fill="none" stroke="#454d40" strokeWidth="3" strokeDasharray="2 6" />
        <circle cx="260" cy="245" r="190" fill={`url(#${id}vinyl)`} />
        {Array.from({ length: 34 }, (_, index) => <circle key={index} cx="260" cy="245" r={67 + index * 3.5} fill="none" stroke={index % 4 ? "#353d31" : "#626856"} strokeOpacity={index % 4 ? .65 : .3} strokeWidth={index % 4 ? .7 : 1.5} />)}
        <circle cx="260" cy="245" r="187" fill={`url(#${id}glint)`} />
        <g role="button" tabIndex={transportDisabled ? -1 : 0} aria-label={playing ? "Pause playback" : "Start playback"} aria-disabled={transportDisabled} onClick={() => { if (!transportDisabled) onTogglePlayback(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!event.repeat && !transportDisabled) onTogglePlayback(); } }} className={`${styles.spinningLabel} ${styles.recordToggle}`} style={{ animationPlayState: playing && cue === null && position < duration ? "running" : "paused" }}>
          <circle cx="260" cy="245" r="64" fill="#ceaa62" /><circle cx="260" cy="245" r="58" fill="none" stroke="#554a2e" strokeOpacity=".5" />
          <text x="260" y="217" textAnchor="middle" fill="#4b3c24" fontSize="8" letterSpacing="2">RECORD CABINET</text>
          <text x="260" y="232" textAnchor="middle" fill="#3c3320" fontFamily="Georgia, serif" fontSize="11">{title.length > 21 ? `${title.slice(0, 20)}…` : title}</text>
          <text x="260" y="271" textAnchor="middle" fill="#4b3c24" fontSize="7">{artist.length > 27 ? `${artist.slice(0, 26)}…` : artist}</text>
          <text x="260" y="284" textAnchor="middle" fill="#4b3c24" fontSize="6" letterSpacing="2">33⅓ RPM · LONG PLAY</text>
          {artworkUrl && <image href={artworkUrl} x="196" y="181" width="128" height="128" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}cover)`} onError={event => { event.currentTarget.style.display = "none"; }} />}
        </g>
        <circle pointerEvents="none" cx="260" cy="245" r="8" fill="#2f362b" /><circle pointerEvents="none" cx="260" cy="245" r="4" fill={`url(#${id}metal)`} />
        <circle cx="510" cy="70" r="33" fill="#161d15" stroke="#707961" strokeWidth="3" /><circle cx="510" cy="70" r="24" fill={`url(#${id}metal)`} />
        <circle cx="53" cy="427" r="8" fill={playing ? "#d4a852" : "#777958"} /><text x="72" y="430" fill="#c6cbb5" fontSize="8" letterSpacing="2">{playing ? "RUNNING" : "STANDBY"}</text>
      </g>
      <g ref={arm} role="slider" tabIndex={inactive ? -1 : 0} aria-label="Tonearm position" aria-disabled={inactive} aria-valuemin={0} aria-valuemax={duration || 1} aria-valuenow={Math.floor(shown)} aria-valuetext={`${Math.round(duration ? shown / duration * 100 : 0)} percent through the album`} aria-describedby={`${id}-help`} transform={`rotate(${angle} ${ARM.x} ${ARM.y})`} className={styles.physicalArm} data-cueing={cue !== null}
        onPointerDown={event => {
          if (inactive || !event.isPrimary || event.button !== 0) return;
          event.preventDefault(); keyboard.current = null;
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, value: shown };
          setCue(shown); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          const held = pointer.current;
          if (!held || held.id !== event.pointerId || inactive) return;
          held.moved ||= Math.hypot(event.clientX - held.x, event.clientY - held.y) > 3;
          if (held.moved) { held.value = point(event) ?? held.value; setCue(held.value); }
        }} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
          if (inactive || pointer.current || !(event.key in seekKeys || event.key === "Home" || event.key === "End")) return;
          event.preventDefault();
          keyboard.current = clampPosition(event.key === "Home" ? 0 : event.key === "End" ? duration : (keyboard.current ?? position) + seekKeys[event.key], duration);
          setCue(keyboard.current);
        }}
        onKeyUp={event => {
          if (!(event.key in seekKeys || event.key === "Home" || event.key === "End") || keyboard.current === null) return;
          event.preventDefault(); const target = keyboard.current; cancel(); if (!inactive) onSeek(target);
        }} onBlur={cancel}>
        <path d="M510 36 V356 Q510 371 503 382" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" fill="none" />
        <g filter={`url(#${id}shadow)`}>
          <rect x="497" y="22" width="26" height="31" rx="5" fill={`url(#${id}metal)`} stroke="#282e24" strokeWidth="2" />
          <path d="M510 56 V352 Q510 368 502 380" fill="none" stroke="#161c15" strokeWidth="14" strokeLinecap="round" />
          <path d="M510 56 V352 Q510 368 502 380" fill="none" stroke={`url(#${id}metal)`} strokeWidth="9" strokeLinecap="round" />
          <path d="M507 94 V349" fill="none" stroke="#e6e9d7" strokeOpacity=".5" strokeWidth="1.5" />
          <circle cx="510" cy="70" r="12" fill={`url(#${id}metal)`} stroke="#414b38" strokeWidth="3" />
          <rect className={styles.headshell} x="489" y="373" width="25" height="34" rx="4" fill="#d0d4bb" stroke="#626d55" strokeWidth="2" />
          <path d="M495 380h13m-13 6h13m-13 6h13" stroke="#6b735e" strokeWidth="2" />
          <rect x="494" y="405" width="15" height="7" rx="1" fill="#b2643b" /><path d="M501 412v5" stroke="#e1e3ce" strokeWidth="2" />
          <path d="M513 382l21 -11" stroke="#cdd3bd" strokeWidth="4" strokeLinecap="round" />
        </g>
      </g>
      </g>
    </svg>
    {!empty && <div className={styles.deckControls}>
      <div className={styles.startControl}><button className={styles.deckPower} disabled={transportDisabled} aria-label={playing ? "Pause record" : "Play record"} onClick={onTogglePlayback}><span className={styles.powerLamp} data-playing={playing} aria-hidden="true" /></button><span>START / STOP</span></div>
      {volumeAvailable ? <label className={styles.volumeControl}><span className={styles.volumeDial}>
        <span className={styles.volumeKnob} aria-hidden="true" style={{ transform: `rotate(${-135 + displayedVolume * 270}deg)` }} />
        <input aria-label="Record volume" type="range" min="0" max="100" step="1" value={Math.round(displayedVolume * 100)} disabled={volumeDisabled} onPointerDown={() => { volumeHeld.current = true; }} onChange={event => { const value = Number(event.target.value) / 100; if (volumeHeld.current) setVolumeDraft(value); else onVolume(value); }} onPointerUp={event => { if (volumeHeld.current) { volumeHeld.current = false; onVolume(Number(event.currentTarget.value) / 100); setVolumeDraft(null); } }} onPointerCancel={() => { volumeHeld.current = false; setVolumeDraft(null); }} onBlur={() => { volumeHeld.current = false; setVolumeDraft(null); }} />
      </span><span>VOLUME</span></label> : <span className={styles.deviceVolume}>VOLUME<small>Use device buttons</small></span>}
    </div>}
    </div>
    <div className={styles.quietDeckStatus}><span>{cue !== null ? "PLACING THE NEEDLE" : playing ? "ON THE RECORD" : "NEEDLE AT REST"}</span><span>33⅓ <small>RPM</small></span></div>
    <p id={`${id}-help`} className={styles.needleHelp}>{inactive ? duration > 0 ? "Needle controls are unavailable. Check playback or wait for the current command." : "Choose a record and put it on." : cue !== null ? "Release to place the needle · Escape to cancel" : "Drag the arm inward to move ahead, outward to go back."}<span>Tap the center label to play / pause · Arrow keys adjust the needle</span></p>
  </div>;
}
