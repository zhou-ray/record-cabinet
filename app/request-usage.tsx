"use client";
import { useEffect, useState } from "react";
import { useAccount } from "./account-context";
import { emptyUsage, type RequestUsage } from "./lib/request-usage";
export default function RequestUsagePanel() {
  const { storage, accountId } = useAccount();
  const [days, setDays] = useState<Record<string, RequestUsage>>({});
  const [error, setError] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    let active = true;
    const load = () => { void storage.loadRequestUsage().then(value => { if (active) { setDays(value); setError(false); } }).catch(() => { if (active) setError(true); }); };
    const update = (event: Event) => { if ((event as CustomEvent).detail?.scope === accountId) load(); };
    load(); window.addEventListener("record-cabinet-usage", update);
    return () => { active = false; window.removeEventListener("record-cabinet-usage", update); };
  }, [storage, accountId]);
  const total = Object.values(days[today] ?? emptyUsage()).reduce((a, b) => a + b, 0);
  return <details className="collection-tools"><summary>Spotify requests · {total} today</summary>
    <p>Observed API requests for this account in this browser, including retries. Days use UTC. These are not Spotify’s remaining quota and exclude other devices, token exchange, and traffic inside Spotify’s player.</p>
    {error ? <p role="status">Usage could not be read. Music and imports are unaffected.</p> : <div className="usage-table"><table><thead><tr><th>Day</th><th>Imports</th><th>Album details</th><th>Search</th><th>Playback</th></tr></thead><tbody>{[...new Set([today, ...Object.keys(days)])].sort().reverse().slice(0, 7).map(day => { const count = days[day] ?? emptyUsage(); return <tr key={day}><th>{day}</th><td>{count.import}</td><td>{count.metadata}</td><td>{count.search}</td><td>{count.playback}</td></tr>; })}</tbody></table></div>}
    <p>Requests from a connection that closes before reporting usage may be missing. Tracking starts with this app update.</p>
  </details>;
}
