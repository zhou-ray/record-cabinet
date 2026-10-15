import { engagementAccount } from "./engagement";
import { clearEngagementDebug } from "./engagement-debug";
export const HISTORY_RESET_EVENT = "record-cabinet-history-reset";
const CHANNEL = "record-cabinet-history";
type Notice = { accountId: string; generation: number };
function valid(value: unknown): value is Notice {
  if (!value || typeof value !== "object") return false;
  const notice = value as Notice;
  return typeof notice.accountId === "string" && engagementAccount(notice.accountId)
    && Number.isSafeInteger(notice.generation) && notice.generation > 0;
}
/** Notifications update UI promptly. IndexedDB's generation fence provides correctness. */
export function signalHistoryReset(accountId: string, generation: number) {
  if (!valid({ accountId, generation })) return;
  clearEngagementDebug(accountId);
  window.dispatchEvent(new CustomEvent(HISTORY_RESET_EVENT, { detail: { accountId, generation } }));
}
export function publishHistoryReset(accountId: string, generation: number) {
  signalHistoryReset(accountId, generation);
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ accountId, generation }); channel.close();
  } catch { /* Suspended/unsupported tabs still encounter the durable fence. */ }
}
export function subscribeHistoryReset(accountId: string, callback: (generation: number) => void) {
  let seen = 0;
  const receive = (value: unknown) => {
    if (!valid(value) || value.accountId !== accountId || value.generation <= seen) return;
    seen = value.generation; clearEngagementDebug(accountId); callback(value.generation);
  };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  window.addEventListener(HISTORY_RESET_EVENT, local);
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = event => receive(event.data); } catch { /* Optional. */ }
  return () => { window.removeEventListener(HISTORY_RESET_EVENT, local); channel?.close(); };
}
