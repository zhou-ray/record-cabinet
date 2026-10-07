# Permanent mobile address

Production: https://record-cabinet-livid.vercel.app, deployed to Vercel project `record-cabinet` in scope `ray-s-stuff`. No purchased domain is required.

Prepared configuration:
- Next.js deployment, with the verified webpack build command.
- Import function maximum duration: 300 seconds. Saved checkpoints let a timed-out batch continue; long Spotify cooldowns can outlast a function invocation.
- Local environment files excluded from deployment uploads. Configure production environment values through Vercel, not source files.

Production environment values are configured: SPOTIFY_CLIENT_ID, a private SPOTIFY_SESSION_SECRET, and SPOTIFY_REDIRECT_URI=https://record-cabinet-livid.vercel.app/api/spotify/callback. Local development retains its loopback callback, with the production callback configured as an additional allowed address so LAN sign-in can forward to HTTPS.

Remaining owner setup: register `https://record-cabinet-livid.vercel.app/api/spotify/callback` alongside the loopback callback in the Spotify Developer Dashboard. Use the production address on desktop and phone, not changing preview deployment addresses.

Verified: public page loads, mobile page has no horizontal overflow or browser errors, and login redirects to Spotify with the production HTTPS callback and secure HttpOnly cookies. Authorization return and playback still need an owner sign-in after callback registration.

To redeploy from this linked directory, run `npx vercel@59.23.1 --prod`. Keep production secrets in Vercel; never paste account tokens in chat.

The beta uses the free Upstash Redis database `record-cabinet-limits` (automatic paid upgrades disabled), connected to production through Vercel. `KV_REST_API_URL` and `KV_REST_API_TOKEN` are server-only credentials. Atomic Redis scripts use the Redis clock to space requests by one second across instances and share Spotify cooldowns. Production fails closed if Redis is missing or unavailable. Use the same Redis database/key in every deployment that shares this Spotify developer quota; development otherwise uses a local gate. This Mac is configured with the same database so local testing and production share pacing too.

Rate cooldowns over 15 seconds end the import with its checkpoint preserved instead of holding a function open. Unknown-reset quota exhaustion prevents further probes for one hour; that is our conservative probe interval, NOT a promised Spotify reset time. No background import restarts. Playback mutations are never replayed after rate limits or uncertain network failures.

Imports default to five new albums and are capped at ten per batch and two source pages. Playlist listing is capped at the first 100 entries for this beta. Already stored album IDs are skipped before fetching their details. Users explicitly continue each batch.

Collections, checkpoints, custom bins, and artist defaults are separated by a hashed Spotify account ID in browser storage. The ID is obtained once during OAuth, not by repeatedly polling Spotify. The account-status route checks only the encrypted app cookie. API requests carry the expected account ID so stale tabs cannot issue requests using another account's cookie. Sign-out retains that account's local collection; Account and privacy provides scoped deletion and disconnect.

Existing sessions require one reconnect to establish identity. Old unscoped collections are preserved: Account and privacy → Recover a collection from the previous version → Download previous collection, then restore through Collection backup. Never automatically assign old browser data to whoever signs in next.

Signed-in collections now sync album metadata, genre edits, and bins through the existing Upstash database, keyed by the hashed Spotify account ID. Open the original device and wait for Library sync to finish before connecting another device. Artist defaults and import checkpoints remain browser-local. Current backups do not include artist-default settings. See docs/beta-testing.md for sync limits, deletion behavior, and conflict checks.

References:
- https://vercel.com/docs/domains/working-with-domains
- https://vercel.com/docs/functions/configuring-functions/duration
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri

Beta validation: 105 unit tests, lint, production webpack build, offline browser regression, import-resume regression, integrated player checks, two-account mobile switching/deletion checks, and the Redis-only coordination check passed. Real Spotify sign-in and playback by the invited accounts remain owner/tester checks.

Deployed beta: `dpl_DU1ZHBsfr3dNGb4mYQS7dhNFD4uB` on 2026-09-19. Production root, privacy page, anonymous account status, secure OAuth redirect, and mobile layout verified after deployment without Spotify API calls.
