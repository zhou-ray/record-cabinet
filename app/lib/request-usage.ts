export type RequestUsage = { import: number; metadata: number; search: number; playback: number };
export const emptyUsage = (): RequestUsage => ({ import: 0, metadata: 0, search: 0, playback: 0 });
export function parseUsage(value: unknown): RequestUsage {
  const result = emptyUsage();
  if (value && typeof value === "object") for (const key of Object.keys(result) as (keyof RequestUsage)[]) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number === "number" && Number.isSafeInteger(number) && number >= 0 && number <= 1000000) result[key] = number;
  }
  return result;
}
/** Observe usage without consuming, buffering, or changing the caller's stream. */
export function observeRequestUsage(response: Response, record: (usage: RequestUsage) => void): Response {
  const previous = emptyUsage();
  const observe = (value: unknown) => {
    const next = parseUsage(value), delta = emptyUsage();
    for (const key of Object.keys(delta) as (keyof RequestUsage)[]) { delta[key] = Math.max(0, next[key] - previous[key]); previous[key] = Math.max(previous[key], next[key]); }
    if (Object.values(delta).some(Boolean)) { try { record(delta); } catch { /* Metrics never interrupt playback/import. */ } }
  };
  try { observe(JSON.parse(response.headers.get("X-Spotify-Usage") ?? "null")); } catch {}
  if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) return response;
  const decoder = new TextDecoder(); let buffer = "";
  const consume = (text: string) => { try { const event = JSON.parse(text); if (event.usage) observe(event.usage); } catch {} };
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk); buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (buffer.length > 2_000_000) buffer = "";
    },
    flush() { buffer += decoder.decode(); if (buffer.trim()) consume(buffer); },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
