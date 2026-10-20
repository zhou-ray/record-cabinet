"use client";
import { useEffect, useState } from "react";
import { useAccount } from "./account-context";

const steps = [
  ["Choose a bin", "Open a bin to start digging. Artist and album bins keep things alphabetical; Discover offers a smaller selection from your saved albums."],
  ["Dig through the records", "Pull down on the records, or use the arrow keys or buttons. The paper dividers jump further through a bin. Its front thumbnail remembers where you stopped."],
  ["Turn over a sleeve", "Tap a cover, or press Enter or Space, to lift and flip it. Read the tracks on the back. Tap the sleeve or swipe down to put it away."],
  ["Put on a record", "Tap the vinyl peeking out of the sleeve to play the album. Spotify playback needs Premium and a connected account."],
  ["Settle in and listen", "Use the turntable's play/pause button and volume knob. Move the arm to choose a place in the album. You can keep browsing or visit Settings while it plays."],
];
export default function ListeningGuide({ count, settings }: { count: number; settings: boolean }) {
  const { storage } = useAccount();
  const [visible, setVisible] = useState(false), [step, setStep] = useState(0);
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    let active = true;
    void storage.loadListeningGuide().then(done => { if (active) { setVisible(!done); setStep(0); } }).catch(() => {});
    return () => { active = false; };
  }, [storage]);
  async function close() {
    if (remember) await storage.finishListeningGuide().catch(() => {});
    setVisible(false);
  }
  if (!visible) return settings ? <button onClick={() => { setStep(0); setVisible(true); }}>How to use the cabinet</button> : null;
  return <section className="first-visit listening-guide" aria-label="Cabinet tutorial">
    <p>YOUR LISTENING ROOM · {step + 1} OF {steps.length}</p>
    <div aria-live="polite" aria-atomic="true"><h2>{steps[step][0]}</h2><p>{steps[step][1]}</p></div>
    {!count && <p>Start by importing music in Library &amp; settings.</p>}
    <div className="collection-actions">
      {step > 0 && <button onClick={() => setStep(value => value - 1)}>Previous tip</button>}
      <button onClick={() => step === steps.length - 1 ? close() : setStep(value => value + 1)}>{step === steps.length - 1 ? "Finish tutorial" : "Next tip"}</button>
      <button onClick={close}>Close tutorial</button>
      {settings && <button onClick={() => window.history.pushState(null, "", "/")}>Browse records</button>}
    </div>
    <label><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /> Don’t show automatically again</label>
    <p>You can reopen this guide in Library &amp; settings.</p>
  </section>;
}
