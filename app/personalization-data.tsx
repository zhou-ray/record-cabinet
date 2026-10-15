"use client";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "./account-context";
import { engagementAccount } from "./lib/engagement";
import { createEngagementStorage } from "./lib/engagement-storage";
import { readOrganization } from "./lib/collection-backup";
import { createPersonalizationExport } from "./lib/personalization-export";
import { publishHistoryReset, subscribeHistoryReset } from "./lib/engagement-reset";

export default function PersonalizationData({ disabled }: { disabled: boolean }) {
  const { accountId, storage, organizationKey } = useAccount();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const active = useRef(true);
  const revision = useRef(0);
  useEffect(() => {
    active.current = true;
    const invalidate = () => { revision.current++; };
    const unsubscribe = subscribeHistoryReset(accountId, () => {
      revision.current++; setConfirming(false); setMessage("Personalization history was reset in this browser.");
    });
    return () => { active.current = false; invalidate(); unsubscribe(); };
  }, [accountId]);
  async function download() {
    setBusy(true); setMessage("");
    const ticket = ++revision.current;
    try {
      const historyStore = createEngagementStorage(accountId);
      const [library, history] = await Promise.all([storage.load(), historyStore.load()]);
      const currentGeneration = await historyStore.generation();
      if (!active.current || ticket !== revision.current) return;
      if (history.generation !== currentGeneration) { setMessage("History changed during export. Download again for the latest data."); return; }
      const data = createPersonalizationExport({ accountId, exportedAt: Date.now(), albums: library.albums,
        organization: readOrganization(organizationKey), ...history });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      try {
        const link = document.createElement("a"); link.href = url;
        link.download = `record-cabinet-my-data-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setMessage(`Download prepared: ${data.library.length} album references, ${data.events.length} events and ${data.sessions.length} listening sessions.`);
    } catch { if (active.current && ticket === revision.current) setMessage("Your data could not be exported. Nothing was changed. Please try again."); }
    finally { if (active.current) setBusy(false); }
  }
  async function reset() {
    setBusy(true); setMessage("");
    try {
      const generation = await createEngagementStorage(accountId).reset();
      publishHistoryReset(accountId, generation);
      if (active.current) {
        setConfirming(false);
        setMessage("Personalization history reset. Your albums, bins, sign-in and playback are unchanged.");
      }
    } catch (error) {
      if (active.current) setMessage(error instanceof Error && /blocked/i.test(error.message)
        ? "Reset is blocked by an older tab. Close other Record Cabinet tabs and try again. History has not been cleared."
        : "History could not be reset. History has not been cleared; please try again.");
    } finally { if (active.current) setBusy(false); }
  }
  if (!engagementAccount(accountId)) return null;
  return <section aria-label="Personalization data">
    <h3>Your browsing and listening data</h3>
    <p>{process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED === "true"
      ? "This test build saves sleeve inspections and listening progress on this device for future discovery features. This history is not uploaded."
      : "Browsing and listening history collection is off in this build. Any history already saved in this browser is still included in your download."}</p>
    <p>Download saved history, album references and personal-bin memberships as JSON. Recent listening may not be saved yet. The file excludes Spotify credentials; it contains personal listening information, so keep it private. For a restorable collection, use Collection backup below.</p>
    <button disabled={disabled || busy} onClick={() => void download()}>Download My Data</button>
    <button disabled={disabled || busy} onClick={() => setConfirming(true)}>Reset Personalization History</button>
    {confirming && <div role="alert">
      <p>Delete this account’s sleeve inspections and listening history from this browser, including other open tabs? Albums, personal bins, genre edits, import progress, cloud data and Spotify sign-in stay. Music keeps playing.</p>
      <p>This cannot be undone. Download your data first if you want a copy. With tracking enabled, new actions start fresh history; the current record will not count again until you explicitly play or resume it.</p>
      <button disabled={disabled || busy} onClick={() => void reset()}>Reset history</button>
      <button disabled={busy} onClick={() => setConfirming(false)}>Cancel reset</button>
    </div>}
    <p role="status">{message}</p>
  </section>;
}
