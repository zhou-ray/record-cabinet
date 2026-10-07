import "server-only";
import { createHash } from "node:crypto";
import { command } from "./cloud-store";
import { abortableDelay } from "./spotify-requests";
export class GenreCooldown extends Error {
  constructor(public retryAfter: number, public provider = "MusicBrainz") { super(`${provider} needs a pause.`); }
}
const CLAIM = "if redis.call('EXISTS',KEYS[1])==1 then return redis.call('PTTL',KEYS[1]) end redis.call('SET',KEYS[1],'1','PX',1200) return 0";
export async function musicbrainzRequest<T>(path: string, signal: AbortSignal): Promise<T> {
  if (!/^(release-group|artist)\//.test(path)) throw new Error("Invalid metadata request.");
  const key = "record-cabinet:musicbrainz:v1:" + createHash("sha256").update(path).digest("hex");
  signal.throwIfAborted();
  const cached = await command(["GET", key]);
  if (cached) return JSON.parse(cached) as T;
  // One shared clock across deployments; fail closed if Redis is unavailable.
  for (;;) {
    signal.throwIfAborted();
    const delay = Number(await command(["EVAL", CLAIM, 1, "record-cabinet:musicbrainz:pace"]));
    if (!delay) break;
    if (delay > 1500) throw new GenreCooldown(Math.ceil(delay / 1000));
    await abortableDelay(Math.max(100, Math.min(delay, 1200)), signal);
  }
  signal.throwIfAborted();
  const response = await fetch("https://musicbrainz.org/ws/2/" + path, {
    headers: { Accept: "application/json", "User-Agent": "RecordCabinet/1.0 (https://record-cabinet-livid.vercel.app/privacy)" },
    signal, cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 429 || response.status === 503) {
      await command(["SET", "record-cabinet:musicbrainz:pace", "1", "PX", 60000]);
      throw new GenreCooldown(60);
    }
    throw new Error("Genre lookup is temporarily unavailable. Completed albums are saved; try again later.");
  }
  const data = await response.json();
  // Cache public catalog metadata only; failed requests are never cached.
  await command(["SET", key, JSON.stringify(data), "EX", 30 * 24 * 60 * 60]);
  return data as T;
}
