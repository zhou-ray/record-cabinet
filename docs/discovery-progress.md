# Discovery system progress

## Current milestone

Milestone 1 — Behavioral Instrumentation.

**Status: INCOMPLETE, paused at a clean implementation boundary.** The event/session model, pure consumption accumulator, and device-local persistence foundation are implemented and tested. They are deliberately **not connected to the application**. No real browsing/listening behavior is collected. Resume Milestone 1, not Milestone 2.

The current user authorized the next unfinished milestone and explicitly allowed stopping at a safe sub-boundary. No later milestone work has begun.

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

- Read both discovery documents and inspected the clean repository at `9c09a4c` before starting.
- Added typed inspection/start/completion events and versioned playback-session summaries with account and canonical Spotify album identity.
- Added centralized completion (75%), maximum confirmed observation gap (30 seconds), progress tolerance (1 second), and intended checkpoint interval (15 seconds) constants. No recommendation weights or scores added.
- Added a pure accumulator with explicit continuity interruption, bounded verified progress accounting, unique coverage, repeat-safe completion, and finalization. It never infers consumption merely from needle position or time since play was requested.
- Added separate account-scoped IndexedDB storage for events/sessions. Summary and start/completion events save atomically; retry IDs are idempotent; older revisions cannot undo newer checkpoints; divergent same-revision writes reject.
- Verified account isolation, metadata whitelisting, atomic rollback, concurrent writes, and reload recovery using real Chrome IndexedDB in an isolated browser profile.
- Added focused Node tests for invalid identities/durations, pauses, seeks, repeated sections, duplicates, stale observations, device loss, reload continuity, completion, and data validation.

## Files changed

- `app/lib/engagement.ts` — event/session types, canonical identity helper, validators, constants, and pure consumption accumulator.
- `app/lib/engagement-storage.ts` — account-scoped durable event/session repository.
- `tests/engagement.test.mjs` — seven focused unit tests.
- `scripts/engagement-storage-smoke.cjs` — standalone browser test with real IndexedDB.
- `docs/discovery-system.md` — implementation decisions and remaining boundary appended after the preserved spec.
- `docs/discovery-progress.md` — this handoff.

No existing application module imports the new code. No UI, player, library database, authentication, imports, cloud sync, or deployment behavior changed. No dependency added.

## Implementation decisions

- **Storage:** `record-cabinet-engagement:<hashed-account-id>`, schema version 1, stores `events` and `sessions`. This revises Milestone 0's proposed shared-library upgrade: a separate database avoids upgrading/blocking the active library and keeps future history deletion distinct from album deletion. Still uses native IndexedDB; no new infrastructure. The database opens only when the new repository is called.
- **Identity:** authenticated 64-character lowercase account hashes only; guest/default scopes reject. The album helper excludes demo/manual/pending playback and canonicalizes resolved Spotify album URIs. This is NOT evidence of saved-library membership.
- **Consumption:** `listenedSeconds` accumulates verified progression, including replays. `covered` stores merged unique intervals; its fraction of the frozen session duration determines completion. Replaying one section does not make an album complete. No credit for seek jumps, unmatched albums, unknown/nonpositive durations, paused intervals, or gaps longer than 30 seconds.
- **Duration denominator:** the adapter must supply the available/playable album duration and freeze it for the session. The model persists that denominator. This matches the existing `albumDuration` helper, which excludes unavailable tracks.
- **Clocks:** monotonic observation times are transient; event/update timestamps are epoch milliseconds. Reload preserves saved totals but resets observation continuity, so offline downtime is not counted. The last durable checkpoint is recoverable; no claim of lossless crash/unload capture.
- **Session persistence:** stable session ID; one derived start event and at most one completion event. Paused sessions can resume under the same ID; ended sessions are immutable. New sessions must be created only after confirmed matching playback. The repository cannot prove whether the caller actually heard audio.
- **Collection remains disabled:** no adapters, polling, listeners, background writes, or runtime imports exist yet. Retention/ownership/privacy decisions must be resolved before enabling collection.

## Tests/checks run

- `npm run lint` — PASS (an initial browser-script variable-name lint error was fixed before the final run).
- `npm test` — PASS: 222 tests, 0 failures (215 existing + 7 engagement tests).
- `npm run build -- --webpack` — PASS, including TypeScript validation and production page generation.
- `PLAYWRIGHT_MODULE=/private/tmp/rc-browser/node_modules/playwright node scripts/engagement-storage-smoke.cjs` — PASS with real Chrome IndexedDB: account isolation, idempotent/concurrent writes, stale checkpoint protection, transactional rollback after an injected write failure, metadata exclusion, and recovery after reload.
- `git diff --check` — PASS.
- Import/scope inspection — the new modules reference only each other and a type-only Album import; no live app consumers. Existing database/player/UI behavior remains unchanged.
- No live Spotify requests, cloud data writes, deployment, or push performed.

## Known issues / remaining Milestone 1 work

1. **Inspection adapter missing:** unify pointer/keyboard deliberate selection, assign an interaction ID, and emit once when the sleeve reaches the back. Exclude automatic restore/Continue digging, rerenders, and duplicate animation callbacks. Define pending export identity handling; do not silently drop required inspection cases without documenting the tradeoff.
2. **Playback adapter missing:** start sessions only on confirmed, matching SDK playback; connect seek/pause/error/device-loss/end/switch boundaries to the accumulator. Keep ownership across records/settings navigation and avoid duplicate starts on resume or reconnect. Handle demo switching explicitly.
3. **Checkpoints missing:** the 15-second interval is a constant only. Add SDK-state reconciliation/flush/retry scheduling without new Web API polling. App termination, browser suspension, and uncertain state must not add speculative time. Bound write retries and expose failures through a minimal appropriate existing diagnostics path.
4. **Multiple contexts:** persistence protects duplicate IDs and stale revisions, but does not yet prevent two tabs/devices creating separate sessions for the same playback. Establish ownership/lease or an equivalent conservative policy before enabling collection. Current tests cover concurrent storage calls, not actual multi-tab playback.
5. **Retention and deletion:** define bounded data retention before runtime use. The new database has no automatic pruning. Existing account-clear tools do not yet clear this separate database; integrate their existing deletion semantics within Milestone 1 as necessary. Dedicated export/reset UI is Milestone 2 and has not been started.
6. **Recovery:** saved sessions can be loaded and passed to the accumulator with continuity reset, but no runtime resume/abandon policy is wired. Same-revision divergence throws rather than merging conflicting owners; callers must handle it.
7. **Provider/privacy readiness:** collection remains disconnected. Review applicable provider requirements and document visibility/collection enablement before releasing any behavioral collection. No policy approval inferred.
8. **Saved-only eligibility and cloud sync:** prior findings remain. Playlist/liked imports are not authoritative saved membership; none of the new history is cloud-synced. Future reset propagation must not resurrect old device history.
9. **Personal organization signals:** no bin-action event instrumentation yet. Preserve explicit user intent rather than interpreting hydration/cloud updates as actions. Decide its Milestone 1 scope against the core acceptance list before expanding work.

## Not yet implemented

Milestone 1 acceptance is NOT met: real inspections/play starts are not persisted automatically, listening is not collected during app playback, and the 75% event is only verified in isolated module tests. No production behavior is enabled.

Milestones 2–8 remain untouched: data controls, generated bins, saved-membership reconciliation, scoring/assignment, organizational feedback, diagnostics/evaluation, and polish.

## Exact next step

On the next authorized session, read both documents and inspect Git status, then **continue Milestone 1**:

1. Resolve runtime session ownership, retention, canonical inspection identity, and deletion scope; use the tested foundation without claiming it already instruments the UI.
2. Wire deliberate inspection and confirmed Spotify playback with per-interaction/per-session guards. Add real IndexedDB browser assertions for pointer/keyboard inspection, failed playback, pause/resume, seek, album switch, navigation, reload, account change, and demo exclusion.
3. Add periodic bounded checkpoints, recoverable writes, and lifecycle cleanup; never use transport end latches as evidence of 75% consumption.
4. Run tests/lint/typecheck/build and existing player/navigation/gesture checks; update this document. Only mark Milestone 1 complete when all its acceptance criteria are exercised. Commit and STOP; do not begin Milestone 2.

## Last known stable commit

- Last committed baseline before this sub-boundary: `9c09a4c` (`docs: complete discovery milestone 0 reconnaissance`); application baseline `4bbddf7`.
- The commit containing this handoff is titled `feat: add engagement storage and consumption foundation`. It is a partial Milestone 1 commit, not completed behavioral instrumentation. See `git log -1` for its hash.
