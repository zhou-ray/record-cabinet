import { engagementAccount } from "./engagement";

type Trace = { time: number; action: "Sleeve opened" | "Start requested" | "Resume requested" | "Inspection requested" | "Session confirmed" | "Tracking ended"; albumId: string | null; id?: string };
type Observation = { time: number; selectedAlbum: string | null; reportedAlbum: string | null; playing: boolean;
  reportedTrack: string | null; linkedTrack: string | null; matchedTrack: string | null; context: string | null };
let owner = "";
let actions: Trace[] = [];
let observation: Observation | null = null;
function scope(account: string) {
  if (process.env.NEXT_PUBLIC_ENGAGEMENT_ENABLED !== "true" || !engagementAccount(account)) return false;
  if (owner !== account) { owner = account; actions = []; observation = null; }
  return true;
}
/** Test-build-only, bounded memory. Never included in uploaded diagnostics or storage. */
export function traceEngagement(account: string, action: Trace["action"], albumId: string | null, id?: string) {
  if (!scope(account)) return;
  actions.push({ time: Date.now(), action, albumId, ...(id ? { id } : {}) });
  if (actions.length > 60) actions.shift();
}
export function observeEngagementDebug(account: string, value: Omit<Observation, "time">) {
  if (scope(account)) observation = { ...value, time: Date.now() };
}
export function readEngagementDebug(account: string) {
  return scope(account) ? { actions: [...actions], observation } : { actions: [], observation: null };
}
export function clearEngagementDebug(account: string) {
  if (owner === account) { owner = ""; actions = []; observation = null; }
}
