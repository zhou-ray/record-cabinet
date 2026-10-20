# Discovery system progress

## Current milestone

Milestone 4 — Cold-start Heuristics.

**Status: Milestone 4 complete locally (2026-10-19).** User authorized this milestone after approving the local arrow layout fix. Artist-balanced Wander, exploration tiers for Digging, and conservative Forgotten Favorites are implemented and verified. Milestone 5 has not started. Tracking remains off by default. Milestone 3 remains the production release.

Set `NEXT_PUBLIC_ENGAGEMENT_ENABLED=true` **at build time** to exercise instrumentation. It is deliberately off in ordinary builds and `.env.example` pending provider-release review. The 2026-10-15 deployment includes these controls with collection explicitly disabled; see the latest deployment entry below.

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
- `npm test` — PASS: 229 tests, 0 failures, including the original suites, consumption tests, and six runtime-coordinator tests.
- `NEXT_PUBLIC_ENGAGEMENT_ENABLED=true npm run build -- --webpack` — PASS, including TypeScript validation.
- Default-off `npm run build -- --webpack` — PASS; authenticated desktop/mobile checks confirm it creates no engagement database or collection notice.
- `scripts/engagement-integration-smoke.cjs` with mocked Spotify + real account-scoped IndexedDB — PASS at 390px/1400px: pointer and keyboard inspection, failed-play suppression, confirmed start, one completion at 75%, native cross-tab lock exclusion/release, settings navigation, reload recovery without synthetic events, signed-in demo exclusion, and existing account removal clearing history.
- `scripts/engagement-storage-smoke.cjs` — PASS: idempotent/concurrent saves, account isolation, rollback after injected failure, stale revision protection, metadata exclusion, reload, retention pruning, and account-specific clear.
- `scripts/navigation-player-smoke.cjs` — PASS desktop/mobile: playback continuity, cached tracks, layout, transient failures, and no extra Web API playback commands.
- `scripts/bin-gesture-smoke.cjs` — PASS desktop/mobile after correcting its outdated demo fixture setup: gestures, keyboard, sleeve return, full track-list scrolling, and vinyl playback.
- `git diff --check` — PASS.
- Spotify calls in browser tests are mocked; no production data, provider history, or real listening activity used. Native protected audio/background playback remains outside automated verification.

## Known issues / release limitations

1. **Disabled by default:** public activation still requires review of applicable Spotify provider requirements. No claim of provider approval or production rollout.
2. **Conservative measurement:** short startup/lock acquisition gaps, seeks, background suspension, uncertain SDK state, and a crash before the next durable checkpoint can undercount. No claim of exact listening measurement or guaranteed unload persistence. Native iOS background playback still needs physical-device tests.
3. **Device-local:** Web Locks coordinate same-origin tabs only, not different devices. No cross-device aggregate or sync exists; future sync needs deliberate session/reset semantics.
4. **Unresolved imports:** inspection is deferred until album identity resolves within the selected opening; failed/cancelled resolution does not create a canonical event. Manual/demo records are intentionally excluded. Track availability changes during a session conservatively interrupt counting if the duration denominator changes.
5. **Retention:** events and sessions are pruned independently at activation/hourly maintenance. Do not assume unlimited historical coverage, or that every retained event has a retained session. Active memory retry is capped; persistent storage failure can lose events once capped or the tab closes.
6. **Saved-only discovery eligibility:** bounded provider check, separate local cache and pure eligibility rules now exist. The explicit Discover preparation flow uses the bounded cancellable coordinator and account-scoped Web Locks. Imports/provenance never qualify on their own. Membership is a last-verified observation with seven-day expiry, not a live guarantee; future discovery must recheck unknown/expired entries and exclude known removals.
7. **Personal-bin action tracking is deferred:** it is not part of Milestone 1's enumerated inspect/play/duration/completion acceptance list. Existing personal memberships remain available as optional signals; event integration belongs with organizational work before scoring uses it.
8. **Local history controls:** Download My Data exports saved history, album references and bins. Reset deletes only this account’s local behavioral history and pending writes, preserving collection and sign-in. Other devices and already-downloaded files are unaffected. The separate data export is not restorable. Older schema-v1 tabs must reload after the upgrade; a blocked reset reports failure without clearing history.

## Not yet implemented

Milestones 1–4 are complete. Milestones 5–8 remain unimplemented: weighted behavioral scoring, feedback controls, destination-picker improvements and evaluation metrics. Generated snapshots retain only the latest set, not historical archives.

## Exact next step

STOP before Milestone 5. Milestone 4 is ready for local review. Existing current seven-day snapshots deliberately retain their records/order and `framework-1` version; a newly prepared set after expiry or personalization reset uses `cold-start-1`. Do not reset personal history merely to inspect the change without considering deletion. Automated fixtures verify old-to-new transitions and diverse/sparse libraries without touching personal data.

No push/deployment was requested for this milestone. The arrow-position fix was deployed separately on 2026-10-20; Milestone 4 remains local only. Await user testing/release direction and explicit Milestone 5 authorization. Preserve default-off history collection. The discussed single-click auto-continuation of preparation remains an unimplemented usability follow-up, not part of these selection changes.

## Last known stable commit

- Before Milestone 4: `49d5102` (`fix: keep browsing arrows above variable album titles`), local only and user-approved.
- Milestone 4 completion is titled `feat: add discovery cold-start heuristics`; obtain its hash from git log after commit.
- GitHub release handoff: `1e1772e`. Production application: `49d5102` (arrow fix only), deployment `dpl_HEA5vgdMgMVCz6RF6yUzSnRG5X2A`, with history collection explicitly disabled.

## Milestone 1 correction — browsing during playback (2026-10-08)

The reported symptom was new playback-start entries while browsing, without an audio change. Inspection already uses the browsed sleeve identity and the player observes its own selected playback album. A two-album app regression did not reproduce a distinct playback session created by browsing alone.

Confirmed storage issue: every checkpoint rewrote the same-ID start event (and, after completion, the completion event). `saveSession` now inserts the start only for a new session and completion only when it is first attained, while checkpoints update the session summary. No existing history is rewritten or deleted by this fix.

Changed files: `app/lib/engagement-storage.ts`, `tests/engagement-tracker.test.mjs`, `scripts/engagement-storage-smoke.cjs`, `scripts/engagement-integration-smoke.cjs`, and this handoff.

Verification: 229 Node tests passed; lint, enabled production build/typecheck, and diff check passed. Real IndexedDB instrumentation proves exactly one write for each playback event across checkpoints/finalization. Desktop/mobile integration now plays A while opening B, checks only an inspection for B, verifies every playback event/session still belongs to A, and verifies the player metadata stays on A. Existing integration assertions for failure, completion, ownership, reload, demo isolation, and deletion still pass.

Last stable commit before correction: `a8bed23`. The correction commit is titled `fix: keep playback events stable while browsing`. No deployment or public tracking activation. Remain at Milestone 1 complete; the next milestone is still Milestone 2 only when explicitly authorized. If distinct new session IDs are reported again, capture their album IDs/timestamps and reproduce the exact input path; redundant writes alone do not explain distinct session IDs.

## Milestone 1 follow-up — inspections queued behind playback (2026-10-09)

User reports that opening a sleeve while A continues playing appears as a new playback entry for A. This remains a Milestone 1 investigation, not authorization for Milestone 2. The two previously supplied events have different session IDs and album IDs, but the remembered browsed album matches neither; they do not establish which action created either session.

Confirmed and fixed a separate timing defect: `flush()` iterated a snapshot of pending writes. An inspection enqueued while a playback save was awaiting IndexedDB was left pending until a later flush (normally the 15-second timer). The playback entry could therefore be visible without the inspection. The writer now drains additions received during successful saves immediately, retaining the existing stop-on-error retry policy and per-ID checkpoint coalescing. No existing history is rewritten or cleared.

Files changed: `app/lib/engagement-tracker.ts`, `tests/engagement-tracker.test.mjs`, `scripts/engagement-integration-smoke.cjs`, and this document.

Verification:
- Deterministic blocked-playback-save regression FAILED before the fix (zero persisted inspections), PASSED after (one inspection for B, one session for A without another timer/checkpoint).
- `npm test`: PASS, 230 tests.
- `npm run lint`: PASS.
- `NEXT_PUBLIC_ENGAGEMENT_ENABLED=true npm run build -- --webpack`: PASS, including TypeScript.
- Mocked Spotify + real IndexedDB integration: PASS at 390px and 1400px, with both normal and reduced motion. Repeatedly reopening B adds one inspection per opening and preserves A's original playback session ID. Existing completion, failed-play, ownership, navigation, reload, demo exclusion, and deletion checks also pass.
- `git diff --check`: PASS.

Known issue: no test has reproduced a distinct new playback session created by sleeve inspection alone. This queue correction is not proof that the user's entire symptom is resolved. Playback-start persistence can also lag initial playback confirmation/ownership; no change to those semantics in this patch. Public collection remains disabled by default; no push/deploy.

Exact next step: retest the same play-A/open-B sequence on this local build. Compare the set of start-event session IDs before and after opening B, alongside the new inspection. If a distinct start ID is added, capture the explicit start/resume invocation and SDK observations in that reproduction before changing session semantics. Do not begin Milestone 2 as part of this bug investigation.

Last stable commit before this patch: `c5f6dae` (`fix: keep playback events stable while browsing`). This patch's commit is titled `fix: drain inspections queued during playback saves`.

## Milestone 1 investigation — readable tracking trace (2026-10-09)

User still reports the same symptom after the queue correction. Do not treat that correction as resolution. Inspection/session separation continues to pass automated tests, but the user's exact failure has not been reproduced. The local port-3000 server was checked and is `next dev`, not an old `next start` process; this does not prove which URL/build the user is viewing.

Added a read-only **Tracking debug** panel near the bottom of Library & settings, gated behind the existing enabled-tracking build flag and authenticated account. It resolves stored album IDs to library titles, sorts the latest 40 persisted events newest-first, and shows session/inspection IDs. A bounded, account-scoped, memory-only trace shows sleeve opens, inspection requests, start/resume requests, confirmed session creation and tracking end, plus the most recent selected-vs-Spotify-reported playback album. The trace clears on reload/lifecycle cleanup or account removal; nothing is uploaded or included in general problem-report diagnostics. The panel makes no Spotify requests, changes no existing history, and provides no reset or general data-export feature. This is Milestone 1 troubleshooting, not Milestone 2 implementation.

Files changed:
- `app/lib/engagement-debug.ts`: bounded test-only trace and latest observation.
- `app/engagement-debug.tsx`: manually refreshed, title-resolved read-only history panel.
- `app/use-engagement.ts`, `app/lib/engagement-tracker.ts`, `app/record-bin.tsx`: trace existing transitions without changing session semantics.
- `app/library-screen.tsx`: test-build/settings-only panel entry.
- `scripts/engagement-integration-smoke.cjs`: checks human-readable inspection/playback/trace identities, unchanged session count when viewing history, absence of account ID in report, and disabled-build exclusion.
- This handoff.

Checks: 230 Node tests PASS; lint PASS; tracking-enabled and tracking-disabled production builds/typechecks PASS; diff check PASS. Desktop/mobile real-IndexedDB + mocked-Spotify panel checks passed with normal motion before the additional sleeve-open marker and with reduced motion on the final build (including that marker). Disabled-build browser checks passed at both widths: no panel and no engagement database. No live Spotify playback used, no push/deploy, no public activation.

Known issue: root cause of a distinct playback start allegedly triggered by browsing remains unconfirmed. Do not make further speculative changes to session boundaries. The test view is a manually refreshed snapshot; action trace covers only the current page load, while saved events survive reload.

Exact next step: refresh the user's existing local app once to load the tracing code; play A and open B, then visit Library & settings → Tracking debug and capture the text WITHOUT reloading again. Compare sleeve/inspection interaction IDs, Start requested / Session confirmed entries, saved session IDs and reported Spotify album. This should distinguish a missing inspection, delayed confirmation, explicit start path, or a display-order misunderstanding. Remain on Milestone 1 until this report is explained; do not start a later milestone.

Last stable commit before this diagnostic patch: `7b4ce66` (`fix: drain inspections queued during playback saves`). Diagnostic commit title: `chore: add readable local tracking diagnostics`.

## Tracking follow-up and authorized settings cleanup (2026-10-12)

The user's debugger-v1 capture shows correct behavior in this run: Salt start requested at 11:39:08, session confirmed at 11:39:12, and Slowhand opened/inspected at 11:39:33 without another start. Do not describe the earlier suspected conversion of inspections to starts as reproduced. Spotify's reported album URI differs from the selected Salt album; v1 lacks enough track information to explain that discrepancy.

Debugger v2 now includes the SDK track URI, linked original URI when present, matched library track URI using the existing matcher, and album context if reported. These are in the existing bounded local-only debug snapshot; no new provider requests, stored history fields or playback rules. Debugger is now under Library & settings → Account & advanced → Advanced & troubleshooting → Tracking debug.

Separately authorized UI cleanup completed:
- Three clear groups: Library; Organization; Account & advanced.
- Routine import controls and active progress stay visible; batch size, full rescan and playlist-link entry move into More import options.
- Manage my systems opens the existing shelf bin editor without remounting the player.
- Request usage, demo playback and debugging/problem reporting are collapsed under Advanced & troubleshooting. Backup remains last.
- Removed Spotify data-file import UI and its obsolete UI smoke script; updated first-use guidance and README. Existing export-origin albums, resolution support, parser tests and Record Cabinet backup restore remain supported.

Files: `app/library-screen.tsx`, `app/globals.css`, `app/record-bin.tsx`, `app/listening-guide.tsx`, `app/use-engagement.ts`, `app/lib/engagement-debug.ts`, `app/engagement-debug.tsx`, `README.md`; removed `app/spotify-export-import.tsx` and `scripts/spotify-export-smoke.cjs`; updated `scripts/engagement-integration-smoke.cjs`, `scripts/navigation-player-smoke.cjs`, `scripts/beta-tools-smoke.cjs`, `scripts/offline-smoke.cjs`, and this handoff.

Checks: 230 Node tests PASS; lint PASS; tracking-enabled production build/typecheck PASS; diff check PASS. Desktop/mobile navigation regression PASS, including grouped settings, absent file importer, no horizontal overflow, organization shortcut, same playing SDK instance and no extra playback commands. Desktop/mobile tracking integration PASS, including debugger-v2 matched-track output and collapsed tools. Updated its post-reload demo step to open Advanced before clicking the now-hidden button. Desktop/mobile settings screenshots captured with mocked services; mobile visual review confirms the groups and bottom backup. No real Spotify quota used. Temporary Playwright runner had been cleared from /tmp and was restored outside the repository; no dependency changes.

Known issue: the Salt album-ID mismatch is unexplained pending v2 evidence; no speculative matching changes. This is not a general declaration that every past tracking report is resolved. No later discovery milestone, push, deployment or public tracking activation.

Exact next step for debugging: on the updated local build, play Salt (or another record showing different selected/reported album IDs), open Advanced & troubleshooting → Tracking debug, and capture the latest Spotify observation block. Compare SDK and linked track IDs to the matched library track; if there is no match, investigate status/session timing rather than relabeling the album. Current user-provided evidence does not call for repeating the same sleeve-inspection test. Continue discovery milestones only on explicit authorization.

Last stable commit before this work: `9510b5d` (`chore: add readable local tracking diagnostics`). This change is titled `refactor: simplify settings and clarify playback diagnostics`.


## Milestone 2 export checkpoint (2026-10-14)

The latest real debugger-v2 capture explains Salt's differing album ID: the SDK linked original URI exactly equals the matched library track, and album context is Salt's requested URI. This is track relinking, not evidence of misattributed listening. No matching-rule change was needed. User then explicitly authorized Milestone 2 with a usage-dependent stopping point; this session completes and stops at export, leaving reset for the next session.

Completed:
- Account and privacy → Download My Data creates pretty-printed, versioned `record-cabinet-personalization` JSON from the current account's saved local data.
- Export includes non-demo album references, inspection/playback/completion events, listening-session summaries and unique coverage, personal systems/bins/memberships, and ISO timestamps. Missing album-added timestamps and unrecorded bin/membership timestamps are null; generated history/feedback are explicitly not implemented.
- Field-by-field output construction and validation exclude credentials, account hashes, raw SDK payloads, arbitrary extra metadata, URLs and unrelated storage settings. Mixed-account or malformed history fails the export instead of silently dropping rows. This does not redact user-entered album/bin names.
- Controls are available to authenticated accounts even when collection is disabled, so previously retained history remains downloadable. Guests have no personalization export button.
- No cloud read, provider request, history mutation, reset, forced pause or speculative listening sample. Export reflects committed checkpoints; current unsaved listening may be absent. Library/history/organization are separate local reads, not a cross-store atomic snapshot. History can reference removed albums/pruned sessions and remains exported as stored.
- Brief control/privacy-page copy distinguishes this readable data export from the restorable Collection backup. Reset is explicitly not available yet.

Files changed:
- `app/lib/personalization-export.ts`: validated, allowlisted export format.
- `app/personalization-data.tsx`: account-scoped download control, safe error feedback and unmount protection.
- `app/account-tools.tsx`: privacy-panel integration, remounted per account.
- `app/privacy/page.tsx`: collection/export scope, retention and current deletion limitations.
- `tests/personalization-export.test.mjs`: 4 focused format, credential exclusion, account boundary/corruption and missing-data tests.
- `scripts/engagement-integration-smoke.cjs`: actual downloaded JSON on desktop/mobile; active-playback export, other-account exclusion, personal membership preservation, unchanged auth/events, failure recovery, and tracking-disabled empty/retained-history exports.
- `docs/discovery-system.md`, this handoff.

Checks: `npm test` PASS (234 tests); `npm run lint` PASS; tracking-enabled and tracking-disabled `npm run build -- --webpack` PASS including TypeScript; `git diff --check` PASS. Real IndexedDB + mocked Spotify integration PASS at 390px/1400px with reduced motion: export during playback keeps the SDK playing, preserves cookies and history, exports personal-bin memberships, excludes a seeded second account, and handles malformed organization without deleting history or stopping audio. Disabled-build tests confirm no automatic collection and successful empty/retained-history downloads. Existing tracking/session/ownership/reload/removal assertions still pass. No live provider requests or credentials used in tests.

Known limits / clean stopping boundary: Reset Personalization History is NOT implemented; no reset button or misleading completed-milestone claim. Export is device-local, committed-data-only, and not a collection restore file. No new bin/assignment timestamp tracking added. Production tracking remains off by default; enabling it still needs completed controls and release review. Exact next step and reset race requirements are at the top of this handoff.

## Independent browsing fix (2026-10-14)

User requested Random record respect the current selection. `app/record-bin.tsx` now uses the open bin's albums and reopens that same bin at the chosen index; on the shelf it still draws from All records. Existing shuffle behavior, fly-through animation and closed-sleeve selection are preserved. Verified 234 tests, lint, production build/typecheck and diff check; desktop/mobile browser checks repeatedly select within Artist, Album and Genre bins without leaving the bin or opening the sleeve, and confirm shelf random still uses All records. No push/deploy. Milestone 2 remains at the export checkpoint (`6816ddc`); next discovery work is still the history-only reset described above.

## Independent system-media control change (2026-10-15)

At the user's request, Next/Previous media-session actions now have explicit no-op handlers. Play/Pause, seek actions and turntable-arm scrubbing are unchanged. Updated `app/lib/media-session.ts`, its existing unit test and `scripts/navigation-player-smoke.cjs`. Verified 234 tests, lint, production build/typecheck and diff check; desktop/mobile-layout browser checks invoke both system actions and confirm no SDK playback calls, while navigation and existing transport behavior still pass. Physical iOS/macOS media surfaces still need device verification; OS-controlled button appearance is not changed by this patch. No push/deploy. Milestone 2 remains partial at the export checkpoint; history-only reset is still next.

## Milestone 2 completion — history reset (2026-10-15)

Completed:
- Added confirmed Reset Personalization History under Account and privacy, alongside Download My Data. Available even when collection is disabled. Cancellation preserves history; failure reports that nothing was cleared.
- Reset atomically clears this account’s local events and sessions while advancing a minimal non-behavioral generation marker. Albums, personal systems/memberships, genres, import settings, cloud data, authentication and audio playback are untouched. Generated history/feedback do not exist yet.
- Engagement schema v2 migrates existing rows intact. Every behavioral writer captures its generation before collecting and checks it in the same transaction as its write. Queued, failed, concurrent and notification-missing writers cannot resurrect deleted history. Blocked upgrades reject without silently completing a reset later; old schema-v1 code cannot reopen the upgraded database.
- Same-tab events and BroadcastChannel discard trackers/debug snapshots promptly. Focus/visibility/checkpoint checks recover missed notices; correctness does not depend on notifications. Reset never waits for the playing tab’s long-held playback lock.
- Ongoing audio keeps playing without a synthetic new session. Fresh sleeve inspections and explicit play/resume start fresh history. Deferred album-resolution inspections remain bound to the original tracker so an old opening cannot become new history after reset.
- Export/debug reads cancel stale snapshots on reset; downloads following reset contain empty behavioral history and retain album/bin references. No credentials or new provider calls.

Files changed: `app/lib/engagement-storage.ts`, `app/lib/engagement-reset.ts` (new), `app/lib/engagement-tracker.ts`, `app/use-engagement.ts`, `app/record-bin.tsx`, `app/personalization-data.tsx`, `app/engagement-debug.tsx`, `app/privacy/page.tsx`, `tests/engagement-tracker.test.mjs`, `scripts/engagement-storage-smoke.cjs`, `scripts/engagement-integration-smoke.cjs`, and both discovery documents.

Checks: 236 Node tests PASS; lint PASS; tracking-enabled and tracking-disabled production webpack builds/typechecks PASS; diff check PASS. Real Chrome IndexedDB checks PASS for v1 migration, blocked/late upgrade, reset rollback, raced/old writes, repeated resets, fresh writers, account isolation and another page missing notifications. Mocked-Spotify integration PASS at 390px/1400px with reduced motion: cancel, injected storage failure, repeated/cross-tab reset during playback, unchanged SDK/cookies/bins/albums, empty post-reset export, fresh inspection/resume with new session ID, plus previous navigation/inspection/completion/ownership/removal regressions. Disabled-build checks verify no automatic collection and export/reset of retained history. No live Spotify calls or credentials used.

Known limits: resets are origin/account/device-local; other devices and exported files are unaffected. Tabs missing notifications may retain an old visible snapshot until a focus/checkpoint/refresh, but stale writes remain fenced. Historical export reads across library/history/organization are not globally atomic. Native iOS/background audio remains a physical-device check. Public collection remains default-off pending release/provider review.

Exact next step: stop at this completed milestone. Await authorization for Milestone 3 and address saved-membership eligibility before generated snapshots. Last stable commit before this patch: `c7716cd`; completion commit title: `feat: add personalization history reset`.

## System-media arrow follow-up (2026-10-15)

User reports native arrows still skip locally and online. Inspection found that `enableMediaSession: true` still allowed Spotify's SDK to install its own metadata/action handlers, competing with app handlers; timed `seekbackward`/`seekforward` also remained enabled. Disabled SDK media-session registration so the app owns these controls, and made both timed arrows no-ops alongside next/previous. Play/pause, absolute seek and the tonearm remain supported. This addresses concrete handler gaps, but does not establish that every native OS control surface dispatches to this page.

Changed `app/lib/spotify-browser.ts`, `app/lib/media-session.ts`, `tests/media-session.test.mjs`, `scripts/navigation-player-smoke.cjs`. Browser mock now models SDK handler registration during playback updates when enabled, checks all four arrow actions, and verifies tonearm seeking. Checks: 236 tests, lint, production webpack build/typecheck, desktop/mobile navigation/player smoke and diff check. Real Spotify/iOS/macOS lock-screen ownership still needs physical-device verification. Online has not received either local media-control patch; no push/deploy. Reload/reconnect the local player to construct the SDK with the new option. Milestone 2 stays complete; Milestone 3 not started. Last stable commit before this patch: `9894759`.

## Authorized production deployment (2026-10-15)

After closing Spotify desktop, the user reports Mac Now Playing arrows behaved as requested; mobile verification remains outstanding. User authorized deploying the current app to the existing HTTPS address for phone testing. Deployed `fd70036` to https://record-cabinet-livid.vercel.app as `dpl_CUL1wjrSt5phPRGnfC5tp6E57T7q`, with `NEXT_PUBLIC_ENGAGEMENT_ENABLED=false` explicitly set at build time. Vercel build/typecheck passed. Public demo/settings/privacy returned 200 at 390px/1400px with no browser errors or horizontal overflow. Served bundles confirm collection disabled and SDK media-session registration disabled. No authenticated/live Spotify playback was automated, and no GitHub push occurred. Milestone 2 complete; Milestone 3 untouched. Next user test: reload the production site on a phone, start playback, check lock-screen arrows/play/pause and tonearm seeking. Discovery work remains stopped pending authorization.

## Mobile playback follow-up (2026-10-15)

Live phone testing showed the native integration disable caused generic “Spotify Embedded Player” metadata and timed arrows. User explicitly chose restoring native artwork/information despite the possible return of skip controls. Restored SDK `enableMediaSession:true`; the parent still publishes album-level metadata, but the OS may select Spotify’s iframe and its track-level metadata/controls. Removed parent `seekforward`/`seekbackward` handlers to avoid advertising timed jumps. This is not a guarantee of native control appearance or disabled Spotify-owned skip actions. Corrected browser smoke to test parent handlers only, without pretending SDK handlers share the parent frame.

User reports extra Play required after selecting a new record. Found that `playAlbum` can await cache/availability/provider work before activating the connected audio element. Added synchronous `activateFromGesture` at the vinyl-click entry before those waits; retains normal first-connection handling and no retry of uncertain playback mutations. First connections/reconnections may still need another tap; iOS must verify improvement. Changed `app/record-bin.tsx`, `app/use-spotify-player.ts`, `app/lib/spotify-browser.ts`, `app/lib/media-session.ts`, both playback/media unit tests and navigation smoke. Tests: 237 unit checks, lint, production webpack build/typecheck; desktop/mobile navigation/transport/tonearm regression. Tracking remains off; Milestone 3 untouched. Last stable commit: `4cd520e`. Next: verify native artwork and switching records on the phone after deployment; do not describe lock-screen behavior as automatically proven.

Deployed the mobile correction from `3beca46` as `dpl_EoP3KAbq4cEtSKnGJAMV8mq6ipUT` to the existing production alias, with tracking disabled. Live served code confirms native metadata enabled and early activation present. Phone retest remains the next step; no Milestone 3 changes.

## Milestone 3 saved-membership checkpoint (2026-10-16)

Completed the prerequisite as a clean sub-boundary; Milestone 3 is NOT complete and no discovery bins are visible yet.

- Pure eligibility module identifies canonical Spotify album playback URIs (including resolved exports), excludes manual/demo/unresolved records, and never infers membership from import source, liking a track or Spotify metadata. Duplicate editions with the same canonical ID qualify once; collection order is preserved.
- `POST /api/spotify/library` accepts `{ membershipAlbumIds: ["spotify:..."] }`, validates at most 40 inputs and deduplicates them. Uses current `/v1/me/library/contains?uris=...`, existing account/origin checks, token refresh, shared request pacing/cooldown and metadata usage accounting. No album/track requests, no provider mutations, no public caching. Unsuccessful or malformed responses do not produce negative membership records. The default UI does not invoke this route option yet, so no new background requests.
- Each observation stores canonical album ID, boolean saved status, request-start timestamp and fixed source. Cache lives in the account's existing library/settings store, independently of albums/organization/cloud. Concurrent stale responses cannot overwrite newer observations; equal-time conflicts prefer not-saved. Corrupt caches fail closed; broad account removal clears membership. No schema migration or new infrastructure.
- Fresh positive checks qualify; fresh negatives do not. Missing, future-dated or seven-day-old observations are unknown. Batch planning skips fresh positive and negative checks, allowing future interrupted reconciliation to resume without rechecking every album. Never delete cabinet records because Spotify returns false.

Files: `app/lib/saved-membership.ts` (new); `app/api/spotify/library/route.ts`; `app/lib/library-storage.ts`; `tests/saved-membership.test.mjs` (new); `tests/library-storage.test.mjs`; `tests/spotify-requests.test.mjs`; `scripts/membership-storage-smoke.cjs` (new); both discovery documents.

Checks: 242 Node tests PASS; lint PASS; production webpack build/typecheck PASS; diff check PASS. Real Chrome IndexedDB smoke PASS: persisted membership after reload, concurrent stale response protection, injected write failure rollback, separate accounts, unchanged albums and scoped deletion. Route tests cover bounded/deduplicated URI queries, origin/session/account refusal, malformed provider data and 429 propagation. No live Spotify requests, no personal data used, no push/deploy.

Known limits: no client reconciliation UI, no snapshot persistence/rendering, no scoring. Seven-day freshness is a deliberate maximum cache age, not real-time membership assurance. A new observation saying not-saved must filter future/existing snapshots on the next client refresh; unsaves cannot be known while offline. Membership is device-local and not included in backups/cloud sync; future exports may include verification metadata as library data. Pending reconciliation cancellation/reset fencing must be designed when wiring the client; there is currently no pending client reconciliation to cancel. Old saved-import provenance is not backfilled as evidence. Native lock-screen/extra-tap issues remain parked as requested.

Exact next step: client reconciliation plus generated snapshot/UI work listed at the top. Stay within Milestone 3. Last stable commit before this checkpoint: `5af5c4b`.


## Milestone 3 reconciliation checkpoint (2026-10-17)

Completed another clean sub-boundary; Milestone 3 remains incomplete and there are still no visible generated bins.

- Added an explicit account-scoped refresh coordinator and unmounted React adapter. Each run checks at most three batches of 40 albums, skipping fresh positive and negative observations; subsequent runs resume from committed cache. Concurrent starts on the same controller share one run. Nothing fetches on creation/mount.
- Cancel, disposal and account lifecycle stop pending work. Each request has a 30-second timeout. Cooldowns, malformed/foreign/incomplete/stale results, network and storage errors stop without automatic retries. Progress distinguishes partial, complete, cancelled and error states.
- Replaced unfenced membership writes with generation-bound writers. Broad local removal atomically advances a minimal generation marker while clearing albums/settings. Old responses cannot restore deleted membership even if a writer misses deletion notifications. Abort signals also cancel pending write transactions. Metadata writes do not trigger cloud sync or album changes.

Files changed: `app/lib/membership-refresh.ts` (new), `app/use-membership-refresh.ts` (new), `app/lib/library-storage.ts`, `tests/membership-refresh.test.mjs` (new), `tests/library-storage.test.mjs`, `scripts/membership-storage-smoke.cjs`, and both discovery documents.

Checks: 247 Node tests PASS; lint PASS; production webpack build/typecheck PASS; diff check PASS. Real Chrome IndexedDB smoke PASS for reload persistence, concurrent stale writes, rollback, account isolation, unchanged albums, scoped deletion and rejection of an old writer after deletion. Coordinator tests cover bounded resume, deduplicated starts, cancellation/disposal, late responses, wrong accounts/IDs, partial/stale results, failures and empty/guest libraries. No live Spotify calls, push or deployment. Tracking stays default-off.

Known limits: the hook is not mounted, so no new user-visible controls or provider traffic; actual React/account lifecycle integration still needs browser verification when connected. Separate tabs can initiate duplicate checks (no cross-tab request ownership yet). Client/server clock skew can conservatively reject future-dated checks. Membership stays local library metadata; personalization reset does not clear it. Snapshots, bin UI and generated-data export/reset remain unimplemented. Native media issues remain parked.

Exact next step: build the snapshot repository and simple three-bin framework described above, then wire the explicit coordinator/UI with cross-tab request ownership and browser checks. Preserve the 20-album caps, seven-day stability, zero overlap and eligibility filtering; integrate generated state with export/reset before completion. Do not begin Milestone 4. Last stable commit before this checkpoint: `76656d4`.


## Milestone 3 snapshot checkpoint (2026-10-17)

Completed the persistence/assignment/privacy sub-boundary. Milestone 3 remains incomplete: no discovery tab, user-facing membership check, or candidate generator is mounted. Stop here rather than partially wiring cabinet browsing; continue Milestone 3 only.

Completed:
- Added a validated, allowlisted `framework-1` snapshot containing three ordered bin types, canonical album IDs, account identity, generation/expiry timestamps and snapshot ID. Cap is 20 per bin, seven-day lifetime and zero overlap. Assignment accepts separately ordered candidate lists, filters against verified saved membership and distributes candidates round-robin to avoid exhausting small libraries in the first bin. Empty candidate lists remain empty; no fabricated Forgotten Favorites or weighted recommendation scoring.
- Added an eligibility-filtered viewing function: removed, missing, stale and future-dated membership is excluded while retained order stays stable. Expired/future snapshots expose empty bins. Filtering never mutates, fills or reshuffles the persisted set.
- Persisted the latest snapshot in the existing engagement metadata store without a schema change. Generation-bound transactions serialize competing tabs: first current snapshot wins, expired snapshots can be replaced, and a late older response cannot overwrite a newer snapshot. No behavioral events are created by snapshot storage. Reset/local removal atomically delete it and fence old writers, including tabs missing notifications. Older v2 reset code also invalidates snapshots by advancing the shared generation.
- Download My Data now includes the latest snapshot with readable timestamps and no account hash/unknown metadata. It does not retain previous generations or feedback. Updated reset/privacy copy to distinguish generated bins from preserved personal bins. No provider calls or public collection activation added.

Files changed: `app/lib/discovery-snapshot.ts` (new), `app/lib/engagement-storage.ts`, `app/lib/personalization-export.ts`, `app/personalization-data.tsx`, `app/privacy/page.tsx`, `tests/discovery-snapshot.test.mjs` (new), `tests/personalization-export.test.mjs`, `scripts/engagement-storage-smoke.cjs`, `scripts/engagement-integration-smoke.cjs`, and both discovery documents.

Checks: 251 Node tests PASS; lint PASS; production webpack build/typecheck PASS; diff check PASS. Real Chrome IndexedDB smoke PASS including existing history migration/blocking/rollback tests and new snapshot reload, account isolation, concurrent convergence, expiry, stale response, cross-tab reset and local removal tests. Production browser integration PASS at 390px and 1400px with mocked Spotify: tracking stays disabled, empty/retained exports work, a seeded snapshot is exported and reset removes it. No real Spotify activity or personal data used.

Known limits: only the latest snapshot is retained, not an archive of old bins; feedback remains Milestone 6. Candidate selection, UI lifecycle and cross-tab membership request ownership remain unfinished. A corrupt same-generation snapshot fails export/load closed; reset can clear it. Membership is device-local last-verified metadata and must be rechecked explicitly when stale. No changes to actual album organization, browsing, playback or parked native-media issues. Not pushed/deployed.

Exact next step: add cross-tab ownership around membership refresh, implement the basic candidate generator and native discovery UI, then verify end-to-end generation/reload/expiry/removal/reset without remounting playback. Use the repository and assignment functions above; preserve default-off tracking and do not begin Milestone 4 heuristics. Last stable commit before this checkpoint: `3e14abe`.


## Milestone 3 completion — native discovery bins (2026-10-19)

Completed:
- Added Discover alongside the existing arrangement tabs without changing persisted alphabetical/custom organization. Forgotten Favorites, Wander and Digging use the cabinet's existing wooden-bin rendering, sleeves, dividers, gestures and player; each has a short blurb and honest empty state. Generated ordering is preserved rather than sorted alphabetically. Random record on the Discover shelf draws only from its generated bins, and within a bin stays in that bin. Existing library Continue digging is preserved; generated-bin visits do not overwrite its bookmark.
- Connected explicit preparation and saved-membership checks with checked/total progress, cancellation, partial continuation and errors. Each action caps at three requests of 40; all eligible local Spotify album references must have current positive/negative checks before generating. Positive checks alone qualify. Fresh checks are reused; no provider requests on browsing, reload, timer or focus. Account Web Locks exclude concurrent check runs without queueing; unsupported browsers fail with a message instead of uncoordinated requests.
- Added a deliberately simple `framework-1` generator: shuffled candidates for Wander; no recorded plays/completions for Digging; at least two distinct completions and no retained interaction in 30 days for Forgotten Favorites. It uses retained first-party events only. No weights, genre/artist caps, personal-bin inference, external recommendations or later-milestone tuning. The shared assignment layer keeps caps and zero overlap.
- Preparation persists a set once, respects the first-current-snapshot transaction rule and regenerates only on an explicit prepare after expiry/reset. Local read/focus checks reconcile saved membership and history reset without provider traffic. Stale/removed membership filters the display without refilling or mutating order. Changes to an open generated set retire the browsing view; they do not stop or remount the player. Pending preparation is invalidated by cancellation, account change, local removal and reset; generation fences remain the durable protection.
- Updated privacy and test coverage. Existing export/reset includes generated snapshots. UI states when history collection is off; it does not silently enable collection to fill favorites.

Files changed: `app/lib/discovery-generator.ts` (new), `app/use-discovery.ts` (new), `app/use-membership-refresh.ts`, `app/record-bin.tsx`, `app/record-bin.module.css`, `app/privacy/page.tsx`, `tests/discovery-snapshot.test.mjs`, `scripts/discovery-integration-smoke.cjs` (new), `scripts/engagement-integration-smoke.cjs`, and both discovery documents.

Checks: 252 Node tests PASS; lint PASS with no warnings; production webpack build/typecheck PASS; diff check PASS. New real-browser integration at 390px/1400px with mocked Spotify PASS: no mount/browse requests; bounded checks/resume; negative membership exclusion; cancellation; 429 stopping; cross-tab request exclusion; three rendered bins; cap/no overlap; sleeve browsing and random navigation; stable reload; explicit expiry regeneration; removal filtering without persisted refill; reset from another tab; and unchanged playing SDK instance/no pause commands while browsing. Existing desktop/mobile navigation-player smoke PASS. Default-off export/reset integration PASS at both sizes, including snapshot export/reset and no synthetic behavioral history. Inspected both responsive screenshots; no horizontal overflow. Prior real-IDB snapshot persistence/concurrency/reset tests remain unchanged. No real provider calls or personal data used.

Known limits: seven-day membership freshness is not real-time Spotify synchronization. Local changes from another tab are reconciled on focus or within 15 seconds; unavailable storage fails closed. Preparing a large library needs repeated explicit continuation, not an unattended request loop. Only the latest snapshot is stored locally; there is no cross-device discovery sync or historical archive. Forgotten Favorites can remain empty, especially with tracking off; Digging's evidence is limited to retained local history. Clock skew may reject provider checks conservatively. Native mobile media issues remain parked. No push or deployment.

Exact next step: user testing of Discover with the real account, then an authorized push/deployment if desired. Milestone 3 is complete; stop before Milestone 4. Last stable commit before this completion: `0bf2e1e`.


## Authorized Milestone 3 release (2026-10-19)

The user reported the real-account local test worked, then authorized pushing and deploying. Pushed `main` from `5af5c4b` through `2f37231` to https://github.com/zhou-ray/record-cabinet. Deployed that clean application commit to the existing Vercel project as `dpl_6M2micyU4JLLLLnFERtSccNdx6Nf`; production alias is https://record-cabinet-livid.vercel.app (immutable deployment: https://record-cabinet-n7s5mbfro-ray-s-stuff.vercel.app).

Vercel production webpack build and TypeScript checks passed. Build explicitly received `NEXT_PUBLIC_ENGAGEMENT_ENABLED=false`. Live Chrome verification at 390px and 1400px passed for public demo, settings and privacy pages: HTTP 200, no JavaScript page errors or horizontal overflow. Served JavaScript contains the new discovery preparation UI and the compiled history-collection-off copy; public settings exposes no Tracking debug button. No automated authenticated Spotify calls or playback on production. Signed-in live Discover/playback remains a user check; earlier local mocked and real-account tests are recorded above.

Files changed in this release follow-up: `docs/discovery-progress.md` only. Last stable app commit: `2f37231`. Milestone 3 is shipped; Milestone 4 untouched. Exact next step: signed-in live smoke test, then await authorization for Milestone 4.

## Independent browsing layout fix (2026-10-19)

Moved Previous/Next album controls directly beneath the bin, before variable-height album titles and status text. Full titles still wrap, but no longer push the arrows down. Changed `app/record-bin.tsx`; no discovery generation, playback or Milestone 4 changes. Lint, production build/typecheck and diff check passed. Local Chrome measurements at 390px/1400px confirmed long titles wrap onto additional lines with unchanged arrow positions, no horizontal overflow and working Previous/Next navigation. Local only; production remains Milestone 3 release `2f37231`. Last stable commit before this fix: `1e1772e`. Next: user verification of the local layout; no new push/deployment authorized in this turn.


## Milestone 4 completion — cold-start selection (2026-10-19)

Completed:
- Wander samples randomized eligible saved-album candidates while preferring the least represented primary artist at each pick. Primary Spotify artist IDs identify groups; normalized primary/display names provide a fallback, and missing credits share an unknown group. It spreads picks across artists where available and still fills single-artist collections without an arbitrary hard cap. Random ordering breaks ties; no provider metadata requests added.
- Digging prefers no recorded interactions, then inspected-only albums, then fewer recorded plays (inspection counts break ties). Completed records do not fill Digging solely to hit a quota. These are simple ordinal exploration tiers, not weighted behavioral scoring. Randomized ordering breaks equal-history ties. Wander leaves enough eligible records for Digging: reserve up to 20, at most half the non-favorite pool, while keeping artist diversity choices available. The remaining least-explored candidates fill Digging. Zero overlap remains enforced by shared assignment.
- Forgotten Favorites still requires two distinct retained completion sessions and 30 days without retained interaction. Duplicate events, foreign accounts, nonpositive/future timestamps cannot add evidence. Cap favorites at 20 before excluding selected IDs from other pools so excess qualifying records remain available to Wander. Insufficient history produces an honest empty bin.
- New snapshots use `cold-start-1`; the durable validator continues accepting `framework-1`. Current sets are not regenerated, reordered or migrated on reload. Expiry followed by explicit preparation creates the new version. Both versions remain compatible with export/reset and generation-fenced persistence. No schema change, new UI controls or collection activation.

Files changed: `app/lib/discovery-generator.ts`, `app/lib/discovery-snapshot.ts`, `tests/discovery-cold-start.test.mjs` (new), `scripts/discovery-integration-smoke.cjs`, `scripts/engagement-storage-smoke.cjs`, and both discovery documents.

Checks: 257 Node tests PASS; lint PASS with no warnings; production webpack build/typecheck PASS; diff check PASS. Cold-start fixtures cover a 100-record dominant artist plus 19 other artists over 20 random seeds, seed variation, saved-only filtering, zero overlap, 20 caps, empty/tiny/single-artist libraries, unplayed-pool reservation, interaction-tier ordering, sparse/recent/duplicate/foreign history, favorites overflow, shared collaborators, missing artist data and legacy snapshot validity. Real Chrome integration at 390px/1400px PASS: ten available artists yield two Wander records each, current legacy snapshots retain identity/order across reload, expired sets regenerate as `cold-start-1`, and previous preparation/cancel/cooldown/locks/browsing/playing/removal/reset checks still pass. Real IndexedDB smoke PASS for both snapshot versions including expiry replacement, stale writes, cross-tab reset, rollback and account isolation. No personal data or live Spotify calls used.

Known limits: history is retained device-local evidence, not complete Spotify listening history; with collection off, only previously retained events inform selection. Artist diversity uses primary credits and is limited by metadata quality and the finite eligible pool. Digging prioritizes records left after Wander's diversity selection, so artist spread can place an untouched record in Wander instead. Small collections produce smaller bins; a one-record collection puts it in Wander to avoid duplication. The 30-day/two-completion favorites rule is unchanged, not tuned with learned or weighted scores. There is no recency weighting, listening-duration scoring, personal-bin inference, feedback learning or evaluation dashboard (later milestones). Existing sets remain stable until expiry/reset. Preparation still uses explicit bounded continuation.

Exact next step: stop at completed Milestone 4. User review and authorized release are next; do not begin Milestone 5 without instruction. Last stable commit before this milestone: `49d5102`. No push/deployment in this session.


## Arrow-fix-only production release (2026-10-20)

User authorized deploying the arrow fix and requested Milestone 4 testing guidance. Exported the exact `49d5102` tree to an isolated temporary directory and deployed it to the existing project; did not deploy local Milestone 4 (`e717a78`) or alter the working app checkout. Vercel deployment `dpl_HEA5vgdMgMVCz6RF6yUzSnRG5X2A` is live at https://record-cabinet-livid.vercel.app, immutable URL https://record-cabinet-c47i0kce8-ray-s-stuff.vercel.app. Build explicitly sets `NEXT_PUBLIC_ENGAGEMENT_ENABLED=false`.

Vercel production build/typecheck passed. Live Chrome checks at 390px/1400px passed: full long titles wrap, arrow coordinates remain unchanged, Previous/Next work, no page errors or horizontal overflow. Served bundles contain history-off copy and no `cold-start-1` code. No authenticated Spotify actions automated. No GitHub push in this release turn. Only this handoff changed locally.

Milestone 4 testing remains local: generate a new set after expiry and verify Download My Data reports `cold-start-1`; current `framework-1` sets intentionally stay unchanged. Examine Wander artist variety, Digging's untouched/lightly explored ordering, honest sparse favorites, no overlap, stable reload, and uninterrupted playback. Do not clear personalization history just to force regeneration without considering the deletion; automated fixture tests already verify cold-start scenarios. Next: local Milestone 4 user review, then await release direction. Milestone 5 untouched. Last stable local application commit: `e717a78`; production application commit: `49d5102`.
