import { accountMatches, config, getSession } from "../../lib/spotify-session";
import { findAlbumGenres, findArtistGenres, findAutomaticGenres } from "../../lib/auto-genres";
import { GenreCooldown, musicbrainzRequest } from "../../lib/musicbrainz";
import { findAppleGenres } from "../../lib/apple-genres";
export const maxDuration = 60;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.accountId) return json({ error: "Connect Spotify to organize this account’s library. Genre lookups do not use Spotify quota." }, 401);
  if (!accountMatches(session, request)) return json({ error: "Account changed. Reload your collection." }, 409);
  if (request.headers.get("origin") !== config(request).origin) return json({ error: "Invalid request origin." }, 403);
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 5000) throw new Error();
    body = JSON.parse(raw);
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 300 || typeof body.artist !== "string" || !body.artist.trim() || body.artist.length > 300) throw new Error();
    if (body.artists !== undefined && (!Array.isArray(body.artists) || body.artists.length > 10 || body.artists.some((name: unknown) => typeof name !== "string" || !name.trim() || name.length > 300))) throw new Error();
    if (body.refreshAfter !== undefined && (!Number.isFinite(body.refreshAfter) || body.refreshAfter < 0 || body.refreshAfter > Date.now() + 300000)) throw new Error();
    if (body.depth !== undefined && !["quick", "deep", "full"].includes(body.depth)) throw new Error();
    if (body.mode !== undefined && !["artist", "album", "apple"].includes(body.mode)) throw new Error();
  } catch { return json({ error: "Choose an album with a title and artist." }, 400); }
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const artists: string[] = body.artists?.length ? body.artists : [body.artist];
    if (body.mode === "album") return json(await findAlbumGenres(body.title, artists, path => musicbrainzRequest(path, signal)));
    if (body.mode === "apple") return json(await findAppleGenres(body.title, artists, signal, body.refreshAfter, body.depth));
    return json(await (body.mode === "artist"
      ? findArtistGenres(body.artist, path => musicbrainzRequest(path, signal))
      : findAutomaticGenres(body.title, body.artist, path => musicbrainzRequest(path, signal))));
  } catch (error) {
    if (error instanceof GenreCooldown) return Response.json({ error: error.message, retryAfter: error.retryAfter, provider: error.provider }, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(error.retryAfter) } });
    return json({ error: "Genre lookup paused. Completed albums are saved. Try again when the connection is available." }, 503); }
}
