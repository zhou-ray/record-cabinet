"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "./listening-guide.module.css";

function TourPopup({ label, onDismiss, children }: { label: string; onDismiss: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className={styles.popup} aria-label={label} onCancel={event => { event.preventDefault(); onDismiss(); }}>
    {children}
  </dialog>;
}

const invitationKey = "record-cabinet-tour-invitation-v1";
let answeredInMemory = false;
function subscribe(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener("record-cabinet-tour", update);
  return () => { window.removeEventListener("storage", update); window.removeEventListener("record-cabinet-tour", update); };
}
function answered() {
  try { return answeredInMemory || localStorage.getItem(invitationKey) === "yes"; } catch { return answeredInMemory; }
}
function rememberChoice() {
  answeredInMemory = true;
  try { localStorage.setItem(invitationKey, "yes"); } catch { /* Remember for this visit when storage is unavailable. */ }
  window.dispatchEvent(new Event("record-cabinet-tour"));
}

const steps = [
  ["Choose a bin", "Open a bin to start digging. Artist and album bins keep things alphabetical; Discover offers a smaller selection from your saved albums."],
  ["Dig through the records", "Pull down on the records, or use the arrow keys or buttons. The paper dividers jump further through a bin. Its front thumbnail remembers where you stopped."],
  ["Turn over a sleeve", "Tap a cover, or press Enter or Space, to lift and flip it. Read the tracks on the back. Tap the sleeve or swipe down to put it away."],
  ["Put on a record", "Tap the vinyl peeking out of the sleeve to play the album. Spotify playback needs Premium and a connected account."],
  ["Settle in and listen", "Use the turntable's play/pause button and volume knob. Move the arm to choose a place in the album. You can keep browsing or visit Settings while it plays."],
];
export default function ListeningGuide({ count, settings }: { count: number; settings: boolean }) {
  const replay = useRef<HTMLButtonElement>(null);
  const hasAnswered = useSyncExternalStore(subscribe, answered, () => true);
  const [visible, setVisible] = useState(false), [step, setStep] = useState(0);
  function start() { rememberChoice(); setStep(0); setVisible(true); }
  function close() { setVisible(false); requestAnimationFrame(() => replay.current?.focus({ preventScroll: true })); }
  if (!visible && !hasAnswered) return <TourPopup label="Welcome to Record Cabinet" onDismiss={rememberChoice}><section className="first-visit listening-guide" aria-label="Tour invitation">
    <h2>Welcome—take a quick tour?</h2><p>Get to know the cabinet, from browsing sleeves to putting on a record.</p>
    <div className="collection-actions"><button onClick={start}>Start tour</button><button onClick={rememberChoice}>Skip</button></div>
    <p>You can always find the tour in Library &amp; settings.</p>
  </section></TourPopup>;
  if (!visible) return settings ? <button ref={replay} onClick={start}>How to use the cabinet</button> : null;
  return <TourPopup label="Cabinet tour" onDismiss={close}><section className="first-visit listening-guide" aria-label="Cabinet tutorial">
    <p>YOUR LISTENING ROOM · {step + 1} OF {steps.length}</p>
    <div aria-live="polite" aria-atomic="true"><h2>{steps[step][0]}</h2><p>{steps[step][1]}</p></div>
    {!count && <p>Try the demo, or connect Spotify and import music in Library &amp; settings.</p>}
    <div className="collection-actions">
      {step > 0 && <button onClick={() => setStep(value => value - 1)}>Previous tip</button>}
      <button onClick={() => step === steps.length - 1 ? close() : setStep(value => value + 1)}>{step === steps.length - 1 ? "Finish tutorial" : "Next tip"}</button>
      <button onClick={close}>Close tutorial</button>
      {settings && <button onClick={() => { close(); window.history.pushState(null, "", "/"); }}>Browse records</button>}
    </div>
    <p>You can reopen this guide in Library &amp; settings.</p>
  </section></TourPopup>;
}
