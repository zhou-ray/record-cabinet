"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { binStackDepth, type BinDivider } from "./lib/bin-dividers";
import styles from "./record-bin.module.css";

export default function BinDividerTabs({ sections, position, disabled, onSelect }: { sections: BinDivider[]; position: number; disabled: boolean; onSelect: (index: number) => void }) {
  const reduced = !!useReducedMotion();
  const current = Math.max(0, sections.findIndex(section => position >= section.start && position < section.end));
  const section = sections[current];
  const firstTab = current + 1;
  const visibleSections = sections.slice(firstTab, firstTab + 2);
  const latestCurrent = useRef(current);
  useEffect(() => { latestCurrent.current = current; }, [current]);
  const [direction, setDirection] = useState(1);
  const [turning, setTurning] = useState(false);
  const [observedCurrent, setObservedCurrent] = useState(current);
  if (observedCurrent !== current) {
    setObservedCurrent(current);
    setDirection(current > observedCurrent ? 1 : -1);
    setTurning(sections.slice(observedCurrent + 1, observedCurrent + 3).some(tab => !visibleSections.includes(tab)));
  }
  const [settledTab, setSettledTab] = useState<number | null>(null);
  const rail = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  const gesture = useRef<{ id: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const wheelDistance = useRef(0);
  const wheelAt = useRef(0);
  function select(target: number) {
    if (disabled || turning || !sections[target]) return;
    if (target === current) { onSelect(sections[target].start); return; }
    setDirection(target > current ? 1 : -1); setTurning(true);
    onSelect(sections[target].start);
  }
  function turn(step: number) { select(current + step); }
  useEffect(() => {
    const node = rail.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (disabled || event.ctrlKey || !event.deltaY) return;
      const step = event.deltaY > 0 ? 1 : -1;
      if (!sections[current + step]) return;
      event.preventDefault();
      if (turning || Date.now() - wheelAt.current < 400) return;
      wheelDistance.current += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
      if (Math.abs(wheelDistance.current) < 35) return;
      wheelDistance.current = 0; wheelAt.current = Date.now();
      setDirection(step); setTurning(true); onSelect(sections[current + step].start);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [current, disabled, turning, sections, reduced, onSelect]);
  useEffect(() => {
    if (turning || disabled || settledTab !== section?.start || !restoreFocus.current) return;
    const button = rail.current?.querySelector<HTMLButtonElement>("button[aria-current=true]") ?? rail.current?.querySelector<HTMLButtonElement>("button");
    if (button && !button.disabled) { button.focus({ preventScroll: true }); restoreFocus.current = false; }
  }, [turning, disabled, current, settledTab, section?.start]);
  if (!section || sections.length < 2) return null;
  return <nav ref={rail} className={styles.dividerNavigation} aria-label="Bin dividers" aria-busy={turning} hidden={!visibleSections.length && !turning}>
    <div className={styles.dividerDeck} inert={turning || disabled} title="Pull down for the next divider; push up to go back"
      onPointerDown={event => { if (disabled || turning || !event.isPrimary || event.button !== 0) return; suppressClick.current = false; gesture.current = { id: event.pointerId, y: event.clientY }; }}
      onPointerMove={event => { const held = gesture.current; if (held?.id === event.pointerId && Math.abs(event.clientY - held.y) > 5 && !event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerUp={event => { const held = gesture.current; gesture.current = null; if (!held || held.id !== event.pointerId) return; const distance = event.clientY - held.y; if (Math.abs(distance) > 22) { suppressClick.current = true; turn(distance > 0 ? 1 : -1); } if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { gesture.current = null; suppressClick.current = true; }}>
      <AnimatePresence initial={false} custom={direction} onExitComplete={() => { setTurning(false); setSettledTab(sections[latestCurrent.current]?.start ?? null); }}>
          {visibleSections.map((tab, offset) => <motion.div key={tab.start} custom={direction} style={{ transformPerspective: 900 }}
            className={styles.dividerSheet} data-depth={offset + 1} data-side={(firstTab + offset) % 2 ? "left" : "right"}
            variants={{ enter: (step: number) => ({ opacity: 0, rotateX: reduced || step > 0 ? 0 : -82, y: reduced || step > 0 ? 0 : -12, zIndex: 41 - Math.round(binStackDepth(tab.start - position - .5) * 4) }), leave: (step: number) => ({ rotateX: reduced ? 0 : step > 0 ? -82 : 0, y: reduced ? 0 : step > 0 ? -12 : 0, opacity: reduced ? 0 : [1, 1, 0], zIndex: step > 0 ? 56 : 3, transition: { duration: reduced ? 0 : .42, ease: "easeInOut", times: [0, .7, 1], zIndex: { duration: 0 } } }) }}
            initial="enter" animate={{ rotateX: 0, y: -binStackDepth(tab.start - position - .5) * 23, scale: 1 - binStackDepth(tab.start - position - .5) * .035, opacity: 1, zIndex: 41 - Math.round(binStackDepth(tab.start - position - .5) * 4) }} exit="leave" transition={{ duration: reduced ? 0 : direction < 0 ? .22 : .42, ease: "easeInOut", zIndex: { duration: 0 } }}
            >
          <svg className={styles.dividerPaper} viewBox="0 0 400 500" preserveAspectRatio="none" aria-hidden="true">
            <path transform={(firstTab + offset) % 2 ? undefined : "translate(400 0) scale(-1 1)"} d="M 2 498 L 2 12 Q 2 3 12 3 L 183 3 Q 193 3 197 13 L 211 62 Q 213 69 223 69 L 388 69 Q 398 69 398 79 L 398 490 Q 398 498 390 498 Z" vectorEffect="non-scaling-stroke" />
          </svg>
          <button className={`${styles.tab} ${styles.manilaDivider}`} data-depth={offset + 1} disabled={disabled || turning} title={tab.label}
            aria-label={`Jump to ${tab.label}, records ${tab.start + 1}–${tab.end}`}
            onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } select(firstTab + offset); }}
            onKeyDown={event => { if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) { const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1; restoreFocus.current = !disabled && !turning && !!sections[current + step]; turn(step); } } }}>
            <span className={styles.dividerLabel}><span>{tab.label}</span><small>{tab.start + 1}–{tab.end}</small></span>
          </button></motion.div>)}
      </AnimatePresence>
    </div>

  </nav>;
}
