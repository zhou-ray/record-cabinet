import { acquireSpotifySlot, recordSpotifyLimit } from "../../../lib/spotify-shared-gate";
import { spotifyFailure } from "../../../lib/spotify-errors";
import { NextResponse } from "next/server";
import { config, getSession, putCookie, SESSION, tokenRequest, accountMatches } from "../../../lib/spotify-session";
import { SpotifyError } from "../../../lib/spotify-requests";
import { normalizeDevice, normalizePlayback, parsePlaybackCommand, playbackRequest } from "../../../lib/spotify-playback";

const headers = { "Cache-Control": "private, no-store" };
async function handle(request: Request, path: string, method = "GET", body?: string) {
  let requests = 0;
  const countedHeaders = () => ({ ...headers, "X-Spotify-Usage": JSON.stringify({ playback: requests }) });
  let session = await getSession();
  if (!session) return NextResponse.json({ error: "Connect Spotify to control playback.", reconnect: true }, { status: 401, headers: countedHeaders() });
  if (!accountMatches(session, request)) return NextResponse.json(spotifyFailure(new SpotifyError(409, null, "ACCOUNT_CHANGED")), { status: 409, headers: countedHeaders() });
  try {
    async function refresh() {
      const previous = session!;
      const previousScope = previous.scope;
      session = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: session!.refreshToken, client_id: config().clientId }));
      session = { ...previous, ...session, scope: session.scope ?? previousScope };
      await putCookie(SESSION, session, 60 * 60 * 24 * 30);
    }
    if (session.expiresAt < Date.now() + 60000) {
      try { await refresh(); }
      catch { return NextResponse.json({ error: "Reconnect Spotify to continue playback.", reconnect: true }, { status: 401, headers: countedHeaders() }); }
    }
    // All import and playback traffic shares the same pacing gate. Never queue
    // a playback mutation behind a long cooldown or retry a timed-out command.
    async function send() {
      await acquireSpotifySlot(request.signal, undefined, true);
      requests++;
      console.info("spotify_request", { category: "playback", stage: method === "GET" ? "state" : "command" });
      return fetch(`https://api.spotify.com/v1${path}`, {
        method, body, headers: { Authorization: `Bearer ${session!.accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      });
    }
    let response = await send();
    if (response.status === 401) {
      await response.body?.cancel();
      try { await refresh(); }
      catch { return NextResponse.json({ error: "Reconnect Spotify to continue playback.", reconnect: true }, { status: 401, headers: countedHeaders() }); }
      response = await send();
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      const reason = detail?.error?.reason;
      if (response.status === 429) await recordSpotifyLimit(response, reason, request.signal);
      throw new SpotifyError(response.status, response.headers.get("retry-after"), reason);
    }
    if (method !== "GET") return NextResponse.json({ accepted: true }, { headers: countedHeaders() });
    const data = response.status === 204 ? null : await response.json();
    if (path === "/me/player/devices") return NextResponse.json({ devices: (data?.devices ?? []).map(normalizeDevice).filter(Boolean) }, { headers: countedHeaders() });
    return NextResponse.json(normalizePlayback(data), { headers: countedHeaders() });
  } catch (error) {
    const failure = spotifyFailure(error);
    return NextResponse.json(failure, { status: failure.status, headers: countedHeaders() });
  }
}
export async function GET(request: Request) {
  return handle(request, new URL(request.url).searchParams.get("view") === "devices" ? "/me/player/devices" : "/me/player");
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== config(request).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  let command;
  try { command = parsePlaybackCommand(await request.json()); }
  catch { return NextResponse.json({ error: "Invalid playback command." }, { status: 400, headers }); }
  const { path, body } = playbackRequest(command);
  return handle(request, path, "PUT", body);
}
