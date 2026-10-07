import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";

export const SESSION = "rc_spotify";
export const FLOW = "rc_spotify_flow";
export type Session = { accessToken: string; refreshToken: string; expiresAt: number; scope?: string; accountId?: string };
// Only explicitly registered callbacks may be selected. Never construct one
// from an arbitrary Host or X-Forwarded-Host header.
export function config(request?: { headers: Headers; url?: string }) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const primary = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !primary || !process.env.SPOTIFY_SESSION_SECRET) throw new Error("Spotify configuration missing");
  const redirects = [primary, ...(process.env.SPOTIFY_ADDITIONAL_REDIRECT_URIS ?? "").split(",").map(value => value.trim()).filter(Boolean)].map(value => {
    const redirect = new URL(value);
    if ((redirect.protocol !== "https:" && !(redirect.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(redirect.hostname))) || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== "/api/spotify/callback") throw new Error("Invalid redirect URI");
    return redirect;
  });
  const host = (request?.headers.get("host") ?? (request?.url ? new URL(request.url).host : "")).toLowerCase();
  // localhost is a convenient entry point; OAuth itself uses the registered IP.
  const localAlias = host.replace(/^localhost(?=:|$)/, "127.0.0.1");
  const redirect = redirects.find(value => value.host.toLowerCase() === host) ?? redirects.find(value => value.host.toLowerCase() === localAlias) ?? redirects[0];
  return { clientId, redirectUri: redirect.href, origin: redirect.origin, publicOrigin: redirects.find(value => value.protocol === "https:")?.origin };
}
function key() {
  const secret = process.env.SPOTIFY_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Session key missing");
  return createHash("sha256").update(secret).digest();
}
export function seal(value: unknown, ttl: number) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ value, until: Date.now() + ttl * 1000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function unseal<T>(value?: string): T | null {
  if (!value) return null;
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
    return payload.until > Date.now() ? payload.value as T : null;
  } catch { return null; }
}
export async function getSession() { return unseal<Session>((await cookies()).get(SESSION)?.value); }
export async function putCookie(name: string, value: unknown, ttl: number) {
  (await cookies()).set(name, seal(value, ttl), { httpOnly: true, sameSite: "lax", secure: config({ headers: await headers() }).origin.startsWith("https:"), path: "/", maxAge: ttl });
}
export async function tokenRequest(params: URLSearchParams): Promise<Session> {
  const response = await fetch("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Token exchange failed");
  const body = await response.json();
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") throw new Error("Invalid token response");
  return { ...(typeof body.scope === "string" ? { scope: body.scope } : {}), accessToken: body.access_token, refreshToken: body.refresh_token ?? params.get("refresh_token") ?? "", expiresAt: Date.now() + body.expires_in * 1000 };
}

export function accountMatches(session: Session, request: Request) {
  return !!session.accountId && request.headers.get("x-record-cabinet-account") === session.accountId;
}
