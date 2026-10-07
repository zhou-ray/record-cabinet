# Three-person beta

Production: https://record-cabinet-livid.vercel.app

## Tester entry and feedback

New guests with no saved records see **Try the demo** and **Connect Spotify**, with invitation and Premium requirements explained before sign-in. Choosing the demo dismisses the welcome on that browser. Existing libraries keep their records first.

Open **Library & settings** from the cabinet to find imports, manual album entry, sync, account controls, **Report a problem**, and **Testing checklist**. Collection backup stays last on that page. The version identifies the build loaded in that tab. A report includes the tester's description and a preview of whitelisted environment/status fields plus up to ten recent error codes/references held only in memory. It contains no automatic library contents, account IDs, tokens, raw errors, or URLs. Reports are copied manually for the inviter; there is no automatic submission or new feedback backend. Clipboard failure selects the preview for manual copying. Ask testers to include steps, expected behavior, and actual behavior.

The music and settings routes share the active cabinet: navigating between them preserves playback, the selected sleeve, imports, and sync. A browser reload still starts a fresh playback session. Settings is also available directly at `/settings`.

The checklist covers sleeve browsing, playback, scrubbing, album end, custom bins, persistence, and device sync. Checkmarks last for the current page visit. `scripts/beta-tools-smoke.cjs` checks mobile/desktop guest onboarding, dismissal, report copy/fallback, and the checklist with API requests mocked. Set `TEST_ORIGIN` and `PLAYWRIGHT_MODULE` for your test server.

## Owner setup

In Spotify Developer Dashboard → this app → Settings → Users Management, add each friend's Spotify account name/email. Each listener needs Premium for the integrated player. Keep the production callback registered as `https://record-cabinet-livid.vercel.app/api/spotify/callback`. Do not distribute developer credentials.

## First test

1. Open the permanent URL on desktop or mobile and connect Spotify.
2. Import a 50-album summary batch. Confirm the collection survives a reload without importing again.
3. Play an album, pause/resume from its cover, scrub within and across tracks, and check it stops at the end.
   Check the cue lever and Restart record. On desktop, drag the volume knob or focus it and use arrow keys. On a physical iPhone or Mac, play an album with artwork, open the lock screen/Control Center, and check album title, artist, artwork, and play/pause. Check that the title stays on the album across tracks and that putting the record away clears it. Apple system UI/background behavior needs a real-device check; browser emulation only verifies the Media Session API state.
4. Move an album between custom bins; check genres and a backup export/restore.
5. Only then import another small batch, ideally staggering the three initial imports.
6. Report device/browser, action, displayed error, and approximate time; do not send access tokens or cookies.

Quota remains shared with the owner; the limiter cannot increase Spotify's allowance. Saved records and local demos remain available during pauses. Albums, genre edits, and bins now sync between devices signed into the same Spotify account; local copies remain available offline. An existing pre-beta collection can be recovered from Account and privacy without spending Spotify requests.

## Automated verification

`npm test`, `npm run lint`, `npm run build -- --webpack`.

Browser scripts use a local server on port 3100 with `SPOTIFY_SESSION_SECRET=record-cabinet-offline-test-secret-only` and `SPOTIFY_REDIRECT_URI=http://127.0.0.1:3100/api/spotify/callback`; never use that session secret in production. Run `scripts/offline-smoke.cjs`, `scripts/import-resume-smoke.cjs`, `scripts/player-smoke.cjs`, and `scripts/account-beta-smoke.cjs` with Playwright available. These checks use mocked Spotify responses.

`scripts/shared-gate-smoke.cjs /path/to/private-production.env` verifies coordination using a disposable Redis key, never Spotify. Protect and delete the temporary environment file afterwards. Never commit secrets.

## Import diagnostics

Import failures now show import-specific messages and a short reference matching the server log entry `spotify_import_failed`. Logs contain only the reference, request stage, status, reason code, and error type—no tokens, account IDs, album/playlist IDs, or response bodies. Null source entries are tolerated; saved-album summaries without embedded tracks fetch full details only when the album is not already saved. Incomplete album data stops before advancing the checkpoint.

Page-link compatibility: saved positions normalize old playlist `/tracks` URLs to `/items` and accept validated `market`/`additional_types` parameters. Host and source restrictions remain enforced. Each batch reads album IDs and its checkpoint together from IndexedDB, including updates made by other tabs. A completed album is committed before checking the next-page link. The UI shows the saved item position or explicitly states that a scan starts at the beginning. Backup restoration still restores records/bins, not source checkpoints; duplicate checks protect a fresh scan.


## Account library sync

Open the app on the device with the existing collection first. Library sync near the bottom shows status and offers Sync now. Then open the permanent URL and connect the same Spotify account on another device. Sync checks every 30 seconds while visible and on window focus/network return, without Spotify requests. An active import finishes before applying cloud changes.

Cloud data is keyed by the server session’s hashed account ID. Browser-supplied IDs cannot select another library. Writes use atomic revision comparisons and merge local changes since the last acknowledged snapshot; additions from both devices survive, independent bin assignments merge, and simultaneous edits to the same album use the device currently syncing. Import checkpoints and artist genre defaults remain device-local. The beta cloud snapshot limit is 3 MB; larger libraries remain saved locally with an explicit sync error.

Delete cloud library removes cloud metadata and persistently pauses sync account-wide. Stale devices cannot silently recreate the deleted copy. Local device copies remain; explicitly enable syncing to upload them again. Disconnect/remove local data retains cloud data, as explained in Account and privacy.

Verification: `scripts/cloud-sync-smoke.cjs` uses mocked cloud responses across isolated desktop/phone/account profiles and exercises conflict retry, offline reload, and deletion. `node --env-file=.env.local scripts/cloud-store-smoke.cjs` exercises the real Redis CAS/deletion logic under a random disposable test key and deletes it afterwards. Neither makes Spotify requests.

### Playback and sync recovery checks

Automated browser checks simulate Spotify locally without consuming API quota:
- Returning to the page reconciles playback with the SDK; stale reads cannot overwrite newer playback events.
- A stalled SDK operation releases controls. An unresponsive foreground state check offers reconnection without automatically starting music.
- Sync preserves simultaneous note/genre changes, including edits made while a request is in flight.
- Offline and stalled sync requests preserve the device library and allow another sync.
- Import checkpoints, duplicate skipping, and desktop/mobile sleeve gestures remain covered.

Physical-device follow-up: on iPhone, play an album, lock the phone, unlock it, switch apps and return, then briefly disable and restore connectivity. Confirm the arm reflects actual playback and play/pause works. Browser simulations cannot establish iOS background-audio behavior.

### Automatic genre organization

Open Library & settings → Automatic genres → Auto-organize genres. This is an explicit, resumable run while the app remains open, not an automatic Spotify scan.

The organizer uses saved artist tags first, then one unambiguous MusicBrainz lookup per primary artist, reusing the result across their records. Search tags usually classify an artist in one request; a detail request is made only when needed. Artist results survive reloads and cover newly added records for 30 days. This favors broad artist genres over album-specific precision. Only recognized broad genre labels are applied. Manual edits (including deliberately cleared genres) win locally and during cloud sync. Albums without reliable tags remain uncategorized; successful and empty lookups are remembered for 30 days. Errors stop the run without marking the unfinished album checked. Stop or reload, then press the same button to continue.

MusicBrainz lookups use the existing Upstash connection for shared public-response caching and one request every 1.2 seconds across deployments. Redis failure stops lookups rather than sending uncoordinated requests. No additional API key or Spotify request is needed; a connected account is required to access the lookup endpoint.

Validation: `scripts/auto-genres-smoke.cjs` covers desktop/mobile progressive saving, reload resume, empty-result caching, saved artist reuse, manual override preservation, and cancellation with mocked responses. Unit tests cover conservative matching, API authentication/origin checks, pacing, cache behavior, atomic local writes, and cross-device manual-edit priority.


### Unmatched genre second pass

The organizer finishes artist lookups first, then checks remaining albums against exact MusicBrainz release-group matches and Apple's public iTunes album search. Apple is queried only for albums still unmatched, with shared 3.1-second pacing and one-day public-response caching. No Spotify requests or additional user account are needed. Multiple album editions must agree on genre; uncertain matches remain empty. Compilations can match album metadata without inheriting a generic Various Artists genre. Library reuse requires two solo albums with the same artist ID and a shared broad genre; manual clears stay untouched.

The UI separates waiting, completed without a match, and failed lookups. Old artist-only misses automatically enter the second pass. Retry unmatched albums bypasses the local 30-day completion skip (shared public responses still use their cache); failures and cancellation preserve the last completed provider stage. Check retry after a failed Apple request resumes at Apple, and that album-specific matches never become artist-wide defaults. Tests cover this sequence, legacy progress, manual choices, conservative cross-album reuse, compilation matching, and provider identity validation.


### Apple-first genre correction

Apple album matching now runs first; only unmatched albums fall back to MusicBrainz album metadata. Artist-wide and library-inferred labels do not bypass this lookup. Progress strategy 2 upgrades old cached misses automatically. Recheck automatic genres with Apple replaces existing non-manual labels on exact Apple matches, keeping old labels on a miss/error. The storage transaction checks both manual-edit status and the observed genre array before replacement, so edits during a lookup survive. Baroque pop and chamber pop map to Pop, not Classical; weak secondary MusicBrainz genre votes below a quarter of the leading broad genre's support are excluded.


### Fresh rechecks and broader catalog matching

Strategy 3 rechecks bypass previous Apple results both locally and in the shared cache. One timestamp is kept for the run so cooldown retries reuse the pages already refreshed instead of continually starting over. Album matches try the primary artist/title (25 results), title alone with verified artist credits (50), and a GB storefront query when US searches fail. Edition suffixes are normalized; live, acoustic, remix, and re-recorded versions remain separate. Exact editions are preferred when available; conflicting equivalent editions remain unmatched.

The run summary distinguishes changed labels, labels already matching, unmatched records, protected concurrent edits, and skipped manual choices. Expand Show album results for per-album before/after labels or the reason existing labels were kept. The browser regression seeds stale Apple Classical/Electronic labels and verifies a fresh recheck corrects both.


### Unavailable Spotify tracks

Imports retain is_playable/restriction signals and original/relinked track IDs. Unavailable songs remain visible on the sleeve but are excluded from album duration and needle cues; Spotify context offsets still use the complete original track list. End detection uses the last playable song, including albums with unavailable closing tracks. Entirely unavailable albums show an explanation without attempting playback. Only explicit TRACK_NOT_PLAYABLE/NON_PLAYABLE command failures allow skipping forward (at most three play attempts); quota, connection, and account failures do not.

Selected albums refresh availability at most once per week, using the existing album detail loader and shared request gate. Failed optional refreshes leave the saved album playable; missing metadata still requires a successful load. Availability and relinking survive backup/cloud sync. scripts/unavailable-tracks-smoke.cjs covers desktop/mobile legacy refresh, first/middle/last unavailable tracks, correct Spotify offsets, sleeve labels, and stopping without autoplay. This test mocks Spotify; real availability depends on the listener's account and market.


## Import efficiency

Run `scripts/import-efficiency-smoke.cjs` with `TEST_ORIGIN` and `PLAYWRIGHT_MODULE` pointing at the local test server and Playwright. Desktop/mobile checks mock all Spotify traffic and verify summary persistence, a completed playlist receipt surviving reload, unchanged status, and request totals. Provider tests verify one source-page request for 50 summaries, retaining embedded complete tracks, stable-version completion, changed-version restart, and page-boundary resume.

Import completion/errors include actual Web API attempt counts, including retries, displayed in Settings. Server `spotify_request` log entries classify each dispatched request as import, metadata, search, or playback, without tokens, user IDs, album IDs, or URLs. These counts exclude token exchange and SDK-internal traffic and are not Spotify's remaining quota. Availability metadata is reused for seven days; legacy records get one initial check. Receipts are local to each account/browser, so a second device performs its own first scan while reusing cloud-synced albums.

## Automatic genres after import

Spotify source imports and Spotify data-file imports atomically queue new uncategorized records with their saved albums. Automatic sorting starts after the active import batch finishes saving. It only processes queued records; existing unrelated albums are left for the manual organizer. The quick pass makes one focused Apple search per album. After all quick checks, the deep pass uses the two remaining Apple searches and then MusicBrainz. Saved `quick`/`apple` phases resume without repeating completed work. Explicit rechecking of existing automatic labels retains the full Apple-only repair flow.

The browser/account-specific queue survives reloads and is cleared after successful processing. Provider failures leave both imported albums and queued work intact without retry loops. Completed genre labels still sync through the existing cloud library. Sorting runs while the app is open. Settings has an automatic-sorting checkbox; Stop organizing disables automatic sorting until enabled again, while the manual organizer remains available. No Spotify API requests are used for genres.

`scripts/import-genres-smoke.cjs` mocks every music service and checks desktop/mobile automatic startup, quick-before-deep ordering, a provider failure after a successful import, automatic reload recovery without repeated quick checks, manual-label protection, and a pause that survives reloads. `scripts/auto-genres-smoke.cjs` covers the manual repair and retry paths.


## Cabinet navigation and sleeve details

Records and Settings use same-document history navigation inside the existing shared layout. Normal clicks and browser Back/Forward retain the mounted player; modified clicks still open a separate tab normally. This avoids requesting another route payload while listening, including across deployment changes. Direct URLs still work. Navigation updates the document title and scroll position.

Opening a sleeve back loads missing tracks through the existing album loader and saves them with personal edits preserved. Repeat flips and first playback reuse the completed record. Already-complete tracklists do not refresh availability merely because they were flipped. Leaving the bin cancels unfinished detail loading; failures leave the record and current playback intact and provide a retry control. Album title and record count occupy separate grid columns.

`scripts/navigation-player-smoke.cjs` verifies desktop/mobile long-title layout, one cached detail load across multiple flips, playback reuse, bin/shelf navigation to Settings, and browser history without SDK disconnection or extra playback requests. Spotify is mocked; this does not exercise live protected Spotify audio.

Background playback-state checks triggered by focus/online/visibility must not disconnect an otherwise active SDK after a timeout. Keep the last confirmed transport state and the end guard; later SDK events or a successful check recover status. Explicit commands retain their existing timeout handling. Failed/non-OK/malformed account-check responses do not establish an account change; a successful response with a different valid account ID still locks the collection. The navigation smoke test injects a stalled SDK read, a 503 account response, and a malformed 200 response while playing on desktop/mobile, and checks that the SDK stays connected and controls remain available.

## Listening diagnostics and review

The platter and arm are 15% larger within the deck. Physical controls retain 44px touch targets; pointer scrubbing uses the transformed mechanism coordinates. The player smoke checks desktop/mobile controls, cross-track seeking, pause/cue, recovery, and album-end stopping.

Settings → Report a problem now includes a bounded, whitelisted playback-event history and current transport snapshot. Reports can be copied or downloaded; nothing is sent automatically. Diagnostic fields omit account/device IDs, tokens, album names, and raw provider errors. User-written descriptions remain in the report.

Settings → Spotify requests shows seven UTC days of observed requests per account/browser, retaining 30 days locally. Categories are imports, album metadata, search, and playback. Retries count; token exchange, SDK traffic, other devices, and requests whose usage never reaches the browser do not. This is an activity counter, not Spotify quota remaining. Usage persistence does not trigger library cloud sync or block imports.

Automatic genres → Review album genres filters uncategorized, automatic, manual, or all records, with search and 20-record pages. Each row shows its locally known source/status and allows a targeted retry/recheck or manual correction. Manual choices are protected. Source labels fall back to Saved metadata when the local lookup does not match the current labels.

Connected listeners see a dismissible connect/import/play guide until their first playback or dismissal. It is local to their account/browser. The import/genre browser smoke also checks guide progression, persisted usage totals, targeted rechecking, and protected manual labels. Report smoke covers download, clipboard fallback, and mobile overflow. Failure coverage includes interrupted streams, saved import/genre recovery, overlapping cloud revisions, transient account failures, stalled player reads, and navigation while playing. All automated Spotify traffic is mocked.

Selecting a sleeve lifts it and then automatically flips to the back, loading missing tracks. Tapping the back retracts the vinyl, flips to the front, then lowers the sleeve into the bin. There is no separate raised-front interaction step. Vinyl remains available at the side. Bins loop in both directions with continuous virtual positions for dragging and modulo selection for the album; keyboard and previous/next buttons wrap too. Single-record bins remain stationary. The bin gesture smoke checks first/last wrap, automatic lift/flip/return, full track scrolling, vinyl playback, and returning to the shelf on desktop/mobile. Navigation smoke checks cached first-selection details and uninterrupted playback with the revised interaction.

## Continue digging

The shelf offers Continue digging after browsing a bin. It stores the last album ID, bin/arrangement, custom system, genre grouping, and open/back state locally under the account's organization key; demo browsing has a separate bookmark. No Spotify request or playback starts when resuming. Reordering and imports resolve the album by identity, not index; changed/deleted bins fall back to a current bin containing the album, and removed records hide the shortcut. This bookmark is specific to the browser and does not sync between devices. Storage failures leave ordinary browsing usable.

`scripts/continue-digging-smoke.cjs` checks desktop/mobile reload restoration of the All records bin and sleeve state without autoplay, including reduced-motion settings. Resolver tests cover reordered collections, deleted bins, removed albums, and malformed saved data.

## Expanded alphabetical shelves

Artist and Album views now make up to twelve balanced A–Z bins, keeping each initial together. Numbers/symbols use a separate # bin. Unicode normalization folds Latin accents and common ligatures/stroked letters for filing (for example É→E, Ø→O, Ł→L, Æ→A), while displayed metadata remains untouched. Leading punctuation is skipped. Non-Latin names have additional script bins for Cyrillic, Greek, Han/kana, Hangul, Arabic, Hebrew, Devanagari, and Thai; other letters stay in Other scripts or Other Latin rather than #. Han and kana share a bin because the spelling alone cannot distinguish Chinese from Japanese readings; no transliteration or language inference is performed. Smaller collections only show occupied bins. Custom/genre bin rules are unchanged.

Data tests cover both alphabetical modes, Unicode normalization, supplementary-plane Han, script grouping, uniqueness, deterministic ordering, and whole-letter balancing. The album-bin browser smoke uses twelve Latin bins plus five script bins on desktop/mobile, checks reload persistence and overflow, and opens a letter bin. All classification is local and requires no Spotify calls.

## Keyboard browsing and return boundaries

While viewing a bin, Left/Right browse and wrap without first focusing the sleeve. Held arrows advance from the last requested position so a fresh animation cannot stall repetition. Enter/Space selects or returns the sleeve, and Escape returns it. Native buttons/links, player controls, editable fields, modified shortcuts, and hidden Settings views keep their normal behavior. `scripts/bin-keyboard-smoke.cjs` verifies these boundaries.

During lowering, the stack is clipped at the bin opening and inner side walls, in addition to the foreground panel and non-bouncing motion. The navigation/player smoke checks the clipping while Spotify state events arrive repeatedly, on desktop/mobile, and verifies playback remains active. This addresses visible sleeve overflow beside an active player without touching playback commands.

Chinese playlist fixture checks confirm album IDs, Unicode names, artists, and artwork are taken directly from playlist items with no title search, including distinct albums sharing a Chinese title. The reported unexpected albums from the Wei playlist still require actual affected library/playlist data to diagnose; the fixture does not establish the cause of that report.

Back-cover down-swipes now call the same return action as taps. Native track scrolling remains enabled; dismissal from the track list requires starting at its top without scrolling during the gesture. Gestures started below the top, horizontal/upward movement, cancelled touches, and multi-touch do not dismiss. Mouse dragging also works. The back cover uses touch events alongside mouse PointerEvents because native scrolling cancels touch PointerEvents. Browser gesture checks exercise native mobile touches, scrolling in both directions, top-of-list swipe return, and subsequent taps.
