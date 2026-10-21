"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import GuidedTour from "./guided-tour";
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

export default function ListeningGuide({ settings, onStart, onExit }: { settings: boolean; onStart: () => void; onExit: () => void }) {
  const replay = useRef<HTMLButtonElement>(null);
  const hasAnswered = useSyncExternalStore(subscribe, answered, () => true);
  const [visible, setVisible] = useState(false);
  function start() { rememberChoice(); onStart(); setVisible(true); }
  function close() { setVisible(false); onExit(); requestAnimationFrame(() => replay.current?.focus({ preventScroll: true })); }
  if (!visible && !hasAnswered) return <TourPopup label="Welcome to Record Cabinet" onDismiss={rememberChoice}><section className="first-visit listening-guide" aria-label="Tour invitation">
    <h2>Welcome—take a quick tour?</h2><p>Try a few demo records. No login or import needed.</p>
    <div className="collection-actions"><button onClick={start}>Start tour</button><button onClick={rememberChoice}>Skip</button></div>
    <p>You can always find the tour in Library &amp; settings.</p>
  </section></TourPopup>;
  if (!visible) return settings ? <button ref={replay} onClick={start}>How to use the cabinet</button> : null;
  return <GuidedTour onClose={close} />;
}
