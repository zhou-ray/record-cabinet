import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { NextResponse } from "next/server.js";

process.env.SPOTIFY_CLIENT_ID = "test-client";
process.env.SPOTIFY_REDIRECT_URI = "http://127.0.0.1:3000/api/spotify/callback";
process.env.SPOTIFY_SESSION_SECRET = "test-key-not-used-outside-tests-123456789";
const jar = new Map();
const cookieOptions = new Map();
let requestHeaders = new Headers();
const store = { get: key => jar.has(key) ? { value: jar.get(key) } : undefined, set: (key, value, options) => { jar.set(key, value); cookieOptions.set(key, options); }, delete: key => jar.delete(key) };
function load(file, dependencies) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
  const result = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`)((name) => {
    if (!(name in dependencies)) throw new Error(`Missing test dependency ${name}`);
    return dependencies[name];
  }, result, result.exports);
  return result.exports;
}
const session = load("app/lib/spotify-session.ts", { "server-only": {}, "node:crypto": crypto, "next/headers": { cookies: async () => store, headers: async () => requestHeaders } });
const dependencies = { "../../../lib/spotify-shared-gate": { acquireSpotifySlot: async () => {}, recordSpotifyLimit: async () => {} }, "../../../lib/spotify-session": session, "node:crypto": crypto, "next/server": { NextResponse }, "next/headers": { cookies: async () => store, headers: async () => requestHeaders } };
const login = load("app/api/spotify/login/route.ts", dependencies);
dependencies["../../../lib/spotify-requests"] = load("app/lib/spotify-requests.ts", {});
const callback = load("app/api/spotify/callback/route.ts", dependencies);

test("session encryption rejects tampering and expiration", () => {
  const encoded = session.seal({ accessToken: "private-token" }, 10);
  assert.ok(!encoded.includes("private-token"));
  assert.equal(session.unseal(encoded).accessToken, "private-token");
  const changed = Buffer.from(encoded, "base64url"); changed[30] ^= 1;
  assert.equal(session.unseal(changed.toString("base64url")), null);
  assert.equal(session.unseal(session.seal({ value: 1 }, -1)), null);
});
test("login canonicalizes host and uses PKCE with library, playlist, and playback permissions", async () => {
  const redirect = await login.GET(new Request("http://localhost:3000/api/spotify/login"));
  assert.equal(redirect.headers.get("location"), "http://127.0.0.1:3000/api/spotify/login?canonical=1");
  const response = await login.GET(new Request("http://127.0.0.1:3000/api/spotify/login"));
  const url = new URL(response.headers.get("location"));
  const flow = session.unseal(jar.get(session.FLOW));
  assert.equal(url.searchParams.get("scope"), "user-library-read playlist-read-private playlist-read-collaborative user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private");
  assert.equal(url.searchParams.get("code_challenge"), crypto.createHash("sha256").update(flow.verifier).digest("base64url"));
  assert.equal(url.searchParams.get("state"), flow.state);
});
test("callback rejects mismatched state and consumes the flow cookie", async () => {
  await session.putCookie(session.FLOW, { state: "expected", verifier: "verifier" }, 600);
  const response = await callback.GET(new Request("http://127.0.0.1:3000/api/spotify/callback?state=wrong&code=code"));
  assert.equal(new URL(response.headers.get("location")).searchParams.get("spotify"), "denied");
  assert.equal(jar.has(session.FLOW), false);
  assert.equal(jar.has(session.SESSION), false);
});
test("valid callback exchanges code, saves encrypted session, and cannot replay", async () => {
  await session.putCookie(session.FLOW, { state: "expected", verifier: "verifier" }, 600);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url === "https://api.spotify.com/v1/me") return Response.json({ id: "tester" });
    assert.equal(url, "https://accounts.spotify.com/api/token");
    assert.equal(options.body.get("code_verifier"), "verifier");
    return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  };
  try {
    const request = new Request("http://127.0.0.1:3000/api/spotify/callback?state=expected&code=code");
    const response = await callback.GET(request);
    assert.equal(response.headers.get("location"), "http://127.0.0.1:3000/");
    assert.equal((await session.getSession()).refreshToken, "refresh");
    const replay = await callback.GET(request);
    assert.equal(new URL(replay.headers.get("location")).searchParams.get("spotify"), "denied");
  } finally { globalThis.fetch = original; }
});
test("refresh retains the old refresh token when Spotify does not rotate it", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ access_token: "renewed", expires_in: 3600 });
  try {
    const value = await session.tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: "old-refresh" }));
    assert.equal(value.refreshToken, "old-refresh");
    assert.equal(value.accessToken, "renewed");
    assert.ok(value.expiresAt > Date.now());
  } finally { globalThis.fetch = original; }
});

test("login accepts browser Host when Next.js rewrites the request URL", async () => {
  const response = await login.GET(new Request("http://localhost:3000/api/spotify/login", { headers: { host: "127.0.0.1:3000" } }));
  assert.equal(new URL(response.headers.get("location")).origin, "https://accounts.spotify.com");
});
test("host mismatch cannot cause an unbounded redirect loop", async () => {
  const response = await login.GET(new Request("http://localhost:3000/api/spotify/login?canonical=1", { headers: { host: "localhost:3000" } }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("location"), null);
});

test('LAN login never redirects a phone to loopback',async()=>{
 const response=await login.GET(new Request('http://localhost:3000/api/spotify/login',{headers:{host:'192.168.1.25:3000'}}));
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/?spotify=mobile-setup');
});
test('configured HTTPS mobile host begins OAuth with its registered callback',async()=>{
 const previous=process.env.SPOTIFY_REDIRECT_URI;
 try {
  process.env.SPOTIFY_REDIRECT_URI='https://cabinet.example.com/api/spotify/callback';
  const response=await login.GET(new Request('http://localhost:3000/api/spotify/login',{headers:{host:'cabinet.example.com'}}));
  assert.equal(new URL(response.headers.get('location')).searchParams.get('redirect_uri'),process.env.SPOTIFY_REDIRECT_URI);
 }finally{process.env.SPOTIFY_REDIRECT_URI=previous;}
});


test('desktop and HTTPS OAuth coexist, including callback exchange and cookie security', async () => {
  const previous = process.env.SPOTIFY_ADDITIONAL_REDIRECT_URIS;
  const originalFetch = globalThis.fetch;
  process.env.SPOTIFY_ADDITIONAL_REDIRECT_URIS = 'https://cabinet.example.com/api/spotify/callback';
  try {
    for (const origin of ['http://127.0.0.1:3000', 'https://cabinet.example.com']) {
      jar.clear(); requestHeaders = new Headers({ host: new URL(origin).host });
      const response = await login.GET(new Request(origin + '/api/spotify/login', { headers: requestHeaders }));
      const authorization = new URL(response.headers.get('location'));
      assert.equal(authorization.origin, 'https://accounts.spotify.com');
      assert.equal(authorization.searchParams.get('redirect_uri'), origin + '/api/spotify/callback');
      assert.equal(cookieOptions.get(session.FLOW).secure, origin.startsWith('https:'));
      globalThis.fetch = async (_url, options) => {
        if (_url === 'https://api.spotify.com/v1/me') return Response.json({ id: 'tester' });
        assert.equal(options.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
        return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
      };
      const callbackResponse = await callback.GET(new Request(origin + '/api/spotify/callback?code=mock&state=' + authorization.searchParams.get('state'), { headers: requestHeaders }));
      assert.equal(callbackResponse.headers.get('location'), origin + '/');
      assert.equal(cookieOptions.get(session.SESSION).secure, origin.startsWith('https:'));
      const logout = load('app/api/spotify/logout/route.ts', dependencies);
      const forbidden = await logout.POST(new Request(origin + '/api/spotify/logout', { method: 'POST', headers: { host: new URL(origin).host, origin: 'https://foreign.example' } }));
      assert.equal(forbidden.status, 403);
      const signedOut = await logout.POST(new Request(origin + '/api/spotify/logout', { method: 'POST', headers: { host: new URL(origin).host, origin, 'x-record-cabinet-account': (await session.getSession()).accountId } }));
      assert.equal(signedOut.headers.get('location'), origin + '/');
      assert.equal(jar.has(session.SESSION), false);
    }
    const mobile = await login.GET(new Request('http://192.168.1.140:3000/api/spotify/login'));
    assert.equal(mobile.headers.get('location'), 'https://cabinet.example.com/api/spotify/login');
    const alias = await login.GET(new Request('http://localhost:3000/api/spotify/login'));
    assert.equal(new URL(alias.headers.get('location')).origin, 'http://127.0.0.1:3000');
    const unknown = session.config({ headers: new Headers({ host: 'attacker.example', 'x-forwarded-host': 'cabinet.example.com' }) });
    assert.equal(unknown.origin, 'http://127.0.0.1:3000');
  } finally {
    if (previous === undefined) delete process.env.SPOTIFY_ADDITIONAL_REDIRECT_URIS; else process.env.SPOTIFY_ADDITIONAL_REDIRECT_URIS = previous;
    globalThis.fetch = originalFetch; requestHeaders = new Headers(); jar.clear();
  }
});
test('callback refuses a flow issued for another origin without exchanging the code', async () => {
  await session.putCookie(session.FLOW, { state: 'expected', verifier: 'v', redirectUri: 'https://elsewhere.example/api/spotify/callback' }, 600);
  const response = await callback.GET(new Request('http://127.0.0.1:3000/api/spotify/callback?state=expected&code=mock'));
  assert.equal(new URL(response.headers.get('location')).searchParams.get('spotify'), 'denied');
  assert.equal(jar.has(session.SESSION), false);
});

test('account matching rejects stale tabs, missing headers, and legacy sessions', () => {
  const request = id => new Request('http://127.0.0.1:3000/api/spotify/library', { headers: id ? { 'x-record-cabinet-account': id } : {} });
  assert.equal(session.accountMatches({ accountId:'alice' }, request('alice')), true);
  assert.equal(session.accountMatches({ accountId:'bob' }, request('alice')), false);
  assert.equal(session.accountMatches({ accountId:'alice' }, request()), false);
  assert.equal(session.accountMatches({}, request('alice')), false);
});
test('non-allowlisted OAuth profile is rejected without saving a session', async () => {
  const old = globalThis.fetch;
  await session.putCookie(session.FLOW, { state:'invite', verifier:'v' }, 600);
  globalThis.fetch = async url => url.endsWith('/api/token') ? Response.json({access_token:'test',refresh_token:'test',expires_in:3600}) : Response.json({}, {status:403});
  try {
    const response = await callback.GET(new Request('http://127.0.0.1:3000/api/spotify/callback?state=invite&code=mock'));
    assert.equal(new URL(response.headers.get('location')).searchParams.get('spotify'), 'not-invited');
    assert.equal(jar.has(session.SESSION), false);
  } finally { globalThis.fetch = old; }
});
test('OAuth distinguishes expired access, quota pause, and shared gate cooldown', async () => {
 const old = globalThis.fetch;
 const gate = dependencies['../../../lib/spotify-shared-gate'];
 const acquire = gate.acquireSpotifySlot;
 try {
  for (const [status, expected] of [[401, 'expired'], [429, 'quota']]) {
   await session.putCookie(session.FLOW, {state:'test',verifier:'v'},600);
   globalThis.fetch = async url => url.endsWith('/api/token') ? Response.json({access_token:'test',expires_in:3600}) : Response.json({}, {status});
   const response = await callback.GET(new Request('http://127.0.0.1:3000/api/spotify/callback?state=test&code=mock'));
   assert.equal(new URL(response.headers.get('location')).searchParams.get('spotify'),expected);
   assert.equal(jar.has(session.SESSION),false);
  }
  gate.acquireSpotifySlot = async () => { throw new dependencies['../../../lib/spotify-requests'].SpotifyError(429); };
  await session.putCookie(session.FLOW,{state:'test',verifier:'v'},600);
  const response = await callback.GET(new Request('http://127.0.0.1:3000/api/spotify/callback?state=test&code=mock'));
  assert.equal(new URL(response.headers.get('location')).searchParams.get('spotify'),'quota');
 } finally { globalThis.fetch = old;gate.acquireSpotifySlot = acquire; }
});
