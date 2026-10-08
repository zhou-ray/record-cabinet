# Discovery system progress

## Current milestone

Milestone 0 — Repository Reconnaissance.

**Status:** Complete. STOPPED at Milestone 0. Milestone 1 is not authorized by the current request and has not begun.

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

- Read the supplied specification and inspected the clean starting Git state.
- Inspected authentication, imports, saved state, storage/sync, personal bins, sleeve selection, playback confirmation, and album-end handling.
- Preserved the specification verbatim and appended repository-specific adaptation notes.
- Identified event capture boundaries and duplication/seek/navigation hazards.
- Documented storage and identity proposals without introducing schemas or runtime code.
- Validated the unchanged application.

## Files changed

- `docs/discovery-system.md` — original specification plus repository adaptation.
- `docs/discovery-progress.md` — milestone status and handoff.

No application behavior, dependencies, database schema, provider requests, or UI changed. No deployment is needed for this documentation milestone.

## Tests/checks run

- `npm run build -- --webpack` — PASS, including Next.js TypeScript validation and production build.
- `npm run lint` — PASS.
- `npm test` — PASS, 215 tests, 0 failures.
- Git scope review — only the two discovery documents added.
- No new browser or live Spotify testing: this milestone changes documentation only.

## Open issues / known issues

1. **Saved-only eligibility:** playlist/Liked Songs/manual/export records coexist with saved imports. Known-ID suppression can skip a later saved-membership update, and unsaves are not reconciled. Add explicit membership verification before generated bins; do not discard existing cabinet records.
2. **Consumption semantics:** specify session boundaries, repeated-section accounting, unavailable-track duration denominator, stale/background state handling, crash-checkpoint limits, and multi-tab ownership. Seeking to 75% is not 75% consumed.
3. **Persistence scope:** initial local engagement storage will not automatically sync. Future event/session/reset merging must differ from the current additive library merge.
4. **Privacy/provider readiness:** define bounded retention, visibility, export/reset boundaries, and review current Spotify provider requirements before publicly enabling behavioral personalization. No policy approval is inferred from repository reconnaissance.
5. **Demo isolation:** mock/local demonstration interactions must not train a real-account profile, including when signed-in users choose the demo.
6. **Canonical identities:** pending export album IDs can resolve later; history needs an intentional identity migration rather than fragmentation or mistaken joins.

These are documented design issues for subsequent milestones, not runtime changes or blockers to completing reconnaissance.

## Not yet implemented

All Milestones 1–8: durable engagement events, playback-session summaries, 75% completion tracking, personalization export/reset, generated bins, eligibility reconciliation, scoring/assignment, feedback, evaluation, and polish. Existing troubleshooting diagnostics are not substitutes for these features.

## Exact next task

Wait for explicit authorization for **Milestone 1 only**. On resumption:

1. Read both discovery documents and inspect Git status.
2. Define engagement event/session types and centralized constants in a separable module; choose/document conservative consumption and session semantics before wiring UI.
3. Implement and test account-scoped durable event/session storage with a non-destructive IndexedDB upgrade, idempotent IDs, and demo exclusion.
4. Connect one guarded deliberate-inspection path and confirmed playback observations to a testable duration accumulator. Checkpoint consumed time and record completion once; do not implement scoring or generated bins.
5. Test duplicate renders/events, pause/resume, scrubbing, failures, navigation, account changes, persistence recovery, and the chosen completion threshold. Update this handoff, commit, and STOP after Milestone 1.

## Last known stable commit

- Application baseline, checked again during Milestone 0: `4bbddf7e045332b4cc892733a0ce0cb0e698eae1` (`Prepare Record Cabinet public beta`).
- The Milestone 0 documentation commit is the commit containing this file, titled `docs: complete discovery milestone 0 reconnaissance`. Application code remains at the baseline above.
