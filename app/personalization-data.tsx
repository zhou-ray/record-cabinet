"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account-context";
import { engagementAccount } from "./lib/engagement";
import { createEngagementStorage } from "./lib/engagement-storage";
import { readOrganization } from "./lib/collection-backup";
import { createPersonalizationExport } from "./lib/personalization-export";

export default function PersonalizationData({ disabled }: { disabled: boolean }) {
  const { accountId, storage, organizationKey } = useAccount();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  async function download() {
    setBusy(true); setMessage("");
    try {
      const [library, history] = await Promise.all([storage.load(), createEngagementStorage(accountId).load()]);
      if (!active.current) return;
      const data = createPersonalizationExport({ accountId, exportedAt: Date.now(), albums: library.albums,
        organization: readOrganization(organizationKey), ...history });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      try {
        const link = document.createElement("a"); link.href = url;
        link.download = `record-cabinet-my-data-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setMessage(`Download prepared: ${data.library.length} album references, ${data.events.length} events and ${data.sessions.length} listening sessions.`);
    } catch { if (active.current) setMessage("Your data could not be exported. Nothing was changed. Please try again."); }
    finally { if (active.current) setBusy(false); }
  }
  if (!engagementAccount(accountId)) return null;
  return <section aria-label="Personalization data">
    <h3>Your browsing and listening data</h3>
    <p>{process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED === "true"
      ? "This test build saves sleeve inspections and listening progress on this device for future discovery features. This history is not uploaded."
      : "Browsing and listening history collection is off in this build. Any history already saved in this browser is still included in your download."}</p>
    <p>Download saved history, album references and personal-bin memberships as JSON. Recent listening may not be saved yet. The file excludes Spotify credentials; it contains personal listening information, so keep it private. For a restorable collection, use Collection backup below.</p>
    <button disabled={disabled || busy} onClick={() => void download()}>{busy ? "Preparing your data…" : "Download My Data"}</button>
    <p role="status">{message}</p>
  </section>;
}
