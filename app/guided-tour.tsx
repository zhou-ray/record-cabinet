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
    function update() {
      const cabinet = document.querySelector<HTMLElement>('[data-tour-bin]');
      if (!cabinet || cabinet.closest('[hidden]')) { setBox(null); return; }
      const data = cabinet.dataset;
      if (step < 4 && step > 0 && !data.tourBin) { setStep(0); return; }
      if (step === 0 && data.tourBin) { firstIndex.current = data.tourIndex ?? ""; setStep(1); return; }
      if (step === 1 && cabinet.querySelector('[data-tour-target="browse"]:disabled')) { setStep(2); return; }
      if (step === 1 && data.tourFlipped === "true") { setStep(3); return; }
      if (step === 3 && data.tourFlipped !== "true" && data.tourPlaying !== "true") { setStep(2); return; }
      if (step === 1 && data.tourIndex !== firstIndex.current) { setStep(2); return; }
      if (step === 2 && data.tourFlipped === "true") { setStep(3); return; }
      if (step === 3 && data.tourPlaying === "true") { setStep(4); return; }
      const next = step < 5 ? cabinet.querySelector(selectors[step]) ?? (step === 0 ? cabinet.querySelector('[data-tour-target="all"]') : null) : null;
      if (next !== target) { target = next; target?.scrollIntoView({ block: "center", behavior: "instant" }); if (target instanceof HTMLElement || target instanceof SVGElement) target.focus({ preventScroll: true }); }
      if (!target) { setBox(null); return; }
      const rect = target.getBoundingClientRect();
      setBox({ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 });
    }
    update();
    const timer = setInterval(update, 120);
    const seek = () => { if (step === 4) setStep(5); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("record-cabinet-demo-seek", seek);
    window.addEventListener("keydown", escape);
    return () => { clearInterval(timer); window.removeEventListener("record-cabinet-demo-seek", seek); window.removeEventListener("keydown", escape); };
  }, [step, onClose]);
  const below = box && box.top < 180;
  return <>
    {box && <div className={styles.spotlight} style={box} aria-hidden="true"><span className={styles.arrow}>↓</span></div>}
    <aside className={styles.hint} aria-label="Cabinet tutorial" style={box ? { top: below ? Math.min(box.top + box.height + 14, window.innerHeight - 155) : Math.max(12, box.top - 130) } : { bottom: 20 }}>
      <span>DEMO TOUR · {Math.min(step + 1, 5)} / 5</span>
      <p aria-live="polite">{hints[step]}</p>
      {step === 1 && <small>Swipe down or use the arrows.</small>}
      {step === 4 && <small>Drag, or focus the arm and use arrow keys.</small>}
      {step === 5 && <small>Keep exploring. Your own library is unchanged.</small>}
      <button onClick={onClose}>{step === 5 ? "Finish tour" : "Skip tour"}</button>
    </aside>
  </>;
}
