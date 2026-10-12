"use client";
import { useEffect, useState } from "react";
import { useAccount } from "./account-context";
export default function ListeningGuide({ count, settings }: { count: number; settings: boolean }) {
  const { storage, accountId } = useAccount();
  const [done, setDone] = useState(true);
  useEffect(() => {
    let active = true;
    void storage.loadListeningGuide().then(value => { if (active) setDone(value); }).catch(() => {});
    const heard = (event: Event) => { if ((event as CustomEvent).detail?.scope === accountId) setDone(true); };
    window.addEventListener("record-cabinet-first-play", heard);
    return () => { active = false; window.removeEventListener("record-cabinet-first-play", heard); };
  }, [storage, accountId]);
  if (done) return null;
  return <details className="first-visit listening-guide" open={!count}><summary>Your first record · {count ? "2" : "1"} of 3 steps complete</summary>
    <ol><li>Spotify connected.</li><li>{count ? `${count} records saved.` : "Import saved albums, Liked Songs, or a playlist in Library & settings."}</li><li>Open a bin, pull out a sleeve, then tap the vinyl to play. Flip the sleeve to read the tracks.</li></ol>
    <p>Genre sorting starts after imports save. You can browse while it works.</p>
    <div className="collection-actions">{(!settings || count > 0) && <button onClick={() => window.history.pushState(null, "", count ? "/" : "/settings")}>{count ? "Browse my records" : "Open import options"}</button>}<button onClick={() => { setDone(true); void storage.finishListeningGuide().catch(() => {}); }}>Dismiss guide</button></div>
  </details>;
}
