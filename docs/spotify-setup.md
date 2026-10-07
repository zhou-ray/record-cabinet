# Spotify setup

## Create the app

1. Sign in at https://developer.spotify.com/dashboard with the Spotify account that will own the app. Current development-mode rules require Premium for the owner.
2. Create an app named **Record Cabinet**. Select **Web API** and **Web Playback SDK** when asked which APIs you intend to use.
3. Register this exact redirect URI:

   `http://127.0.0.1:3000/api/spotify/callback`

   Spotify permits HTTP for explicit loopback IPs, not `localhost`. A deployed callback must use HTTPS. This is the implemented callback route.
4. Copy the **Client ID** from the app settings.
5. Copy `.env.example` to `.env.local` and set `SPOTIFY_CLIENT_ID`. Leave `SPOTIFY_REDIRECT_URI` matching the registered callback. Set a random `SPOTIFY_SESSION_SECRET` as well (already generated for this local workspace).
6. In the app's Users Management settings, allowlist the Spotify accounts that will test it. Development mode supports up to five authorized users.
7. Restart the development server after changing environment variables and use `http://127.0.0.1:3000` for desktop OAuth testing.

We plan to use Authorization Code with PKCE, so no client secret is needed. Do not put credentials or access/refresh tokens in chat or source files. `.env.local` is ignored by Git; `.env.example` contains only placeholders.

## What is implemented

Connect Spotify opens PKCE authorization requesting `user-library-read`, `playlist-read-private`, `playlist-read-collaborative`, `user-read-playback-state`, `user-modify-playback-state`, `streaming`, `user-read-email`, and `user-read-private`. The callback validates a ten-minute encrypted state/verifier cookie and exchanges the code server-side. Access and refresh tokens are stored in an authenticated encrypted HttpOnly cookie; the playback SDK receives only a short-lived access token in memory; HTTPS deployments use Secure cookies. A private `SPOTIFY_SESSION_SECRET` was generated in the local environment; configure a stable random key in deployed environments too.

The library endpoint refreshes expired tokens, imports all saved albums and tracks with pagination, and returns metadata only. The shelf displays real cover artwork, artists, track lists, and links back to Spotify. Albums without genre metadata appear under Uncategorized. Loading, retry, reconnect, denied-access and rate-limit states are implemented. Disconnect clears this app's session; it does not revoke consent from Spotify's account settings.

Use `http://127.0.0.1:3000`, click Connect Spotify, approve library access, then choose an import source and start a batch. Starting from localhost redirects sign-in to the configured callback host. Restart Next.js after changing environment variables.

Imported albums stream in this browser through Spotify’s Web Playback SDK with Premium. The demo collection still uses local preview audio.

## Verification

`npm test` covers catalog normalization, pagination, grouping, encrypted-session tampering/expiry, PKCE, state rejection, callback exchange/replay, and refresh-token preservation. `npm run lint` and `npm run build -- --webpack` check the application. Live authorization and library loading require the account owner's browser consent and remain a manual check.

References:
- https://developer.spotify.com/documentation/web-api/concepts/apps
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes

## Import sources and organization

Use **Import from** to choose saved albums, Liked Songs, or a playlist after clicking **Load my playlists**. Reconnect once if you connected before playlist permissions were added. Playlist imports fetch the complete album for each song, follow album track pagination, skip local files and non-music items, and deduplicate albums across imports. They add to the current shelf; imported metadata is saved incrementally in this browser using IndexedDB and is not saved to Spotify.

Automatic artist and genre shelves have at most six bins. **One big bin** includes every record. **My systems** supports multiple named systems with five named bins plus Unfiled, searchable record filing, renaming, and removing bins. Organization and album assignments are saved in this browser. Removing a bin returns its records to Unfiled.

Playlist API references: https://developer.spotify.com/documentation/web-api/reference/get-playlists-items and https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks.

## Request pacing and automatic retry

Spotify API requests share a one-request-per-second gate within this server process, including playlist discovery and imports. A 429 pauses the gate for Spotify's `Retry-After` duration (plus a one-second buffer) and retries the same request up to five times. Missing reset times use increasing delays from 30 seconds to five minutes. Development quota errors (`QUOTA_EXCEEDED`) without a reset time stop with a specific explanation rather than repeatedly retrying.

Imports send a heartbeat every ten seconds, including before the first Spotify response, so a cooldown does not trip the browser's 45-second idle timeout. The UI shows when the request will resume and offers Stop import; stopping preserves loaded records. Import is disabled while an import is running to avoid accidental restarts. Keep the page open during automatic retries. Reloading restores saved albums without automatically starting another import. The gate is in memory; multiple deployed server processes would require a shared external gate.

References: https://developer.spotify.com/documentation/web-api/concepts/rate-limits and https://developer.spotify.com/documentation/web-api/concepts/quota-modes.

Cooldown status includes the full local date and a live countdown, so a next-day retry cannot look like a missed retry today. Server events include the server timestamp to account for browser clock differences. Each actual request emits a dispatch event that clears the waiting state. A separate browser progress watchdog ignores heartbeats: if a cooldown ends without request progress for 45 seconds, or active importing stops making progress for 60 seconds, it stops the stalled connection and offers Try again while preserving the current shelf.

## Keeping your collection

Each arriving album is saved in its own IndexedDB transaction. Stopping, retrying, changing import sources, and empty imports never clear the collection. The selected import source is also saved. On reload, the app restores the shelf and source checkpoints. Imports always start only when requested, including on an empty shelf. Local records remain browsable if the Spotify session has expired. A saving indicator and storage-failure notice distinguish durable records from records still only in page memory. Browser storage is specific to the site origin (keep using the same host and port) and browser profile; clearing site data removes it.

Earlier versions only kept imported albums in React state, so albums already lost to a full reload before this update must be reimported.

## Creating and filing bins

Open Create your own bins (or Edit bins for an existing system), name one to five bins and create the system, then select records and tap a destination bin to file them together. Unfiled only, search, Select shown, and Clear selection help organize large imports. Add bin remains available while the system has fewer than five named bins; Edit names supports renaming and removing bins. Removing a bin returns its records to Unfiled.

Pull out an album and choose Move bin in its details to reveal the filing options alongside the tracklist. The options stay collapsed until requested. Choose a system and tap a bin, or create a system/add a bin there. Done moving closes the options; Done editing bins closes the shelf editor. The current browsing stack stays in place while filing; the updated filing appears on the shelf when you return. A downward swipe on either side of a pulled-out sleeve puts it back without changing the selected record. Arrow Down and Escape provide keyboard equivalents; horizontal gestures, taps, and cancelled gestures do not put it back.

## Avoiding duplicate downloads

Import new albums sends the IDs already present in the restored browser collection to the import endpoint. Saved albums, Liked Songs, playlists, and retries skip those IDs before requesting album details or paginated tracklists. Duplicate songs pointing to the same album are counted only once. Existing albums are left intact, and progress distinguishes newly imported albums from albums already saved. The app still scans source pages to discover newly added albums; it does not assume an unchanged playlist or stop at the first known album. Different Spotify album IDs (for example different editions) remain separate records.

## Integrated album player

Reconnect Spotify once to grant the new streaming permissions. Spotify Premium is required. The turntable is part of the cabinet page: choose **Put record on** to stream an album here through the Web Playback SDK. No separate Spotify player needs to be opened. The SDK is loaded only when playback is requested.

Playback transfers to this browser, disables shuffle and repeat, and starts the whole album. The needle represents the combined duration of every track. Scrubbing across a track boundary maps the album position to an internal track offset; the sleeve tracklist is read-only. There are no track selection, skip, restart, or numeric timing controls. While paused, moving the needle stages a cue until Play record is pressed.

The SDK supplies playback events without REST polling. Pause, resume, and seeks within the current track use the SDK; cross-track cues and album setup use authenticated server routes with the shared pacing/cooldown gate. Failed commands are not automatically replayed. Browsers may require another user gesture to enable audio.

The private token endpoint returns only a short-lived access token with no-store headers for the SDK. Refresh tokens remain in the encrypted HttpOnly session cookie. SDK tokens are not stored in browser storage.

Pointer release commits a cue once; Escape and cancelled gestures discard it. Keyboard arrows, Page Up/Down, and Home/End also move the needle. Reduced motion disables record rotation. The local demo collection remains preview audio.

Live Spotify streaming still needs account verification after quota resets; automated checks use mocks and never call Spotify.

References:
- https://developer.spotify.com/documentation/web-playback-sdk
- https://developer.spotify.com/documentation/web-playback-sdk/reference
- https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback

## Offline work, backups, and small imports

Use **Listen to local demos** to test local audio without disconnecting Spotify or replacing the saved collection. The mobile turntable appears above the browsing area; the arm parks when empty, moves smoothly during playback, and follows drag gestures directly. Reduced motion suppresses the arm transition and record rotation.

**Collection backup** downloads versioned JSON containing album metadata and bin systems. Restore validates the file before writing, previews the counts, and merges without deleting existing albums. Existing metadata wins on duplicate IDs; conflicting bin systems are kept as separate restored copies. Album restore uses one atomic IndexedDB transaction. Bin preferences use localStorage separately; if that write fails, the UI reports that albums restored but bins did not. Backups exclude audio, credentials, and import checkpoints.

Import batches target 50, 100 (default), or 250 new albums, finishing the current page and stopping after at most five source pages. Album summaries avoid per-album detail requests; complete embedded tracklists are retained, otherwise playback loads details on demand. Checkpoints commit with each saved album. Playlist checkpoints include the source version; version changes restart the scan safely. A completed scan is certified only if the version remains unchanged at the end. Its browser/account-specific receipt is valid only while its saved album IDs remain present. **Scan from beginning** bypasses the receipt. No next batch starts automatically.

Validation includes unit/route tests for checkpoint boundaries, quota/session failures, atomic storage rollback, backup validation, merge preservation, bin order, and SDK error/cleanup behavior. `scripts/offline-smoke.cjs` verifies the browser flows with a dummy session and mocked API responses; live Spotify audio remains a separate manual check.

## Add a single Spotify album

Add album defaults to **From Spotify**. Paste a full `https://open.spotify.com/album/…` link (including internationalized share URLs) or a `spotify:album:…` URI. Track and playlist links are rejected. The client checks cached Spotify IDs first; a new album uses the authenticated, paced import stream to retrieve its metadata and complete tracklist. It does not scan saved albums or start playback. The collection is updated only after loading and local persistence succeed. A quota failure leaves the form available to retry later.

The empty turntable offers **Prepare Spotify player**, which establishes the SDK connection without starting or transferring music. This is connection preparation, not audio preloading. Spotify’s documented Web Playback SDK exposes streaming controls but no whole-album audio prefetch method. Album metadata is already local for timeline calculations. See https://developer.spotify.com/documentation/web-playback-sdk/reference.

## Phone testing and Spotify sign-in

The desktop callback `http://127.0.0.1:3000/api/spotify/callback` cannot sign a phone in: loopback points to the phone itself. A LAN HTTP address is useful for browsing but Spotify requires HTTPS for non-loopback callbacks. The app now detects this mismatch and shows setup guidance instead of redirecting a phone to loopback.

Keep desktop and mobile callbacks registered together. The app selects an explicitly configured callback by the browser's host; switching devices does not require changing code or replacing the desktop callback.

```dotenv
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/spotify/callback
SPOTIFY_ADDITIONAL_REDIRECT_URIS=https://your-permanent-host.example/api/spotify/callback
```

Register both exact URLs in the Spotify Developer Dashboard. Additional callbacks are comma-separated. Restart after changing environment settings. Open `http://127.0.0.1:3000` on the Mac, or the permanent HTTPS address on either desktop or mobile. `localhost` sign-in redirects to the registered loopback IP. Cookies, logout, and playback origin checks follow the selected host. Unknown hosts cannot become OAuth callback destinations. LAN HTTP access remains suitable only for browsing when the default callback is loopback.

For lasting mobile access, deploy to a host with a stable HTTPS address, or use a named tunnel on a domain you control. Register that address once. The same production HTTPS address can serve both desktop and mobile. A random `trycloudflare.com` tunnel is temporary: when it stops or changes, the old URL may stop resolving. It is unsuitable as the permanent sign-in address; desktop access remains independent even if that tunnel fails.

Browser storage is separate for each origin: export a collection backup before changing addresses and restore it on the HTTPS site to avoid reimporting. Spotify’s redirect requirements: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri. Cloudflare’s testing tunnel instructions: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/.

The turntable stays hidden until a record is loaded. On mobile, browsing uses a compact header; starting a record places the player above the collection and scrolls it into view. Pausing keeps the player available for resuming.

## Album completion and record controls

The center label displays the saved album cover, with the printed label as a fallback when no artwork is available. Click/tap the label, or focus it and press Enter/Space, to pause or play. The transport button below the deck remains available.

Record Cabinet schedules a local stop for the final track using SDK duration/position events and pauses any transition outside the selected album. Internal track transitions continue normally. Pauses cancel the deadline, and playback/seek updates reschedule it. Completion keeps the sleeve and needle at the end; Play starts the selected album again. These checks use the browser SDK without Web API polling and work independently of API cooldowns. They do not change Spotify's account-wide autoplay preference. Browser suspension can delay local timers and SDK events, so a frozen/closed page cannot guarantee an immediate stop.

`PLAYWRIGHT_MODULE=/path/to/playwright node scripts/player-smoke.cjs` runs against port 3100 with mocked Spotify playback. It checks album transitions, within/across-track seeking, paused cues, the cover label control, final-track stopping, recommendation stopping, and mobile layout.

## Current shelf controls

All records (one big bin) is a shared bin choice on Artist, Genre, and My systems; it no longer has an arrangement tab. Old saved `all` arrangements fall back to Artist. Random record pulls a saved album from the whole collection without playback or Spotify requests, avoiding the current/previous pick when more than one album exists. It is available on the shelf and while browsing a bin.

The artist-tag lookup tool is currently hidden. Imports and single-album adds no longer request artist metadata for genre enrichment; existing genre labels and already cached server tags are retained. The Genre arrangement still uses saved labels.

## Manual genre organization

Open an album and choose **Set genre** beside its filing controls. Select multiple broad genres or add your own labels. Saving with none selected explicitly clears the album to Uncategorized. The artist-default selector applies the same labels to that artist's other uncategorized albums and stores a default for future uncategorized imports/additions. For collaborations, choose the artist explicitly. Existing genre labels and deliberately cleared albums are preserved. Choosing an artist default with no labels clears that default for future imports.

On the Genre shelf, **Tag multiple albums** opens search, an uncategorized filter, record selection, and Add/Replace modes. Add preserves existing labels; Replace changes only the selected records. Album metadata and artist defaults save in a single IndexedDB transaction. Failed saves roll back together. Genre editing is disabled for demos and during imports. No Spotify requests are used for editing or applying defaults.

Genre labels and explicit-clear markers are included in album backups. Artist defaults are browser-local settings and are not included in the current backup format. Updates refresh the genre shelf and open album metadata while preserving the current browsing stack.

## Playback recovery and bin labels

Bin names appear in full on the box fronts, with no caption or count underneath; accessible button names retain record counts. The common shelf actions also omit subtext.

Album completion now uses explicit playback state, rather than treating the estimated needle position as proof that audio ended. A final-track timer reads the local SDK state before stopping, allowing buffering to extend the deadline. Track matching accepts original/relinked URIs and, within the selected album context, an unambiguous title/duration match. An unmatched startup or mid-album event does not mark the album finished. Unknown playback stays pausable, and a valid active playback update can recover from a stale completed state. These checks make no Spotify Web API polling requests.
