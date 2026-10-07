"use client";
import { useSyncExternalStore } from "react";
const key = "record-cabinet-welcome-dismissed";
function subscribe(callback: () => void) { window.addEventListener("record-cabinet-welcome", callback); window.addEventListener("storage", callback); return () => { window.removeEventListener("record-cabinet-welcome", callback); window.removeEventListener("storage", callback); }; }
let dismissedInMemory = false;
function snapshot() { try { return dismissedInMemory || localStorage.getItem(key) === "yes"; } catch { return dismissedInMemory; } }
function dismiss() { dismissedInMemory = true; try { localStorage.setItem(key, "yes"); } catch {} window.dispatchEvent(new Event("record-cabinet-welcome")); }
export default function FirstVisit({ onDemo }: { onDemo: () => void }) {
  const dismissed = useSyncExternalStore(subscribe, snapshot, () => true);
  if (dismissed) return null;
  return <section className="first-visit" aria-label="Welcome to Record Cabinet"><h2>Your listening room</h2><p>Browse a cabinet, pull out a record, and give an album your attention.</p>
    <div className="collection-actions"><button onClick={() => { dismiss(); onDemo(); }}>Try the demo</button><a href="/api/spotify/login">Connect Spotify</a></div>
    <p>No account needed: open a bin, tap a sleeve to see its back, then tap the vinyl to play an original audio sketch. Spotify is available to invited testers with Premium.</p>
  </section>;
}
