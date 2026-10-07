import type { BrowserPlayer, BrowserPlayback } from "./spotify-browser";
export function playerDeadline<T>(operation: Promise<T>, milliseconds = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("The browser player did not respond.")), milliseconds); })]).finally(() => clearTimeout(timer));
}
/** A pause acknowledgement alone does not prove that audio stopped. */
export async function pausePlayer(player: Pick<BrowserPlayer, "pause" | "getCurrentState">, fallback: () => Promise<void>, milliseconds = 3000): Promise<BrowserPlayback | null> {
  try { await playerDeadline(player.pause(), milliseconds); } catch { /* Try the targeted Web API pause if the SDK cannot confirm. */ }
  const state = await playerDeadline(player.getCurrentState(), milliseconds).catch(() => null);
  if (state?.paused) return state;
  await fallback(); // One explicit pause fallback; never retry a rejected Web API command.
  return null;
}
