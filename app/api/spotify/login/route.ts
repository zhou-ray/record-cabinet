import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { config, FLOW, putCookie } from "../../../lib/spotify-session";

export async function GET(request: Request) {
  try {
    const { clientId, redirectUri, origin, publicOrigin } = config(request);
    // Next.js can normalize request.url to localhost even when the browser
    // requested 127.0.0.1. Compare the incoming Host header, not that internal URL.
    const incoming = new URL(request.url);
    const host = request.headers.get("host") ?? incoming.host;
    const canonical = new URL(origin);
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const browserHost = new URL(`http://${host}`).hostname;
    if (localHosts.has(canonical.hostname) && !localHosts.has(browserHost)) {
      // Send LAN visitors to the configured secure app before creating cookies.
      if (publicOrigin) return NextResponse.redirect(new URL("/api/spotify/login", publicOrigin));
      // A phone must never be sent to its own loopback interface.
      return new Response(null, { status: 303, headers: { Location: "/?spotify=mobile-setup", "Cache-Control": "no-store" } });
    }
    if (host.toLowerCase() !== canonical.host.toLowerCase()) {
      if (incoming.searchParams.has("canonical")) {
        return NextResponse.json({ error: "The server is not preserving the browser host. Open the app on the configured Spotify callback host." }, { status: 400 });
      }
      const destination = new URL("/api/spotify/login", origin);
      destination.searchParams.set("canonical", "1");
      return NextResponse.redirect(destination);
    }
    const verifier = randomBytes(48).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    await putCookie(FLOW, { verifier, state, redirectUri }, 600);
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: "user-library-read playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private", state, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
    return NextResponse.redirect(url);
  } catch { return NextResponse.json({ error: "Spotify setup is incomplete. Check the server environment variables." }, { status: 503 }); }
}
