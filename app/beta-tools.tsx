"use client";
import { useRef, useState } from "react";
import { APP_VERSION, createDiagnosticReport } from "./lib/beta-diagnostics";
export default function BetaTools(props: Parameters<typeof createDiagnosticReport>[0]) {
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [message, setMessage] = useState("");
  const preview = useRef<HTMLTextAreaElement>(null);
  const report = `What happened / what I expected / steps to repeat:\n${description}\n\nApp version: ${APP_VERSION}${includeDiagnostics ? `\n\nDiagnostics:\n${snapshot}` : ""}`;
  function capture() {
    setSnapshot(createDiagnosticReport(props, { userAgent: navigator.userAgent, width: window.innerWidth, height: window.innerHeight, online: navigator.onLine }));
    setMessage("");
  }
  return <section className="collection-tools beta-tools" aria-label="Problem reporting">
    <div className="collection-actions"><button aria-expanded={open} aria-controls="beta-report" onClick={() => { if (!open) capture(); setOpen(!open); }}>Report a problem</button><small>App version: {APP_VERSION}</small></div>
    <div id="beta-report" hidden={!open}>
      <p>Describe the problem, then copy this report and share it with the project maintainer. Nothing is sent automatically. Optional diagnostics exclude tokens, account identifiers, and library contents. Review your own description before sharing.</p>
      <label htmlFor="beta-description">What happened?</label><textarea id="beta-description" value={description} maxLength={4000} onChange={event => setDescription(event.target.value)} placeholder="What were you trying to do? What happened instead?" />
      <label><input type="checkbox" checked={includeDiagnostics} onChange={event => setIncludeDiagnostics(event.target.checked)} /> Include browser and playback diagnostics</label>
      <label htmlFor="beta-preview">Report preview</label><textarea id="beta-preview" ref={preview} readOnly value={report} rows={10} />
      <div className="collection-actions"><button onClick={async () => { try { await navigator.clipboard.writeText(report); setMessage("Copied. Share the report with the project maintainer."); } catch { preview.current?.focus(); preview.current?.select(); setMessage("Copy is unavailable here. Select and copy the report above."); } }}>Copy report</button><button onClick={capture}>Refresh diagnostics</button><button onClick={() => {
        const url = URL.createObjectURL(new Blob([report], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = "record-cabinet-problem.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download report</button></div>
      <p role="status">{message}</p>
    </div>
  </section>;
}
