"use client";
import { useId, useState } from "react";
import type { Album } from "./data/types";
import type { CustomSystem } from "./catalog";
import type { DiscoveryDestination } from "./lib/discovery-move";
import type { DiscoveryFeedback } from "./lib/discovery-feedback";
import { BinSetup } from "./bin-organizer";
import styles from "./record-bin.module.css";
import picker from "./discovery-actions.module.css";

export default function DiscoveryActions({ album, systems, feedback, busy, onAction, onCreate }: {
  album: Album; systems: CustomSystem[]; feedback: DiscoveryFeedback[]; busy: boolean;
  onAction: (destination?: DiscoveryDestination) => Promise<{ retry: () => Promise<void> } | null>;
  onCreate: (system: CustomSystem) => Promise<void>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false), [creating, setCreating] = useState(false);
  const [query, setQuery] = useState(""), [limit, setLimit] = useState(8), [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ retry: () => Promise<void> } | null>(null);
  const recent = new Map<string, number>();
  for (const row of feedback) if (row.destination) {
    const key = JSON.stringify([row.destination.systemId, row.destination.binId]);
    recent.set(key, Math.max(recent.get(key) ?? 0, row.timestamp));
  }
  const destinations = systems.flatMap(system => system.bins.map(bin => ({ system, bin })))
    .filter(({ system, bin }) => `${system.name} ${bin.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a,b) => (recent.get(JSON.stringify([b.system.id,b.bin.id])) ?? 0) - (recent.get(JSON.stringify([a.system.id,a.bin.id])) ?? 0));
  async function act(destination?: DiscoveryDestination) {
    setMessage("");
    try {
      const result = await onAction(destination);
      if (!result && destination) { setOpen(false); setMessage("Filed in your personal bin. This record stays in Discover."); }
      if (result) { setPending(result); setMessage("Filed in your personal bin. Saving Discover feedback did not finish. Your filed copy is safe."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this change. Try again."); }
  }
  return <div className={picker.actions}>
    <div className={styles.moveBinControl}>
      <button disabled={busy || !!pending} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Close destinations" : "File in bin"}</button>
      {!pending && <button disabled={busy} onClick={() => void act()}>Remove from this Discover bin</button>}
    </div>
    {pending ? <div role="status"><p>{message}</p><button disabled={busy} onClick={async () => { try { await pending.retry(); setPending(null); setOpen(false); setMessage("Filed in your personal bin. This record stays in Discover."); } catch { setMessage("Your personal filing is saved. Feedback still could not be saved; try again or reopen Discover if the set changed."); } }}>Retry feedback</button></div> : <>
      {message && <p role="alert">{message}</p>}
      {open && <section id={id} className={picker.panel} aria-label={`Choose a personal bin for ${album.title}`}>
        <label>Find a destination<input type="search" value={query} placeholder="Bin or system name" onChange={event => { setQuery(event.target.value); setLimit(8); }} /></label>
        <div className={picker.list}>{destinations.slice(0,limit).map(({system,bin}) => <button disabled={busy} key={JSON.stringify([system.id,bin.id])} onClick={() => void act({systemId:system.id,binId:bin.id})}>
          <strong>{bin.label}</strong><span>{system.name}{system.assignments[album.id] === bin.id ? " · Already filed here" : ""}</span>
        </button>)}</div>
        {!destinations.length && <p>{systems.some(system => system.bins.length) ? "No matching bins." : "Create a personal system to give this record a home."}</p>}
        {destinations.length > limit && <button onClick={() => setLimit(value => value + 8)}>Show more destinations ({destinations.length - limit})</button>}
        <button disabled={busy} aria-expanded={creating} onClick={() => setCreating(!creating)}>{creating ? "Cancel new system" : "Create a personal system"}</button>
        {creating && <fieldset disabled={busy} className={picker.create}><BinSetup onCreate={system => { void onCreate(system).then(() => { setCreating(false); setQuery(system.name); setLimit(8); }).catch(error => setMessage(error instanceof Error ? error.message : "Could not create these bins.")); }} onCancel={() => setCreating(false)} /></fieldset>}
      </section>}
    </>}
  </div>;
}
