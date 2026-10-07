import { createHash } from "node:crypto";
import { acquireSpotifySlot, recordSpotifyLimit } from "../../../lib/spotify-shared-gate";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config, FLOW, SESSION, putCookie, tokenRequest, unseal } from "../../../lib/spotify-session";
import { SpotifyError } from "../../../lib/spotify-requests";

export async function GET(request: Request) {
  const { clientId, redirectUri, origin } = config(request);
  const url = new URL(request.url);
  const store = await cookies();
  const flow = unseal<{ state: string; verifier: string; redirectUri?: string }>(store.get(FLOW)?.value);
  store.delete(FLOW);
  const home = new URL("/", origin);
  if (!flow || (flow.redirectUri !== undefined && flow.redirectUri !== redirectUri) || url.searchParams.get("state") !== flow.state || !url.searchParams.get("code") || url.searchParams.has("error")) {
    home.searchParams.set("spotify", "denied");
    return NextResponse.redirect(home);
  }
  try {
    const session = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code: url.searchParams.get("code")!, code_verifier: flow.verifier }));
    await acquireSpotifySlot(request.signal, undefined, true);
    const profile = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    if (!profile.ok) {
      const detail = await profile.json().catch(() => null);
      if (profile.status === 429) await recordSpotifyLimit(profile, detail?.error?.reason, request.signal);
      home.searchParams.set("spotify", profile.status === 403 ? "not-invited" : profile.status === 429 ? "quota" : profile.status === 401 ? "expired" : "failed");
      store.delete(SESSION);
      return NextResponse.redirect(home);
    }
    const identity = await profile.json();
    if (typeof identity.id !== "string" || !identity.id) throw new Error("Missing account identity");
    session.accountId = createHash("sha256").update(identity.id).digest("hex");
    await putCookie(SESSION, session, 60 * 60 * 24 * 30);
  } catch (error) { store.delete(SESSION); home.searchParams.set("spotify", error instanceof SpotifyError && error.status === 429 ? "quota" : error instanceof SpotifyError && error.status === 401 ? "expired" : "unavailable"); }
  return NextResponse.redirect(home);
}
