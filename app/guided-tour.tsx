"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./listening-guide.module.css";
const selectors = ['[data-tour-target="bin"]:not(:disabled)', '[data-tour-target="browse"]', '[data-tour-target="sleeve"]', '[data-tour-target="vinyl"]', '[aria-label="Tonearm position"]'];
const hints = ["Open a demo bin", "Dig to the next record", "Tap the sleeve to flip it", "Tap the vinyl to play", "Move the arm to explore", "You’re ready to dig"];
export default function GuidedTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const firstIndex = useRef("");
  useEffect(() => {
    let target: Element | null = null;
    let pendingStep = -1, pendingSince = 0, targetSince = 0, revealed = false;
    let frame = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function advance(next: number) {
      if (pendingStep !== next) { pendingStep = next; pendingSince = performance.now(); }
      if (performance.now() - pendingSince >= (reduced ? 100 : 500)) setStep(next);
    }
    function update() {
      const cabinet = document.querySelector<HTMLElement>('[data-tour-bin]');
      if (!cabinet || cabinet.closest('[hidden]')) { setBox(null); return; }
      const data = cabinet.dataset;
      if (step < 4 && step > 0 && !data.tourBin) { advance(0); return; }
      if (step === 0 && data.tourBin) { firstIndex.current = data.tourIndex ?? ""; advance(1); return; }
      if (step === 1 && cabinet.querySelector('[data-tour-target="browse"]:disabled')) { advance(2); return; }
      if (step === 1 && data.tourFlipped === "true") { advance(3); return; }
      if (step === 3 && data.tourFlipped !== "true" && data.tourPlaying !== "true") { advance(2); return; }
      if (step === 1 && data.tourIndex !== firstIndex.current) { advance(2); return; }
      if (step === 2 && data.tourFlipped === "true") { advance(3); return; }
      if (step === 3 && data.tourPlaying === "true") { advance(4); return; }
      pendingStep = -1;
      const next = step < 5 ? cabinet.querySelector(selectors[step]) ?? (step === 0 ? cabinet.querySelector('[data-tour-target="all"]') : null) : null;
      if (next !== target) { target = next; targetSince = performance.now(); revealed = false; }
      if (!target) { setBox(null); return; }
      const rect = target.getBoundingClientRect();
      if (!revealed && performance.now() - targetSince > (reduced ? 0 : 250)) {
        revealed = true;
        // Leave room for the fixed hint, and avoid moving a target already in reach.
        if (rect.top < 48 || rect.bottom > innerHeight - 165) target.scrollIntoView({ block: "center", behavior: reduced ? "instant" : "smooth" });
        if (document.activeElement?.matches(":focus-visible") && (target instanceof HTMLElement || target instanceof SVGElement)) target.focus({ preventScroll: true });
      }
      const nextBox = { left: Math.round(rect.left - 6), top: Math.round(rect.top - 6), width: Math.round(rect.width + 12), height: Math.round(rect.height + 12) };
      setBox(previous => previous && Object.keys(nextBox).every(key => previous[key as keyof typeof nextBox] === nextBox[key as keyof typeof nextBox]) ? previous : nextBox);
    }
    function tick() { update(); frame = requestAnimationFrame(tick); }
    frame = requestAnimationFrame(tick);
    const seek = () => { if (step === 4) setStep(5); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("record-cabinet-demo-seek", seek);
    window.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("record-cabinet-demo-seek", seek); window.removeEventListener("keydown", escape); };
  }, [step, onClose]);
  return <>
    {box && <div className={styles.spotlight} style={box} aria-hidden="true"><span className={styles.arrow}>↓</span></div>}
    <aside className={styles.hint} aria-label="Cabinet tutorial">
      <span>DEMO TOUR · {Math.min(step + 1, 5)} / 5</span>
      <p key={step} className={styles.hintText} aria-live="polite">{hints[step]}</p>
      {step === 1 && <small>Swipe down or use the arrows.</small>}
      {step === 4 && <small>Drag, or focus the arm and use arrow keys.</small>}
      {step === 5 && <small>Finish to return to your records.</small>}
      <button onClick={onClose}>{step === 5 ? "Finish tour" : "Skip tour"}</button>
    </aside>
  </>;
}
