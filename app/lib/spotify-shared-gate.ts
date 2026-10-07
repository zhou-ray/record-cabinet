import "server-only";
import { abortableDelay, retryDelay, SpotifyError, type SpotifyWait } from "./spotify-requests";

// Redis TIME and atomic scripts keep every deployment on one clock and budget.
export const CLAIM = `
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local untilAt=tonumber(redis.call('HGET',KEYS[1],'blocked') or '0')
local reason=redis.call('HGET',KEYS[1],'reason') or ''
if untilAt>now then return {untilAt-now,1,reason,untilAt} end
local nextAt=tonumber(redis.call('HGET',KEYS[1],'next') or '0')
if nextAt>now then return {nextAt-now,0,'',0} end
redis.call('HSET',KEYS[1],'next',now+tonumber(ARGV[1]))
redis.call('PEXPIRE',KEYS[1],86400000)
return {0,0,'',0}`;
export const BLOCK = `
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local old=tonumber(redis.call('HGET',KEYS[1],'blocked') or '0')
local target=now+tonumber(ARGV[1])
if target>old then redis.call('HSET',KEYS[1],'blocked',target,'reason',ARGV[2]) end
redis.call('PEXPIRE',KEYS[1],math.max(86400000,math.max(old,target)-now+60000))
return math.max(old,target)`;
const memory = globalThis as typeof globalThis & { rcGate?: { next: number; blocked: number; reason: string } };
const local = memory.rcGate ??= { next: 0, blocked: 0, reason: "" };
function connection() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) return { url, token };
  if (process.env.VERCEL_ENV === "production") throw new SpotifyError(503, null, "LIMITER_UNAVAILABLE");
  return null;
}
async function evalGate(script: string, args: (string | number)[], signal?: AbortSignal) {
  const remote = connection();
  if (!remote) return null;
  try {
    const response = await fetch(remote.url, { method: "POST", headers: { Authorization: `Bearer ${remote.token}`, "Content-Type": "application/json" }, body: JSON.stringify(["EVAL", script, "1", process.env.SPOTIFY_GATE_KEY ?? "record-cabinet:spotify:developer", ...args]), cache: "no-store", signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(5000)]) });
    if (!response.ok) throw new Error("Limiter unavailable");
    const body = await response.json();
    if (body.error || body.result === undefined) throw new Error("Limiter unavailable");
    return body.result;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof SpotifyError) throw error;
    throw new SpotifyError(503, null, "LIMITER_UNAVAILABLE");
  }
}
export async function acquireSpotifySlot(signal?: AbortSignal, onWait?: (wait: SpotifyWait | null) => void, failOnCooldown = false) {
  let waited = false;
  while (true) {
    signal?.throwIfAborted();
    let result = await evalGate(CLAIM, [1000], signal) as [number, number, string, number] | null;
    if (!result) {
      const now = Date.now();
      result = local.blocked > now ? [local.blocked - now, 1, local.reason, local.blocked] : local.next > now ? [local.next - now, 0, "", 0] : [0, 0, "", 0];
      if (!result[0]) local.next = now + 1000;
    }
    const [delay, blocked, reason, retryAt] = result;
    if (!delay) { if (waited) onWait?.(null); return; }
    // Long pauses end the request instead of keeping a function alive for hours.
    if (blocked && (failOnCooldown || delay > 15000 || reason === "QUOTA_EXCEEDED")) {
      throw new SpotifyError(429, reason === "QUOTA_EXCEEDED_UNKNOWN" ? null : String(Math.ceil(delay / 1000)), reason.startsWith("QUOTA_EXCEEDED") ? "QUOTA_EXCEEDED" : "RATE_LIMITED");
    }
    if (blocked) { waited = true; onWait?.({ retryAt, attempt: 0 }); }
    await abortableDelay(Math.min(delay, 1000), signal);
  }
}
export async function recordSpotifyLimit(response: Response, reason?: string, signal?: AbortSignal) {
  const header = response.headers.get("retry-after");
  const unknown = reason === "QUOTA_EXCEEDED" && !header;
  // This is a conservative probe interval, not a claimed Spotify reset time.
  const delay = unknown ? 60 * 60 * 1000 : retryDelay(header, 0, Date.now());
  const label = unknown ? "QUOTA_EXCEEDED_UNKNOWN" : reason ?? "RATE_LIMITED";
  const result = await evalGate(BLOCK, [delay, label], signal);
  if (result === null && Date.now() + delay > local.blocked) { local.blocked = Date.now() + delay; local.reason = label; }
}
