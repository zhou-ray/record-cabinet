/** A shared gate prevents simultaneous imports from each sending their own burst. */
export type RequestGate = { nextRequestAt: number; blockedUntil: number };
export type SpotifyWait = { retryAt: number; attempt: number };
export class SpotifyError extends Error {
  constructor(public status: number, public retryAfter: string | null = null, public reason?: string) {
    super("Spotify request failed");
  }
}
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function retryDelay(header: string | null, attempt: number, now: number): number {
  const seconds = header?.trim() ? Number(header) : NaN;
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000) + 1000;
  if (Number.isFinite(date)) return Math.max(1000, date - now) + 1000;
  return Math.min(300000, 30000 * 2 ** attempt);
}
export function createSpotifyRequester(
  send: (url: string, signal?: AbortSignal) => Promise<Response>,
  gate: RequestGate,
  options: {
    acquire?: (signal?: AbortSignal) => Promise<void>;
    onLimit?: (response: Response, reason?: string, signal?: AbortSignal) => Promise<void>;
    onWait?: (wait: SpotifyWait | null) => void;
    onRequest?: (attempt: number) => void;
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    interval?: number;
    maxRetries?: number;
    failOnCooldown?: boolean;
  } = {},
) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableDelay;
  const interval = options.interval ?? 1000;
  return async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
    const parsed = new URL(url);
    if (parsed.origin !== "https://api.spotify.com" || !parsed.pathname.startsWith("/v1/")) throw new Error("Invalid API URL");
    for (let attempt = 0; ; attempt++) {
      await options.acquire?.(signal);
      let waiting = false;
      while (true) {
        signal?.throwIfAborted();
        const time = now();
        if (options.failOnCooldown && gate.blockedUntil > time) throw new SpotifyError(429);
        const delay = Math.max(gate.nextRequestAt, gate.blockedUntil) - time;
        if (delay <= 0) { gate.nextRequestAt = time + interval; break; }
        if (gate.blockedUntil > time) {
          waiting = true;
          options.onWait?.({ retryAt: gate.blockedUntil, attempt });
        }
        // Short chunks also handle very long Retry-After values and cancellation.
        await sleep(Math.min(delay, 30000), signal);
      }
      if (waiting) options.onWait?.(null);
      options.onRequest?.(attempt);
      let response: Response;
      try { response = await send(url, signal); }
      catch (error) {
        signal?.throwIfAborted();
        if (error instanceof SpotifyError) throw error;
        throw new SpotifyError(error instanceof Error && error.name === "TimeoutError" ? 504 : 502, null, error instanceof Error && error.name === "TimeoutError" ? "SPOTIFY_TIMEOUT" : "NETWORK_ERROR");
      }
      if (response.ok) {
        try { return await response.json() as T; }
        catch { signal?.throwIfAborted(); throw new SpotifyError(502, null, "INVALID_RESPONSE"); }
      }
      const retryAfter = response.headers.get("retry-after");
      const body = await response.json().catch(() => null);
      const reason = body?.error?.reason;
      if (response.status !== 429) throw new SpotifyError(response.status, retryAfter, reason);
      await options.onLimit?.(response, reason, signal);
      gate.blockedUntil = Math.max(gate.blockedUntil, now() + retryDelay(retryAfter, attempt, now()));
      // A development quota without a reset time cannot be solved by rapid retries.
      if (attempt >= (options.maxRetries ?? 5) || (reason === "QUOTA_EXCEEDED" && !retryAfter)) throw new SpotifyError(429, retryAfter, reason);
    }
  };
}
