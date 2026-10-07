"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { observeRequestUsage } from "./lib/request-usage";
import { createLibraryStorage, libraryStorage } from "./lib/library-storage";
import { diagnosticArea, recordDiagnostic, recordPlaybackEvent } from "./lib/beta-diagnostics";

const AccountContext = createContext({ accountId: "guest", storage: libraryStorage, organizationKey: "record-cabinet-systems", apiFetch: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch });
export const useAccount = () => useContext(AccountContext);
export default function AccountProvider({ accountId, children }: { accountId: string; children: React.ReactNode }) {
  const [changed, setChanged] = useState(false);
  const storage = useMemo(() => createLibraryStorage(accountId), [accountId]);
  const value = useMemo(() => ({ accountId, storage, organizationKey: `record-cabinet-systems:${accountId}`, apiFetch: (async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-record-cabinet-account", accountId);
    let response: Response;
    try { response = await fetch(input, { ...init, headers }); }
    catch (error) { const area = diagnosticArea(input); if (area && !init?.signal?.aborted) recordDiagnostic(area, 0); throw error; }
    const area = diagnosticArea(input);
    if (area && !response.ok) recordDiagnostic(area, response.status);
    if (response.status === 409) { recordPlaybackEvent("account-changed"); setChanged(true); }
    return observeRequestUsage(response, usage => { void storage.recordRequestUsage(usage).then(() => window.dispatchEvent(new CustomEvent("record-cabinet-usage", { detail: { scope: accountId } }))).catch(() => {}); });
  }) as typeof fetch }), [accountId, storage]);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => { void fetch("/api/spotify/account", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) { recordPlaybackEvent("account-check-failed"); return; }
      const data = await response.json();
      // A transient error/malformed response is not evidence of an account switch.
      if (typeof data?.accountId === "string" && data.accountId && data.accountId !== accountId) { recordPlaybackEvent("account-changed"); setChanged(true); }
    }).catch(() => {}); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("record-cabinet-account") : null;
    if (channel) channel.onmessage = event => { if (event.data?.removed === accountId) setChanged(true); else check(); };
    const online = () => recordPlaybackEvent("online"), offline = () => recordPlaybackEvent("offline"), visibility = () => recordPlaybackEvent(document.hidden ? "page-hidden" : "page-visible");
    window.addEventListener("online", online); window.addEventListener("offline", offline); document.addEventListener("visibilitychange", visibility);
    check();
    window.addEventListener("focus", check);
    const timer = setInterval(check, 30000);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", visibility); controller.abort(); channel?.close(); clearInterval(timer); window.removeEventListener("focus", check); };
  }, [accountId]);
  if (changed) return <section className="library-message" role="alert"><p>The Spotify account changed in another tab. Reload to open the correct collection.</p><button onClick={() => location.reload()}>Reload collection</button></section>;
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
