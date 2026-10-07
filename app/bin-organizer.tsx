"use client";
import { useId, useState } from "react";
import type { Album } from "./data/types";
import type { CustomSystem } from "./catalog";
import { binNameError, fileAlbums, MAX_CUSTOM_BINS, removeBin, reorderBin } from "./lib/bin-organization";
import styles from "./record-bin.module.css";

export function BinSetup({ onCreate, onCancel }: { onCreate: (system: CustomSystem) => void; onCancel?: () => void }) {
  const [name, setName] = useState("My bins");
  const [labels, setLabels] = useState(["", "", ""]);
  const [error, setError] = useState("");
  return <form className={styles.binSetup} onSubmit={event => {
    event.preventDefault();
    const error = binNameError(labels);
    if (!name.trim() || error) { setError(error || "Give your system a name."); return; }
    onCreate({ id: crypto.randomUUID(), name: name.trim(), bins: labels.map(label => ({ id: crypto.randomUUID(), label: label.trim() })), assignments: {} });
  }}>
    <p className={styles.eyebrow}>FIRST, MAKE ROOM</p><h2>Name your bins.</h2>
    <p>Moods, genres, decades — whatever makes sense to you. Start small and add more later.</p>
    <label>System name<input value={name} maxLength={60} onChange={event => setName(event.target.value)} required /></label>
    {labels.map((label, index) => <div className={styles.organizerRow} key={index}><label>Bin {index + 1}<input value={label} maxLength={60} placeholder={["Sunday mornings", "After hours", "Old favorites"][index] || "Another good place"} onChange={event => setLabels(labels.map((value, i) => i === index ? event.target.value : value))} /></label><button type="button" aria-label={`Remove bin ${index + 1}`} disabled={labels.length === 1} onClick={() => setLabels(labels.filter((_, i) => i !== index))}>Remove</button></div>)}
    <div className={styles.organizerRow}><button type="button" disabled={labels.length >= MAX_CUSTOM_BINS} onClick={() => setLabels([...labels, ""])}>+ Add another bin</button><span className={styles.binHint}>{labels.length} / {MAX_CUSTOM_BINS} · plus Unfiled</span></div>
    {error && <p role="alert">{error}</p>}
    <div className={styles.organizerRow}><button className={styles.primaryAction} type="submit">Create bins & start filing →</button>{onCancel && <button type="button" onClick={onCancel}>Cancel</button>}</div>
  </form>;
}

export function AddBin({ system, onChange }: { system: CustomSystem; onChange: (system: CustomSystem) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  if (system.bins.length >= MAX_CUSTOM_BINS) return <p className={styles.binHint}>Five named bins, plus Unfiled. Rename bins to make room for a new idea.</p>;
  return <form className={styles.addBin} onSubmit={event => {
    event.preventDefault();
    const error = binNameError([...system.bins.map(bin => bin.label), name]);
    if (error) { setError(error); return; }
    onChange({ ...system, bins: [...system.bins, { id: crypto.randomUUID(), label: name.trim() }] });
    setName(""); setError("");
  }}><label>New bin<input maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="Name a new bin" required /></label><button type="submit">+ Add bin</button>{error && <p role="alert">{error}</p>}</form>;
}

export default function BinOrganizer({ collection, systems, systemId, onSelect, onCreate, onChange }: { collection: Album[]; systems: CustomSystem[]; systemId: string; onSelect: (id: string) => void; onCreate: (system: CustomSystem) => void; onChange: (system: CustomSystem) => void }) {
  const [creating, setCreating] = useState(false);
  const system = systems.find(item => item.id === systemId);
  return <section className={styles.organizer} aria-label="Custom organization">
    {systems.length > 0 && <div className={styles.organizerRow}><label>System<select value={systemId} onChange={event => { setCreating(false); onSelect(event.target.value); }}><option value="" disabled>Choose a system</option>{systems.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button onClick={() => setCreating(true)}>+ New system</button></div>}
    {creating || !system ? <BinSetup onCreate={next => { onCreate(next); setCreating(false); }} onCancel={system ? () => setCreating(false) : undefined} /> : <FilingDesk key={system.id} system={system} collection={collection} onChange={onChange} />}
  </section>;
}

function FilingDesk({ system, collection, onChange }: { system: CustomSystem; collection: Album[]; onChange: (system: CustomSystem) => void }) {
  const [query, setQuery] = useState("");
  const [onlyUnfiled, setOnlyUnfiled] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [renaming, setRenaming] = useState(false);
  const isFiled = (album: Album) => system.bins.some(bin => bin.id === system.assignments[album.id]);
  const visible = collection.filter(album => (!onlyUnfiled || !isFiled(album)) && `${album.title} ${album.artist}`.toLowerCase().includes(query.toLowerCase()));
  const unfiled = collection.filter(album => !isFiled(album)).length;
  function file(binId: string) {
    onChange(fileAlbums(system, selected, binId));
    setMessage(`${selected.length} ${selected.length === 1 ? "record" : "records"} moved to ${system.bins.find(bin => bin.id === binId)?.label || "Unfiled"}.`);
    setSelected([]);
  }
  return <>
    <div className={styles.organizerRow}><div><p className={styles.eyebrow}>NEXT, FILE YOUR RECORDS</p><h2>{system.name}</h2></div><button aria-expanded={renaming} onClick={() => setRenaming(!renaming)}>{renaming ? "Done editing names" : "Edit names"}</button></div>
    <p>Choose records below, then tap a bin. You can move them again from the back of any album.</p>
    {renaming && <div className={styles.binSetup}><label>System name<input maxLength={60} value={system.name} onChange={event => onChange({ ...system, name: event.target.value })} /></label>{system.bins.map((bin, index) => <div className={styles.organizerRow} key={bin.id}><label>Bin name<input maxLength={60} value={bin.label} onChange={event => onChange({ ...system, bins: system.bins.map(item => item.id === bin.id ? { ...item, label: event.target.value } : item) })} /></label><button aria-label={`Move ${bin.label} earlier`} disabled={index === 0} onClick={() => { onChange(reorderBin(system, bin.id, -1)); setMessage(`${bin.label} moved earlier.`); }}>↑</button><button aria-label={`Move ${bin.label} later`} disabled={index === system.bins.length - 1} onClick={() => { onChange(reorderBin(system, bin.id, 1)); setMessage(`${bin.label} moved later.`); }}>↓</button><button onClick={() => { onChange(removeBin(system, bin.id)); setMessage(`Removed ${bin.label}. Its records are in Unfiled.`); }}>Remove bin</button></div>)}</div>}
    <AddBin system={system} onChange={onChange} />
    <div className={styles.filingTargets} role="group" aria-label="Move selected records to a bin">{system.bins.map(bin => <button key={bin.id} disabled={!selected.length} onClick={() => file(bin.id)}><span aria-hidden="true">▤</span><strong>{bin.label}</strong><small>{collection.filter(album => system.assignments[album.id] === bin.id).length} records</small></button>)}<button disabled={!selected.length} onClick={() => file("")}><span aria-hidden="true">▤</span><strong>Unfiled</strong><small>{unfiled} records</small></button></div>
    <div className={styles.organizerRow}><label>Find records<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Album or artist" /></label><label><input type="checkbox" checked={onlyUnfiled} onChange={event => setOnlyUnfiled(event.target.checked)} />Unfiled only</label></div>
    <div className={styles.organizerRow}><button disabled={!visible.length} onClick={() => setSelected([...new Set([...selected, ...visible.map(album => album.id)])])}>Select shown ({visible.length})</button><button disabled={!selected.length} onClick={() => setSelected([])}>Clear selection</button><span role="status">{selected.length} selected · choose a bin above</span></div>
    <div className={styles.filingList}>{visible.map(album => <label key={album.id} className={styles.filingRecord}><input type="checkbox" checked={selected.includes(album.id)} onChange={event => setSelected(event.target.checked ? [...selected, album.id] : selected.filter(id => id !== album.id))} /><span><strong>{album.title}</strong><small>{album.artist}</small></span><small>{system.bins.find(bin => bin.id === system.assignments[album.id])?.label || "Unfiled"}</small></label>)}{!visible.length && <p>{onlyUnfiled && !query ? "Everything is filed. Turn off Unfiled only to move records between bins." : "No matching records."}</p>}</div>
    <p role="status">{message}</p>
  </>;
}

export function AlbumFiling({ album, systems, systemId, onSelect, onChange, onCreate }: { album: Album; systems: CustomSystem[]; systemId: string; onSelect: (id: string) => void; onChange: (system: CustomSystem) => void; onCreate: (system: CustomSystem) => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const system = systems.find(item => item.id === systemId) ?? systems[0];
  return <div className={styles.moveBinControl}><button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{open ? "Done moving" : "Move bin"}</button>
    {open && <section id={panelId} className={`${styles.organizer} ${styles.albumFiling}`} aria-label="Move this album"><p className={styles.eyebrow}>A PLACE ON YOUR SHELF</p><h3>File this record</h3>{system ? <>
    <label>System<select value={system.id} onChange={event => onSelect(event.target.value)}>{systems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className={styles.albumBinChoices} role="group" aria-label={`Bin for ${album.title}`}>{[{ id: "", label: "Unfiled" }, ...system.bins].map(bin => <button key={bin.id} aria-pressed={(system.bins.some(item => item.id === system.assignments[album.id]) ? system.assignments[album.id] : "") === bin.id} onClick={() => onChange(fileAlbums(system, [album.id], bin.id))}>{bin.label}</button>)}</div>
    <p role="status">Filed in {system.bins.find(bin => bin.id === system.assignments[album.id])?.label || "Unfiled"}.</p><AddBin key={system.id} system={system} onChange={onChange} />
  </> : <BinSetup onCreate={onCreate} />}</section>}</div>;
}
