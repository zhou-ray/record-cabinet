"use client";
import { useEffect, useRef, useState } from "react";
import type { Album } from "./data/types";
import { useAccount } from "./account-context";
import { engagementAccount, engagementAlbumId } from "./lib/engagement";
import { createEngagementStorage } from "./lib/engagement-storage";
import { readEngagementDebug } from "./lib/engagement-debug";
import { subscribeHistoryReset } from "./lib/engagement-reset";

export default function EngagementDebug({ albums }: { albums: Album[] }) {
  const { accountId } = useAccount();
  const [open, setOpen] = useState(false), [report, setReport] = useState("");
  const busy = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    const invalidate = () => { revision.current++; };
    const unsubscribe = subscribeHistoryReset(accountId, () => { revision.current++; setReport("History was reset. Refresh tracking to read new activity."); });
    return () => { invalidate(); unsubscribe(); };
  }, [accountId]);
  async function refresh() {
    if (busy.current || !engagementAccount(accountId)) return;
    busy.current = true;
    const ticket = revision.current;
    try {
      const store = createEngagementStorage(accountId);
      const saved = await store.load();
      const generation = await store.generation();
      if (ticket !== revision.current) return;
      if (generation !== saved.generation) { setReport("History changed. Refresh tracking again."); return; }
      const debug = readEngagementDebug(accountId);
      const names = new Map<string, string>();
      for (const album of albums) {
        const title = `${album.title} — ${album.artist}`;
        names.set(album.id, title);
        const canonical = engagementAlbumId(album);
        if (canonical) names.set(canonical, title);
      }
      const name = (id: string | null) => id ? `${names.get(id) ?? "Album not in this library"} [${id}]` : "None";
      const time = (value: number) => new Date(value).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const labels = { album_inspected: "Inspected", album_play_started: "Playback started", album_completed: "Completed" };
      setReport([
        `Tracking debugger v2 · captured ${time(Date.now())}`,
        "Local snapshot; use Refresh tracking after browsing. No Spotify requests.",
        "",
        "LATEST SPOTIFY OBSERVATION",
        ...(debug.observation ? [
          `${time(debug.observation.time)} · ${debug.observation.playing ? "Playing" : "Paused / unavailable"}`,
          `App playing selection: ${name(debug.observation.selectedAlbum)}`,
          `Spotify reported album: ${name(debug.observation.reportedAlbum)}`,
          `Spotify track: ${debug.observation.reportedTrack ?? "None"}`,
          `Linked original track: ${debug.observation.linkedTrack ?? "None"}`,
          `Matched library track: ${debug.observation.matchedTrack ?? "No match"}`,
          `Spotify album context: ${debug.observation.context ?? "Not reported"}`,
        ] : ["No playback observation since this page loaded."]),
        "",
        "SAVED EVENTS · newest first (latest 40)",
        ...saved.events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 40).map(event => `${time(event.timestamp)} · ${labels[event.type]} · ${name(event.albumId)}\n  ${"sessionId" in event ? `Session: ${event.sessionId}` : `Inspection: ${event.id}`}`),
        ...(saved.events.length ? [] : ["No saved events."]),
        "",
        "ACTIONS THIS PAGE LOAD · newest first (latest 60)",
        ...debug.actions.reverse().map(action => `${time(action.time)} · ${action.action} · ${name(action.albumId)}${action.id ? `\n  ID: ${action.id}` : ""}`),
      ].join("\n"));
    } catch { if (ticket === revision.current) setReport("Tracking history could not be read. Try Refresh tracking again."); }
    finally { busy.current = false; }
  }
  if (process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED !== "true" || !engagementAccount(accountId)) return null;
  return <section className="collection-tools beta-tools" aria-label="Tracking debug">
    <button aria-expanded={open} aria-controls="tracking-debug" onClick={() => { if (!open) void refresh(); setOpen(!open); }}>Tracking debug</button>
    {open && <div id="tracking-debug">
      <p>Test build only. Compare sleeve inspections with playback starts by album name. This snapshot contains album titles and IDs; nothing is sent automatically.</p>
      <button onClick={() => void refresh()}>Refresh tracking</button>
      <label htmlFor="tracking-history">Tracking history</label>
      <textarea id="tracking-history" readOnly rows={18} value={report} />
    </div>}
  </section>;
}
