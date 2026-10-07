import { checkPlaylistPage, PlaylistIdentityError } from "../../../lib/playlist-preview";
import { acquireSpotifySlot, recordSpotifyLimit } from "../../../lib/spotify-shared-gate";
import { spotifyFailure } from "../../../lib/spotify-errors";
import { applyArtistGenres, createGenreResolver, type GenreCache } from "../../../lib/genres";
import { spotifyAlbumId } from "../../../lib/spotify-album-link";
import { NextResponse } from "next/server";
import { ImportDataError, createSpotifyLibrary, loadSpotifyAlbum, parseImportCheckpoint, type ImportCheckpoint, type ImportSource, type SpotifyPage } from "../../../data/spotify";
import { config, getSession, putCookie, SESSION, tokenRequest, accountMatches } from "../../../lib/spotify-session";

import { createSpotifyRequester, SpotifyError, type RequestGate, type SpotifyWait } from "../../../lib/spotify-requests";

// Allow paced album batches to stream within the hosting function limit.
export const maxDuration = 300;

const shared = globalThis as typeof globalThis & { spotifyRequestGate?: RequestGate };
const gate = shared.spotifyRequestGate ??= { nextRequestAt: 0, blockedUntil: 0 };
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("list") !== "playlists") return NextResponse.json({ error: "Start an import explicitly." }, { status: 405 });
  return importLibrary(request);
}
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== config(request).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid import request." }, { status: 400 }); }
  if (payload && typeof payload === "object" && "previewPlaylist" in payload) {
    if (typeof payload.previewPlaylist !== "string" || !/^[a-zA-Z0-9]{1,64}$/.test(payload.previewPlaylist)) return NextResponse.json({ error: "Invalid playlist." }, { status: 400 });
    return importLibrary(request, [], { previewPlaylist: payload.previewPlaylist });
  }
  if (payload && typeof payload === "object" && "search" in payload) {
    if (typeof payload.search !== "string" || payload.search.trim().length < 2 || payload.search.trim().length > 200) return NextResponse.json({ error: "Enter an album or artist name (2–200 characters)." }, { status: 400 });
    return importLibrary(request, [], { search: payload.search.trim() });
  }
  if (payload && typeof payload === "object" && "genreArtists" in payload) {
    const ids = payload.genreArtists;
    if (!Array.isArray(ids) || ids.length > 10 || !ids.length || ids.some(id => typeof id !== "string" || !/^spotify:[a-zA-Z0-9]{1,64}$/.test(id))) return NextResponse.json({ error: "Choose up to ten artists." }, { status: 400 });
    return importLibrary(request, [], { genreArtists: [...new Set(ids)] });
  }
  if (payload && typeof payload === "object" && "trackUri" in payload) {
    const match = typeof payload.trackUri === "string" && /^spotify:track:([a-zA-Z0-9]{1,64})$/.exec(payload.trackUri);
    if (!match) return NextResponse.json({ error: "Invalid exported track." }, { status: 400 });
    return importLibrary(request, [], { trackId: match[1] });
  }
  if (payload && typeof payload === "object" && "albumLink" in payload) {
    try {
      if (typeof payload.albumLink !== "string") throw new Error("Invalid album link");
      return importLibrary(request, [], { albumId: spotifyAlbumId(payload.albumLink) });
    } catch { return NextResponse.json({ error: "Paste a valid Spotify album link." }, { status: 400 }); }
  }
  const ids = payload && typeof payload === "object" && "knownAlbumIds" in payload ? payload.knownAlbumIds : null;
  if (!Array.isArray(ids) || ids.length > 100000 || ids.some(id => typeof id !== "string" || !/^spotify:[a-zA-Z0-9]{1,64}$/.test(id))) {
    return NextResponse.json({ error: "Invalid saved album list." }, { status: 400 });
  }
  const body = payload as { batchSize?: number; checkpoint?: unknown; completedSnapshot?: unknown; confirmedSnapshot?: unknown };
  const batchSize = body.batchSize ?? 100;
  if (![5, 10, 50, 100, 250].includes(batchSize)) return NextResponse.json({ error: "Choose a supported import batch size." }, { status: 400 });
  let checkpoint: ImportCheckpoint | null;
  try { checkpoint = parseImportCheckpoint(body.checkpoint, (new URL(request.url).searchParams.get("source") ?? "saved") as ImportSource); }
  catch { return NextResponse.json({ error: "Invalid import position. Start a fresh scan." }, { status: 400 }); }
  const source = new URL(request.url).searchParams.get("source") ?? "saved";
  if (source.startsWith("playlist:") && (typeof body.confirmedSnapshot !== "string" || !body.confirmedSnapshot || body.confirmedSnapshot.length > 512)) return NextResponse.json({ error: "Preview this playlist before importing." }, { status: 400 });
  return importLibrary(request, [...new Set(ids)], { confirmedSnapshot: typeof body.confirmedSnapshot === "string" ? body.confirmedSnapshot : undefined, batchSize, checkpoint, maxPages: 5, completedSnapshot: typeof body.completedSnapshot === "string" && body.completedSnapshot.length <= 512 ? body.completedSnapshot : undefined });
}
async function importLibrary(request: Request, knownAlbumIds: string[] = [], options: { previewPlaylist?: string; confirmedSnapshot?: string; search?: string; genreArtists?: string[]; albumId?: string; trackId?: string; batchSize?: number; checkpoint?: ImportCheckpoint | null; maxPages?: number; completedSnapshot?: string } = {}) {
  let session = await getSession();
  const headers = { "Cache-Control": "private, no-store, no-transform" };
  if (!session) return NextResponse.json({ error: "Connect Spotify to load your saved albums." }, { status: 401, headers });
  if (!accountMatches(session, request)) return NextResponse.json(spotifyFailure(new SpotifyError(409, null, "ACCOUNT_CHANGED"), "import"), { status: 409, headers });
  async function refresh() {
    try {
      const previous = session!;
      const previousScope = previous.scope;
      session = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: session!.refreshToken, client_id: config().clientId }));
      session = { ...previous, ...session, scope: session.scope ?? previousScope };
      await putCookie(SESSION, session, 60 * 60 * 24 * 30);
    } catch { throw new SpotifyError(401); }
  }
  const usage = { import: 0, metadata: 0, search: 0 };
  let reportUsage: (() => void) | undefined;
  const usageHeaders = () => ({ ...headers, "X-Spotify-Usage": JSON.stringify(usage) });
  let lastRequest = "initializing";
  const reportFailure = (error: unknown) => {
    const failure = spotifyFailure(error, "import");
    const reference = crypto.randomUUID().slice(0, 8);
    // Do not log tokens, account IDs, playlist/album IDs, bodies, or raw errors.
    console.warn("spotify_import_failed", { reference, stage: lastRequest, paginationIssue: error instanceof ImportDataError ? error.paginationIssue : undefined, status: failure.status, reason: failure.reason ?? "UNEXPECTED_IMPORT_ERROR", errorType: error instanceof Error ? error.name : "unknown" });
    const message = `${error instanceof PlaylistIdentityError ? error.message : failure.message} Reference: ${reference}.`;
    return { ...failure, reference, message, error: message };
  };
  try {
    if (session.expiresAt < Date.now() + 60000) await refresh();
    let streaming = false;
    let onRequest: ((attempt: number) => void) | undefined;
    let onWait: ((wait: SpotifyWait | null) => void) | undefined;
    const sendSpotify = async (url: string, signal?: AbortSignal) => {
      const path = new URL(url).pathname;
      lastRequest = path.startsWith("/v1/tracks/") ? "export-track" : path.endsWith("/tracks") && path.startsWith("/v1/albums/") ? "album-tracks" : path.startsWith("/v1/albums/") ? "album-details" : path.startsWith("/v1/playlists/") ? "playlist-items" : path === "/v1/me/tracks" ? "liked-songs" : path === "/v1/me/albums" ? "saved-albums" : "playlists";
      const send = () => {
        const category = options.albumId || options.trackId || options.genreArtists ? "metadata" : options.search ? "search" : "import";
        usage[category]++; reportUsage?.();
        console.info("spotify_request", { category, stage: lastRequest });
        return fetch(url, { headers: { Authorization: `Bearer ${session!.accessToken}` }, cache: "no-store", signal: AbortSignal.any([signal ?? request.signal, AbortSignal.timeout(20000)]) });
      };
      let response = await send();
      if (response.status === 401 && !streaming) { await response.body?.cancel(); await refresh(); await acquireSpotifySlot(signal, wait => onWait?.(wait)); response = await send(); }
      return response;
    };
    const spotifyRequest = createSpotifyRequester(sendSpotify, gate, { acquire: signal => acquireSpotifySlot(signal, wait => onWait?.(wait)), onLimit: recordSpotifyLimit, maxRetries: 1, onWait: wait => onWait?.(wait), onRequest: attempt => onRequest?.(attempt) });
    // Optional genre lookups must not hold a saved album behind a long cooldown.
    const genreRequest = createSpotifyRequester(sendSpotify, gate, { acquire: signal => acquireSpotifySlot(signal, undefined, true), onLimit: recordSpotifyLimit, maxRetries: 0, failOnCooldown: true });
    const genreShared = globalThis as typeof globalThis & { spotifyGenreCache?: GenreCache };
    const genreCache = genreShared.spotifyGenreCache ??= {};
    const resolveGenre = createGenreResolver(genreRequest, genreCache);
    if (options.previewPlaylist) {
      const id = options.previewPlaylist;
      const metadata = await spotifyRequest<{ id: string; name: string; snapshot_id: string }>(`https://api.spotify.com/v1/playlists/${id}?fields=id,name,snapshot_id`, request.signal);
      if (metadata.id !== id || typeof metadata.name !== "string" || typeof metadata.snapshot_id !== "string" || !metadata.snapshot_id) throw new PlaylistIdentityError("Spotify did not confirm this playlist’s identity.");
      const page = await spotifyRequest<SpotifyPage<{ item?: { album?: { id: string; name: string; artists: { name: string }[] } }; track?: { album?: { id: string; name: string; artists: { name: string }[] } } }> & { href?: string }>(`https://api.spotify.com/v1/playlists/${id}/items?limit=50`, request.signal);
      checkPlaylistPage(page, id);
      if (!Array.isArray(page.items)) throw new Error("Spotify returned an invalid playlist preview.");
      const albums = [...new Map(page.items.flatMap(entry => { const album = (entry?.item ?? entry?.track)?.album; return album?.id && typeof album.name === "string" && Array.isArray(album.artists) ? [[album.id, { id: album.id, title: album.name, artist: album.artists.map(a => a.name).join(", ") }] as const] : []; })).values()].slice(0, 8);
      return NextResponse.json({ id, name: metadata.name, snapshotId: metadata.snapshot_id, total: page.total ?? null, albums }, { headers: usageHeaders() });
    }
    if (options.search) {
      lastRequest = "album-search";
      const searchRequest = createSpotifyRequester(sendSpotify, gate, { acquire: signal => acquireSpotifySlot(signal, undefined, true), onLimit: recordSpotifyLimit, maxRetries: 0, failOnCooldown: true });
      const query = new URLSearchParams({ q: options.search, type: "album", limit: "10" });
      const data = await searchRequest<{ albums: { items: { id: string; name: string; artists: { name: string }[]; images: { url: string }[]; release_date: string; total_tracks: number }[] } }>("https://api.spotify.com/v1/search?" + query, request.signal);
      if (!Array.isArray(data.albums?.items)) throw new Error("Invalid search response");
      const results = data.albums.items.filter(item => item && /^[a-zA-Z0-9]{1,64}$/.test(item.id)).map(item => ({
        id: item.id, title: item.name, artist: item.artists.map(artist => artist.name).join(", "),
        artworkUrl: item.images.find(image => /^https:\/\//.test(image.url))?.url ?? null,
        year: item.release_date?.slice(0, 4) ?? "", tracks: item.total_tracks,
      }));
      return NextResponse.json({ results }, { headers: usageHeaders() });
    }
    const params = new URL(request.url).searchParams;
    if (params.get("list") === "playlists") {
      const playlists = new Map<string, { id: string; name: string }>();
      let next: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";
      let previousOffset = -1;
      while (next) {
        const url = new URL(next);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (url.origin !== "https://api.spotify.com" || url.username || url.password || url.pathname !== "/v1/me/playlists" || !Number.isSafeInteger(offset) || offset <= previousOffset) throw new Error("Invalid playlist pagination link");
        previousOffset = offset;
        const page: SpotifyPage<{ id: string; name: string } | null> = await spotifyRequest(url.href, request.signal);
        if (!Array.isArray(page.items) || (page.next !== null && typeof page.next !== "string")) throw new Error("Invalid playlist page");
        for (const item of page.items) {
          if (item === null) continue;
          if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9]{1,64}$/.test(item.id) || typeof item.name !== "string") throw new Error("Invalid playlist entry");
          playlists.set(item.id, { id: item.id, name: item.name });
        }
        next = page.next;
      }
      return NextResponse.json({ playlists: [...playlists.values()] }, { headers: usageHeaders() });
    }
    const source = (params.get("source") ?? "saved") as ImportSource;
    if (source !== "saved" && source !== "liked" && !/^playlist:[a-zA-Z0-9]+$/.test(source)) return NextResponse.json({ error: "Invalid import source." }, { status: 400, headers });
    // Token refresh is complete; stream even the first API request so cooldowns
    // cannot trigger the browser's idle timeout before response headers arrive.
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(stream) {
        streaming = true;
        const send = (event: unknown) => { if (!signal.aborted) stream.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        reportUsage = () => send({ type: "usage", usage });
        let waiting: SpotifyWait | null = null;
        onWait = wait => { waiting = wait; send(wait ? { type: "waiting", ...wait, serverNow: Date.now() } : { type: "resuming" }); };
        onRequest = attempt => { waiting = null; send({ type: "requesting", attempt }); };
        const heartbeat = setInterval(() => send(waiting ? { type: "waiting", ...waiting, serverNow: Date.now() } : { type: "heartbeat" }), 10000);
        const stopHeartbeat = () => clearInterval(heartbeat);
        signal.addEventListener("abort", stopHeartbeat, { once: true });
        send({ type: "heartbeat" });
        try {
          // Keep known tags, but do not spend requests on automatic artist lookups.
          const enrich = async (album: import("../../../data/types").Album) => applyArtistGenres(album, genreCache);
          if (options.genreArtists) {
            for (const artistId of options.genreArtists) {
              const metadata = await resolveGenre(artistId, signal);
              send({ type: "artist-genres", artistId, ...metadata });
            }
          } else if (options.albumId || options.trackId) {
            let albumId = options.albumId;
            if (options.trackId) {
              const track = await spotifyRequest<{ album?: { id?: string } }>(`https://api.spotify.com/v1/tracks/${options.trackId}`, signal);
              albumId = track.album?.id;
              if (!albumId || !/^[a-zA-Z0-9]{1,64}$/.test(albumId)) throw new Error("The exported track has no available album.");
            }
            const album = await loadSpotifyAlbum(spotifyRequest, albumId!, signal);
            send({ type: "progress", loaded: 1, skipped: 0, total: 1, album });
            const enriched = await enrich(album);
            if (enriched !== album) send({ type: "progress", loaded: 1, skipped: 0, total: 1, album: enriched });
          } else {
            const library = createSpotifyLibrary(spotifyRequest, progress => send({ type: "progress", ...progress }), source, knownAlbumIds, { ...options, enrich, summaryOnly: true, checkPlaylist: true });
            await library.getAlbums(signal);
          }
          send({ type: "complete", usage });
        } catch (error) {
          if (!signal.aborted) send({ type: "error", ...reportFailure(error), usage });
        } finally {
          clearInterval(heartbeat);
          signal.removeEventListener("abort", stopHeartbeat);
          reportUsage = undefined;
          onWait = undefined;
          onRequest = undefined;
          if (!signal.aborted) stream.close();
        }
      },
      cancel() { controller.abort(); },
    });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/x-ndjson", "X-Accel-Buffering": "no", "Content-Encoding": "identity" } });
  } catch (error) {
    const status = error instanceof SpotifyError ? error.status : 502;
    return NextResponse.json(options.search ? { ...spotifyFailure(error, "import"), ...(status >= 500 ? { error: "Spotify search is temporarily unavailable. Try again shortly." } : {}) } : reportFailure(error), { status, headers: { ...usageHeaders(), ...(error instanceof SpotifyError && error.retryAfter ? { "Retry-After": error.retryAfter } : {}) } });
  }
}
