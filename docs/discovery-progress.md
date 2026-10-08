# Discovery system progress

## Current milestone

Milestone 1 — Behavioral Instrumentation.

**Status: Complete for the opt-in development/test build; disabled by default.** STOP after this milestone. Do not begin Milestone 2 without explicit authorization.

Set `NEXT_PUBLIC_ENGAGEMENT_ENABLED=true` **at build time** to exercise instrumentation. It is deliberately off in ordinary builds and `.env.example` until user data controls and provider-release review are ready. This session does not deploy or enable collection for public testers.

## Architecture findings

- Next.js App Router shared layout keeps AccountProvider, LibraryScreen, RecordBin, and playback alive across records/settings navigation.
- Album normalization, provider fetching, playback state, organization transformations, storage, and cloud sync already have separable modules. No new service is needed for initial instrumentation.
- Account-scoped IndexedDB v1 has albums/settings stores; personal systems and browsing bookmarks use scoped localStorage.
- Cloud storage uses account-scoped Redis REST snapshots with revision checks and three-way merges. Only albums and organization currently sync.
- Spotify authentication uses PKCE/state checks and encrypted HttpOnly cookies. A hashed profile ID scopes local/cloud data. Credentials must remain outside behavior records.
- Actual playback comes from the browser SDK or local HTML audio. Transport/UI state is not accumulated listening history.
- The current collection includes more than explicitly Spotify-saved albums. Provider identity and import provenance are insufficient as an authoritative eligibility set.
- Personal bins have one assignment per album per system; arbitrary bin names are not semantic labels.

## Relevant files

| Concern | Files / capture points |
| --- | --- |
| App lifetime and identity | `app/(cabinet)/layout.tsx`, `app/library-screen.tsx`, `app/account-context.tsx` |
| Authentication | `app/api/spotify/login/route.ts`, `app/api/spotify/callback/route.ts`, `app/lib/spotify-session.ts` |
| Library and imports | `app/data/types.ts`, `app/data/spotify.ts`, `app/api/spotify/library/route.ts`, `app/lib/spotify-export.ts` |
| Persistence | `app/lib/library-storage.ts`, `app/lib/collection-backup.ts`, `app/cloud-library-sync.tsx`, `app/lib/cloud-library.ts`, `app/lib/cloud-store.ts`, `app/api/library/sync/route.ts` |
| Inspect | `app/record-bin.tsx`: pointer/keyboard selection and `finishLift`; do not equate detail fetches/restored selection with deliberate inspection |
| Play and consumption | `app/use-spotify-player.ts`: `observe`; `app/lib/spotify-browser.ts`; `app/use-player.ts`: audio events |
| Completion boundary | `app/lib/album-timeline.ts` and `app/lib/album-stop.ts`; existing end guard is distinct from 75% consumed |
| Personal bins | `app/catalog.ts`, `app/bin-organizer.tsx`, `app/lib/bin-organization.ts`, RecordBin organization saves |
| Existing diagnostics/privacy | `app/lib/beta-diagnostics.ts`, `app/beta-tools.tsx`, `app/account-tools.tsx`, `app/collection-backup.tsx`, `app/privacy/page.tsx` |
| Tests | `tests/library-storage.test.mjs`, `tests/data-layer.test.mjs`, `tests/spotify-playback.test.mjs`, browser gesture/player/navigation scripts |

See `discovery-system.md` for the preserved complete specification and detailed project-specific integration findings.

## Completed work

- Continued from the clean foundation commit `b693404`, read both discovery documents, and followed Milestone 1 only.
- Connected deliberate pointer/keyboard sleeve opening to one inspection event. Automatic restoration and repeated animation/render callbacks do not create events. Pending exports defer until successful canonical album resolution during that opening.
- Connected confirmed matching SDK observations to playback sessions; play requests/optimistic UI/failed commands do not count as starts. Ordinary pause/resume and route navigation preserve the session.
- Added SDK-local observations and persistence checkpoints every 15 seconds, plus important transitions. No new Web API polling or Spotify listening-history import.
- Connected seeking, device errors, stale status, offline/visibility transitions, album end, ejection, restart, collection change, and unmount to conservative interruption/finalization.
- Added account-scoped Web Locks ownership. A second tab cannot own active playback tracking; pauses, interruption and disposal release ownership after queued saves. Unsupported browsers fail closed for playback tracking.
- Added bounded in-memory retry (100 pending identities, no tight retry loop), storage-error diagnostics, and stale-response protections. Saved summaries remain recoverable after reload; new explicit playback after reload starts a new session without crediting downtime.
- Added retention maintenance: one year, newest 10,000 events / 2,000 sessions, pruned on activation and hourly. This bounds retained history at maintenance boundaries, not each individual write.
- Extended the existing remove-local-data action to flush/stop tracking and clear account history. No new personalization reset/export UI was implemented.
- Added an explicit default-off build switch and a short local-history explanation in enabled test builds.
- Verified real UI → SDK adapter → IndexedDB behavior with mocked Spotify on desktop/mobile, including 75% completion and real cross-tab Web Locks.

## Files changed in this completion session

- `app/lib/engagement-tracker.ts` — runtime coordinator, ownership, transition handling, checkpoints, bounded retries.
- `app/use-engagement.ts` — account-scoped runtime lifecycle, build flag, Web Locks, retention scheduling, cleanup.
- `app/lib/engagement-storage.ts` — retention and account clear methods.
- `app/record-bin.tsx` — shared deliberate-selection path, inspection capture and deferred canonical resolution.
- `app/use-spotify-player.ts` — confirmed-state adapter, SDK-only sampling, interruption/end/start boundaries.
- `app/account-tools.tsx` — existing account removal now includes local engagement history.
- `app/lib/beta-diagnostics.ts` — whitelisted storage-failure marker only, no album/account/token payload.
- `app/library-screen.tsx`, `.env.example` — enabled-test-build visibility and explicit default-off setting.
- `tests/engagement-tracker.test.mjs` — runtime tests; `tests/spotify-playback.test.mjs` — dependency injection for shared checkpoint constant.
- `scripts/engagement-integration-smoke.cjs` — full desktop/mobile app checks; `scripts/engagement-storage-smoke.cjs` — pruning/deletion checks added.
- `scripts/bin-gesture-smoke.cjs` — restore its original 15-record fixture after dismissing the expanded 60-record demo.
- `docs/discovery-system.md`, `docs/discovery-progress.md` — implementation decision record and handoff.

The previous foundation remains in `app/lib/engagement.ts` and `tests/engagement.test.mjs`.

## Implemented semantics

- Account hashes and canonical Spotify album IDs scope history; demo/manual/guest interactions are excluded. This does not establish saved-library membership.
- `listenedSeconds` counts verified progression including repeats. Merged unique intervals determine `completionRatio`; 75% unique available-album coverage creates one completion event. The playable-duration denominator is frozen in each session.
- Jumps, unknown tracks, pauses, gaps over 30 seconds, and uncertain observations receive no speculative credit. Initial ownership acquisition also drops its pre-ownership observation, conservatively losing some initial listening until the next confirmed sample.
- One explicit record start/restart begins a session; it is persisted only after confirmed matching playback and ownership. Pause/resume does not create a new start. Ending/ejecting/switching ends the session. Reload recovers stored summaries but does not automatically resume an old session or reconstruct unsaved time.
- Account-scoped native IndexedDB database `record-cabinet-engagement:<accountHash>` v1 remains separate from library albums/settings. It is not cloud-synced, included in collection backup, or uploaded as diagnostics.
- Session + derived start/completion events commit atomically. Stable IDs make retries idempotent; stale revisions cannot regress history. Failed writes remain queued until a later checkpoint while the page lives; errors do not interrupt audio.

## Tests/checks run

- `npm run lint` — PASS.
- `npm test` — PASS: 228 tests, 0 failures, including the original suites, consumption tests, and six runtime-coordinator tests.
- `NEXT_PUBLIC_ENGAGEMENT_ENABLED=true npm run build -- --webpack` — PASS, including TypeScript validation.
- Default-off `npm run build -- --webpack` — PASS; authenticated desktop/mobile checks confirm it creates no engagement database or collection notice.
- `scripts/engagement-integration-smoke.cjs` with mocked Spotify + real account-scoped IndexedDB — PASS at 390px/1400px: pointer and keyboard inspection, failed-play suppression, confirmed start, one completion at 75%, native cross-tab lock exclusion/release, settings navigation, reload recovery without synthetic events, signed-in demo exclusion, and existing account removal clearing history.
- `scripts/engagement-storage-smoke.cjs` — PASS: idempotent/concurrent saves, account isolation, rollback after injected failure, stale revision protection, metadata exclusion, reload, retention pruning, and account-specific clear.
- `scripts/navigation-player-smoke.cjs` — PASS desktop/mobile: playback continuity, cached tracks, layout, transient failures, and no extra Web API playback commands.
- `scripts/bin-gesture-smoke.cjs` — PASS desktop/mobile after correcting its outdated demo fixture setup: gestures, keyboard, sleeve return, full track-list scrolling, and vinyl playback.
- `git diff --check` — PASS.
- Spotify calls in browser tests are mocked; no production data, provider history, or real listening activity used. Native protected audio/background playback remains outside automated verification.

## Known issues / release limitations

1. **Disabled by default:** public activation still requires Milestone 2 data controls and review of applicable Spotify provider requirements. No claim of provider approval or production rollout.
2. **Conservative measurement:** short startup/lock acquisition gaps, seeks, background suspension, uncertain SDK state, and a crash before the next durable checkpoint can undercount. No claim of exact listening measurement or guaranteed unload persistence. Native iOS background playback still needs physical-device tests.
3. **Device-local:** Web Locks coordinate same-origin tabs only, not different devices. No cross-device aggregate or sync exists; future sync needs deliberate session/reset semantics.
4. **Unresolved imports:** inspection is deferred until album identity resolves within the selected opening; failed/cancelled resolution does not create a canonical event. Manual/demo records are intentionally excluded. Track availability changes during a session conservatively interrupt counting if the duration denominator changes.
5. **Retention:** events and sessions are pruned independently at activation/hourly maintenance. Do not assume unlimited historical coverage, or that every retained event has a retained session. Active memory retry is capped; persistent storage failure can lose events once capped or the tab closes.
6. **Saved-only discovery eligibility remains unresolved:** imports from playlists/Liked Songs and cached saved provenance are not authoritative current Spotify saved membership. Address before Milestone 3/4; do not infer eligibility from collected behavior.
7. **Personal-bin action tracking is deferred:** it is not part of Milestone 1's enumerated inspect/play/duration/completion acceptance list. Existing personal memberships remain available as optional signals; event integration belongs with organizational work before scoring uses it.
8. **No separate history controls yet:** existing account removal deletes history; the dedicated history export/reset of Milestone 2 is not implemented. Existing backups omit engagement data and do not preserve it through account removal.

## Not yet implemented

Milestones 2–8: personalization export/reset controls; saved-membership reconciliation; generated-bin snapshots; cold-start heuristics; scoring/assignment; generated-bin feedback; evaluation; polish. No recommendation logic added.

## Exact next step

STOP. When explicitly authorized, work on **Milestone 2 — Privacy Controls and Data Export** only:

1. Read both discovery documents and inspect Git status.
2. Add a token-free JSON data export covering the current library references, engagement events/sessions, personal memberships and timestamps. Generated history/feedback do not exist yet; handle that honestly.
3. Add a dedicated reset that clears only personalization history and stops/drains active writers across tabs, without removing albums, personal bins or authentication. Ensure stale writers cannot recreate cleared history. Do not reuse broad account removal as this reset.
4. Add appropriate concise visibility copy and test account isolation, exports, reset during playback/queued writes, and retained albums/bins/auth. Keep production enablement explicit; do not assume the build switch should be turned on automatically.
5. Run relevant checks, update this handoff, commit, and STOP before Milestone 3.

## Last known stable commit

- Previous committed foundation: `b693404` (`feat: add engagement storage and consumption foundation`).
- The commit containing this completed handoff is titled `feat: add album engagement tracking`; its hash is available via `git log -1`.
- Neither this milestone nor the foundation has been pushed or deployed by this session.
