import { NextResponse } from "next/server";
import { config, getSession, putCookie, SESSION, tokenRequest, accountMatches } from "../../../../lib/spotify-session";
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
export async function GET(request: Request) {
  let session = await getSession();
  if (!session) return NextResponse.json({ error: "Connect Spotify to play records here." }, { status: 401, headers });
  if (!accountMatches(session, request)) return NextResponse.json({ error: "Your Spotify account changed. Reload this page." }, { status: 409, headers });
  if (!session.scope?.split(" ").includes("streaming")) return NextResponse.json({ error: "Reconnect Spotify once to enable audio inside Record Cabinet." }, { status: 403, headers });
  try {
    if (session.expiresAt < Date.now() + 60000) {
      const refreshed = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: config().clientId }));
      session = { ...session, ...refreshed, scope: refreshed.scope ?? session.scope };
      await putCookie(SESSION, session, 60 * 60 * 24 * 30);
    }
    // The SDK requires a short-lived access token in memory. Refresh tokens
    // remain exclusively in the encrypted HttpOnly session cookie.
    return NextResponse.json({ accessToken: session.accessToken, expiresAt: session.expiresAt }, { headers });
  } catch { return NextResponse.json({ error: "Reconnect Spotify to continue playback." }, { status: 401, headers }); }
}
