# Record Cabinet Discovery System

## 1. Project Goal

Extend the existing Spotify vinyl-library application with a lightweight personalization and discovery system while preserving the original product idea:

> Recreate the deliberate, tactile feeling of exploring a physical record collection while retaining the convenience of streaming.

The app should **not** become a conventional Spotify-style recommendation homepage, infinite feed, playlist manager, or search-first experience.

The user’s saved albums remain the core collection. The discovery system should help the user explore that finite, self-curated library in new ways.

---

# 2. Core Product Principles

These principles are requirements, not optional suggestions.

## Album-first

The application remains centered on albums.

Do not make playlists a core part of this system.

## Saved-library boundary

Generated discovery bins may contain only albums that the user has explicitly saved to their Spotify library.

Do not introduce outside albums in v1.

A future “record store” concept may support external discovery, but that is out of scope.

## Stable physical-library layer

Preserve the existing alphabetical browsing experience:

- sort by artist
- sort by album

These represent the stable physical collection.

Do not algorithmically reorder the main library.

## Generated bins are separate

Personalization should appear through dedicated generated bins rather than modifying the user's normal album organization.

## Deliberate over infinite

Generated bins should remain small and curated.

Target:

- approximately 20 albums per generated bin
- three generated bins in v1

## Algorithm stays mostly invisible

Do not display recommendation scores or technical ranking explanations to the user.

Short, slightly mysterious descriptive blurbs are appropriate.

## First-party behavior first

Personalization should rely primarily on behavior observed inside this application.

Spotify metadata can be used as a secondary signal.

Do not import the user's broader Spotify listening history for the core recommendation model in v1.

## Progressive personalization

The system must work with little or no user history.

Start with simple heuristics and gradually incorporate richer behavioral information as the user interacts with the app.

---

# 3. Generated Bins

Implement three fixed generated-bin types.

## 3.1 Forgotten Favorites

Purpose:

Surface albums that the user historically engaged with heavily inside the app but has not interacted with recently.

Example user-facing blurb:

> Records you used to reach for more often.

Important behavior:

- This bin may be empty or sparse for new users.
- Do not fabricate “favorites” without sufficient evidence.
- Historical plays and completions should matter strongly.
- Recent interactions should suppress an album from this bin.

Conceptually:

```text
ForgottenFavoriteScore
≈ historical engagement
× time since recent engagement
```

Do not lock into this exact formula until the event model is implemented.

---

## 3.2 Wander

Purpose:

Create a loose, exploratory path through the user's saved collection.

Example blurb:

> A loose path through the shelves.

Cold-start behavior:

Initially, Wander may be mostly randomized.

Apply simple diversity constraints so it does not become dominated by:

- one artist
- one obvious cluster
- recently overexposed albums

As behavioral history grows, Wander should gradually become personalized.

Long-term signals may include:

- album inspection behavior
- playback behavior
- completion behavior
- albums grouped together in personal bins
- light Spotify metadata

User behavior should remain more important than metadata.

---

## 3.3 Digging

Purpose:

Surface albums in the saved library that the user has spent little or no time with.

Example blurb:

> A few records that haven't had much time on the turntable.

This should work well even during cold start.

Strong signals include:

- zero inspections
- zero plays
- low listening duration
- no completions
- little recent interaction

Digging should be one of the simplest and most reliable initial bins.

---

# 4. Generated Bin Lifecycle

Generated bins are **stable snapshots**, not continuously changing feeds.

Default behavior:

- approximately 20 albums per bin
- persist for 7 days
- preserve album order during that period
- regenerate after expiration
- allow optional manual refresh later
- do not reshuffle every time the bin is opened

Persist enough information to reconstruct and debug each generated bin.

Recommended stored fields:

```text
generated_bin_id
user_id
bin_type
generated_at
expires_at
album_ids
album_order
scoring_version
```

For debugging, also retain enough internal information to determine why an album was selected.

This debug information does not need to be exposed in the UI.

---

# 5. Cross-bin Overlap

Avoid duplicate albums across generated bins whenever possible.

Preferred assignment flow:

1. Calculate each eligible album's score for each generated bin.
2. Determine its strongest bin fit.
3. Assign it primarily to that bin.
4. Exclude it from the other bins.
5. Permit duplication only if:
   - the secondary score exceeds a deliberately high threshold, and
   - excluding the album would meaningfully reduce bin quality.

In v1, prefer **no overlap** over sophisticated duplicate handling.

This logic should be implemented in a separable assignment layer rather than independently inside each bin generator.

---

# 6. Behavioral Instrumentation

Before building sophisticated recommendations, implement reliable first-party behavioral tracking.

The application currently does not have sufficient behavioral history, so this is the first major milestone.

Track these core interactions.

## Album inspect

Occurs when the user deliberately selects/pulls out an album and views its details or track list.

Example event:

```text
album_inspected
```

## Playback start

Occurs when album playback begins.

Example:

```text
album_play_started
```

## Listening duration

Track the amount of album playback actually consumed.

Do not create unnecessary high-frequency event spam if a simpler aggregation is sufficient.

Possible approaches:

- periodic checkpoints
- session-level accumulated duration
- final session duration on playback termination

Prefer the simplest reliable implementation.

## Album completion

An album does not need to play literally to the final millisecond.

Treat an album session as completed once the user has consumed approximately:

```text
>= 75% of total album duration
```

Keep the actual completion percentage/duration so this threshold can be changed later.

Example event:

```text
album_completed
```

## Personal-bin actions

Track relevant organizational actions such as:

```text
album_added_to_personal_bin
album_removed_from_personal_bin
album_moved_between_bins
```

## Generated-bin feedback

Later milestones should track:

```text
album_kept_in_generated_bin
album_removed_from_generated_bin
album_moved_from_generated_to_personal_bin
album_pinned_in_generated_bin
```

---

# 7. Behavioral Event Model

Create a clean, extensible model rather than adding one-off fields throughout components.

A possible conceptual schema:

```text
InteractionEvent
---------------
id
user_id
album_id
event_type
timestamp
session_id?
metadata?
```

Additional playback-session data may live separately if cleaner.

For example:

```text
AlbumPlaybackSession
--------------------
id
user_id
album_id
started_at
ended_at
listened_seconds
album_duration_seconds
completion_ratio
completed
```

Do not overengineer this prematurely.

Choose the simplest architecture consistent with the existing codebase.

---

# 8. Interest Model

The recommendation system should distinguish levels of user interest.

Conceptually:

```text
inspect < play < completion
```

Example starting weights:

```text
inspect = 1
play = 3
complete = 6
```

These values are placeholders.

Implement weights as configuration/constants rather than embedding magic numbers throughout the code.

Do not train a complex ML model in v1.

Start with interpretable scoring.

---

# 9. Personal Bins

The application already has a framework for user-created bins.

Preserve the existing model:

- users choose arbitrary names
- users decide which albums belong in them
- personal bins are persistent
- the system must never automatically reorganize a personal bin

Treat personal-bin membership as a strong but optional behavioral signal.

Important principle:

> User organization is ground truth; bin names are hints, not labels.

Do not assume that a bin named "Sunday" has a specific meaning.

Do not require NLP interpretation of user-created names in v1.

Instead, use album co-membership as useful information.

Example:

If albums A, B, and C repeatedly appear in the same personal bin, that provides evidence that the user considers them related.

This may later help Wander.

Users who never create personal bins must still receive a fully functioning discovery experience.

---

# 10. Generated-bin Feedback UX

Generated bins are system-curated, but users should have some organizational control.

Do not use generic recommendation UX such as:

- thumbs up
- thumbs down
- "more like this"

Prefer actions that fit the physical-library metaphor.

Candidate actions:

## Move

Move an album from a generated bin into one of the user's personal bins.

This should:

- remove it from the generated bin
- add it to the personal bin
- record a strong positive organizational signal

## Remove

Remove the album from this generated bin.

This should become negative feedback for that specific bin assignment.

Do not necessarily interpret it as global dislike of the album.

## Keep / Pin

Allow a user to preserve an album in the generated bin across the next refresh.

Implementation can initially support only one of these if necessary.

Prefer:

```text
Pin
```

if it is simpler and clearer.

Do not permit arbitrary manual reordering of generated-bin contents in v1.

Generated bins remain system-curated objects.

---

# 11. Personal-bin Destination Picker

Large libraries and many custom bins can become unwieldy.

Do not build a giant always-visible list.

When moving an album, use a lightweight destination picker.

Suggested ordering:

1. recently used personal bins
2. pinned/favorite personal bins if that concept exists
3. searchable complete list

Keep this interaction compact.

Do not redesign the entire bin-management system as part of the recommendation work unless necessary.

---

# 12. Cold Start

A new user may have:

- zero behavioral history
- zero personal bins
- many saved albums

The system must degrade gracefully.

## Forgotten Favorites

May be:

- empty
- very small

Display a natural empty state rather than manufacturing favorites.

Example:

> Keep listening and a few old favorites may find their way back here.

## Wander

Start with randomized saved albums.

Apply simple diversity constraints such as:

- artist caps
- avoid albums already used in other generated bins
- optionally avoid extremely recent repeats

As history accumulates, progressively replace randomness with behavioral ranking.

## Digging

Prioritize albums with:

- no interactions
- low interaction counts
- little or no listening history

This should be useful immediately.

---

# 13. Metadata

Spotify metadata may be used as a secondary source of context.

Examples could include:

- artist
- genre if available/reliable
- release year
- album type
- other existing Spotify metadata

Do not make the recommendation engine primarily metadata-driven.

Conceptually target something like:

```text
70-80% user behavior
20-30% metadata/context
```

Do not hardcode these exact percentages unless useful.

As user history becomes richer, metadata influence should be allowed to decrease.

---

# 14. Privacy and Data Ownership

This system will collect behavioral information, so implement basic privacy hygiene.

Do not attempt enterprise-scale compliance architecture.

Follow these principles.

## Data minimization

Track only information necessary for:

- personalization
- product behavior
- evaluation/debugging

Do not create unnecessary detailed tracking.

## Credential separation

Spotify OAuth tokens and refresh tokens must not be stored in recommendation/event tables.

Never log tokens to:

- analytics
- debugging output
- client console
- recommendation records

Use the application's existing secure token-storage pattern.

## User visibility

Provide a brief description somewhere appropriate indicating that the app uses in-app browsing/listening behavior to personalize generated bins.

Avoid legalistic or intrusive wording.

## Download My Data

Implement a user data export.

Prefer JSON initially.

Include relevant user-owned information such as:

```text
saved album references used by the app
interaction events
playback-session summaries
personal-bin membership
generated-bin history
generated-bin feedback
timestamps
```

Do not export secrets/tokens.

## Reset Personalization History

Provide a way to clear behavioral personalization data.

Resetting personalization should not delete:

- Spotify saved albums
- user-created bins unless intentionally chosen
- account authentication information

Exact behavior should be documented.

A future full account deletion feature may be added separately.

---

# 15. Evaluation

This should be a real data-system project, not only recommendation UI.

Build internal evaluation/diagnostic tools.

Initial useful metrics:

## Coverage

What fraction of the saved library appears in generated bins over time?

## Diversity

How concentrated is a bin by artist or other available metadata?

## Repeat rate

How often are the same albums regenerated?

## Exploration rate

How much of the generated set consists of albums with little prior engagement?

## Bin overlap

How many albums appear in multiple generated bins?

Target should be near zero.

## Interaction outcomes

Eventually track whether generated albums are:

- inspected
- played
- completed
- moved into personal bins
- removed

Do not optimize solely for clicks or plays.

The product goal is exploration, not engagement maximization.

---

# 16. Internal Explainability

For development/debugging, each generated album should have internal reasoning information.

Example:

```text
album_id
bin_type
final_score
behavior_score
novelty_score
recency_score
metadata_score
assignment_reason
```

The exact fields may vary.

This is for:

- tuning
- testing
- evaluation
- explaining unexpected assignments during development

Do not expose raw scores in the production UI.

---

# 17. UI Requirements

Preserve the current record-cabinet visual metaphor and browsing behavior.

Generated bins should look like native parts of the cabinet.

Do not redesign the main interface unless necessary.

Possible ordering:

```text
Generated / discovery bins
--------------------------
Forgotten Favorites
Wander
Digging

Library
-------
Alphabetical by Artist
Alphabetical by Album
Personal Bins
```

Adapt this to the current UI architecture rather than forcing this exact layout.

Each generated bin should include its short blurb.

Do not add:

- ranking percentages
- recommendation confidence
- technical model details
- endless scrolling
- external album recommendations

---

# 18. Architecture Guidance

Before editing code:

1. Inspect the current Next.js / React architecture.
2. Identify:
   - Spotify data-fetching layer
   - authentication layer
   - playback state
   - album detail / track-list interaction
   - saved-library representation
   - personal-bin implementation
   - persistence mechanism
3. Determine where behavioral events and generated-bin logic fit cleanly.
4. Prefer separable services/modules over embedding scoring logic directly into UI components.

Recommended conceptual separation:

```text
UI
↓
bin/discovery service
↓
scoring + assignment
↓
behavior aggregates / saved-library data
↓
event storage
```

Do not introduce unnecessary infrastructure purely for architectural purity.

Reuse the current stack wherever reasonable.

---

# 19. Milestone Execution Strategy

IMPORTANT: This project must be implemented incrementally because Codex usage may stop unexpectedly.

Complete **one milestone at a time**.

Do not begin the next milestone unless explicitly instructed.

Every milestone must leave the application in a working state.

---

# Milestone 0 — Repository Reconnaissance

Do not modify application behavior yet.

Tasks:

1. Inspect the project architecture.
2. Identify relevant files/components/services.
3. Determine existing persistence/storage approach.
4. Inspect Spotify authentication and playback integration.
5. Inspect saved-album state.
6. Inspect personal-bin implementation.
7. Identify where inspect/play/completion events can be captured.

Create or update:

```text
docs/discovery-system.md
docs/discovery-progress.md
```

`discovery-system.md` should contain this specification or a faithful project-specific adaptation.

`discovery-progress.md` should contain:

```text
Current milestone
Architecture findings
Relevant files
Completed work
Open issues
Tests/checks run
Exact next task
```

Do not implement recommendation logic during Milestone 0.

Acceptance criteria:

- architecture is documented
- key integration points identified
- no unnecessary application changes
- typecheck/build still passes

---

# Milestone 1 — Behavioral Instrumentation

Goal:

Create reliable first-party behavior data.

Implement:

- album inspected
- album play started
- album listening duration
- album completion around 75%
- timestamps
- user association
- persistence

Do not build generated-bin scoring yet.

Prefer aggregated playback/session tracking over extremely high-frequency logging.

Acceptance criteria:

- inspecting an album produces the correct persisted behavior
- starting playback is tracked
- listening duration can be recovered
- crossing completion threshold is recorded once correctly
- repeated renders do not duplicate events
- typecheck/tests/build pass

At completion:

- update `docs/discovery-progress.md`
- create a clean commit if repository workflow permits

Suggested commit:

```text
feat: add album engagement tracking
```

STOP after this milestone.

---

# Milestone 2 — Privacy Controls and Data Export

Implement:

- Download My Data
- Reset Personalization History

Do not expose Spotify tokens or credentials.

Define exactly what reset deletes.

Add minimal user-facing privacy copy.

Acceptance criteria:

- user can export behavioral data in JSON
- exported data is human-readable
- secrets are excluded
- reset clears personalization history
- saved Spotify library remains unaffected
- personal bins remain unless explicitly designed otherwise
- app remains functional after reset
- tests/typecheck/build pass

Suggested commit:

```text
feat: add personalization data controls
```

STOP.

---

# Milestone 3 — Generated-bin Framework

Implement the structural framework for:

- Forgotten Favorites
- Wander
- Digging

Requirements:

- ~20 albums maximum
- persisted generated snapshots
- generated timestamp
- 7-day expiry
- stable order during snapshot lifetime
- near-zero overlap
- short bin blurbs

Use simple heuristics only.

Do not build complex behavioral scoring yet.

Acceptance criteria:

- all three bins render
- contents persist across reloads
- bins do not regenerate every visit
- expired bins can regenerate
- cross-bin duplication is minimal/zero
- main alphabetical library remains unchanged
- tests/typecheck/build pass

Suggested commit:

```text
feat: add persistent discovery bins
```

STOP.

---

# Milestone 4 — Cold-start Heuristics

Implement initial selection behavior.

## Forgotten Favorites

Sparse or empty when insufficient history exists.

## Wander

Randomized saved-library sampling with simple diversity constraints.

## Digging

Prioritize albums with little/no interaction history.

Do not introduce learned models.

Acceptance criteria:

- new user receives useful Wander and Digging bins
- Forgotten Favorites behaves honestly with sparse history
- same artist does not dominate Wander where avoidable
- albums remain saved-library-only
- tests/typecheck/build pass

Suggested commit:

```text
feat: add discovery cold-start heuristics
```

STOP.

---

# Milestone 5 — Behavioral Scoring

Introduce configurable scoring using first-party behavior.

Use:

- inspections
- play starts
- listening duration
- completions
- interaction recency
- interaction frequency

Incorporate personal-bin membership if available.

Metadata may serve as a secondary signal.

Keep scoring interpretable.

Do not introduce a neural recommender or heavyweight ML system.

Acceptance criteria:

- Forgotten Favorites responds meaningfully to historical engagement + recency
- Wander changes from mostly random toward behavior-informed selection
- Digging continues to favor underexplored albums
- users without personal bins are fully supported
- scoring parameters are configurable
- internal reasons/scores are inspectable during development
- tests/typecheck/build pass

Suggested commit:

```text
feat: personalize discovery bins from behavior
```

STOP.

---

# Milestone 6 — Organizational Feedback

Add generated-bin interactions.

Prioritize:

- Move to personal bin
- Remove from generated bin
- Pin / Keep if practical

Feed these actions into future generation.

Rules:

- moving to a personal bin = strong positive organization signal
- removing from a generated bin = negative signal for that bin
- do not treat removal as global album dislike
- personal bins remain user-controlled

Acceptance criteria:

- movement between generated and personal bins works reliably
- large personal-bin lists remain usable
- feedback persists
- next generated snapshot incorporates feedback
- tests/typecheck/build pass

Suggested commit:

```text
feat: add discovery bin feedback controls
```

STOP.

---

# Milestone 7 — Evaluation and Diagnostics

Build internal metrics/reporting.

At minimum calculate:

- coverage
- diversity
- repeat rate
- generated-bin overlap
- underexplored-album rate
- subsequent inspect/play/complete rates

Create a development-facing diagnostics surface or script.

Do not turn this into a user-facing analytics dashboard unless explicitly requested.

Acceptance criteria:

- metrics can be generated from stored data
- baseline comparison is possible
- random/cold-start behavior can be compared with behavioral scoring
- unexpected recommendations can be debugged
- tests/typecheck/build pass

Suggested commit:

```text
feat: add discovery evaluation metrics
```

STOP.

---

# Milestone 8 — Product Polish

Only after all earlier milestones are stable.

Potential tasks:

- tune weighting
- improve empty states
- refine blurbs
- refine destination picker
- smooth refresh behavior
- preserve partial continuity between weekly snapshots
- fix edge cases
- improve loading states

Do not broaden scope into:

- external recommendations
- playlists
- record store
- NLP bin-name interpretation
- complex ML

unless explicitly requested.

---

# 20. Usage-Limit / Handoff Protocol

This section is mandatory.

Codex should assume that work may be interrupted at any point.

Before starting a milestone:

1. Read:
   - `docs/discovery-system.md`
   - `docs/discovery-progress.md`
2. Inspect git status.
3. Understand the last stable state.
4. Work only on the current milestone.

Before ending a work session:

1. Stop at the nearest stable boundary.
2. Do not leave unrelated half-implemented features.
3. Run the most relevant checks available, such as:
   - tests
   - typecheck
   - lint
   - build
4. Update `docs/discovery-progress.md`.

The progress document must state:

```text
Current milestone:
Status:
Completed:
Files changed:
Tests/checks run:
Known issues:
Not yet implemented:
Exact next step:
Last known stable commit:
```

If the milestone is complete, commit it if the repository workflow allows.

If the milestone is incomplete:

- clearly mark it incomplete
- document what remains
- do not pretend it is finished
- leave the repository in the safest possible state

When a new Codex session begins, continue from the progress document rather than reconstructing the entire project from chat history.

---

# 21. General Coding Constraints

- Preserve existing application behavior unless the spec requires a change.
- Prefer small, testable changes.
- Reuse existing architecture where sensible.
- Do not rewrite large areas of the app just to implement this feature.
- Avoid unnecessary dependencies.
- Avoid premature ML complexity.
- Keep recommendation logic separate from presentation components.
- Keep scoring configuration centralized.
- Handle missing user history gracefully.
- Never log authentication secrets.
- Do not silently broaden product scope.

---

# 22. Definition of v1 Success

The implementation is successful when:

1. The app still feels like browsing a personal record cabinet.
2. The main library remains stable and self-curated.
3. Three small generated bins help users rediscover saved albums.
4. Recommendations become more personal as the user interacts with the app.
5. New users still get useful exploration without imported Spotify history.
6. User-created organization contributes optional high-quality preference signals.
7. Generated bins remain stable for approximately a week.
8. Users can organize albums out of generated bins naturally.
9. Users can download and reset their personalization history.
10. The system can be evaluated and debugged quantitatively.
11. The implementation remains understandable enough to explain clearly in a technical interview.

The goal is not to maximize engagement.

The goal is to create a more thoughtful way to explore a collection the user deliberately chose to own.

---

# Repository adaptation — Milestone 0

The specification above is preserved verbatim. The findings below describe the repository at `4bbddf7e045332b4cc892733a0ce0cb0e698eae1`; proposed modules are not implemented. Milestone 0 changes documentation only. Do not start Milestone 1 without explicit authorization.

## Existing architecture and relevant files

| Area | Current implementation | Integration boundary |
| --- | --- | --- |
| App lifetime | `app/(cabinet)/layout.tsx` mounts `AccountProvider` and `LibraryScreen`; page components are route placeholders | Keep instrumentation mounted across shelf/settings navigation without remounting playback |
| View and imports | `app/library-screen.tsx` holds collection/import state and keeps `RecordBin` mounted while settings is visible | Do not interpret view visibility, restored data, or background imports as user interest |
| Catalog model | `app/data/types.ts` defines Album, Track, PlaybackSource; `app/catalog.ts` defines Bin, CustomSystem, and deterministic shelf grouping | Add discovery as a separate collection of snapshots; never reorder normal artist/album shelves |
| Provider access | `app/data/spotify.ts`, `app/api/spotify/library/route.ts`, `app/lib/spotify-requests.ts`, `app/lib/spotify-shared-gate.ts` | Existing paginated imports, known-ID suppression, source checkpoints, and shared pacing should remain intact |
| Authentication | `app/api/spotify/login/route.ts`, `app/api/spotify/callback/route.ts`, `app/lib/spotify-session.ts` | PKCE with state verification; AES-GCM-sealed HttpOnly cookies contain credentials; account scope derives from SHA-256 of Spotify profile ID |
| Account isolation | `app/account-context.tsx` | `useAccount()` provides accountId, scoped storage, organizationKey, and account-header API fetch; changed accounts lock the current view |
| Sleeve interaction | `app/record-bin.tsx`: pointer/keyboard selection, `finishLift`, `loadSleeveTracks`, return animation | Capture deliberate selection once; metadata fetch success is not required for an inspection |
| Local audio | `app/use-player.ts` | HTMLAudioElement playing/pause/ended/time updates; demo signals must not influence a real account |
| Spotify audio | `app/use-spotify-player.ts`, `app/lib/spotify-browser.ts` | `observe` receives SDK state; confirmed matching playback is stronger evidence than a play-button click or successful command |
| Player UI | `app/spotify-player.tsx`, `app/expanded-player.tsx`, `app/turntable-deck.tsx`, `app/use-system-player.ts` | Render/display and system controls are consumers, not independent sources of behavioral events |
| Album timeline | `app/lib/album-timeline.ts`, `app/lib/album-stop.ts` | Timeline excludes unavailable tracks; current end guard stops autoplay, not a 75%-listened completion detector |
| Personal organization | `app/bin-organizer.tsx`, `app/lib/bin-organization.ts`, `app/record-bin.tsx` | `fileAlbums`, FilingDesk, AlbumFiling and organization save callbacks cover explicit assignment changes |
| Local persistence | `app/lib/library-storage.ts` | IndexedDB v1: albums keyed by ID and settings; imported album/checkpoint saves are atomic |
| Cloud persistence | `app/cloud-library-sync.tsx`, `app/lib/cloud-library.ts`, `app/lib/cloud-store.ts`, `app/api/library/sync/route.ts` | Account-keyed Redis REST snapshots, revision-checked Lua writes, three-way client merge; currently albums + organization only |
| Backup/privacy | `app/collection-backup.tsx`, `app/lib/collection-backup.ts`, `app/account-tools.tsx`, `app/privacy/page.tsx` | Current backup is not the future complete personalization export; existing clear/delete actions are broader than personalization reset |
| Diagnostics | `app/lib/beta-diagnostics.ts`, `app/beta-tools.tsx` | Bounded in-memory troubleshooting timeline and opt-in report; not durable behavioral history and intentionally lacks album identities |
| Verification | `tests/*.test.mjs`, `scripts/*-smoke.cjs`, `.github/workflows/checks.yml` | Pure Node/TypeScript-transpilation tests, fake IndexedDB coverage, and manual desktop/mobile browser scripts with mocked Spotify |

## Persistence findings

`createLibraryStorage(accountId)` opens `record-cabinet-library:<accountId>` (the legacy unscoped helper still exists). Personal systems are stored separately in localStorage under `record-cabinet-systems:<accountId>`. Digging bookmarks use account-scoped keys and distinguish demo/library. Local-change events trigger cloud synchronization. API usage counters intentionally avoid these notifications.

Cloud payloads contain only normalized albums and organization. Behavior, sessions, discovery snapshots, feedback, and reset markers do not exist. Adding local data alone will not synchronize it. Avoid emitting library-sync notifications for every listening checkpoint. No new database service is needed for initial instrumentation.

Proposed Milestone 1 storage: a small dedicated engagement module using the existing account-scoped IndexedDB, with explicit event and playback-session stores plus version-aware upgrade checks. Preserve existing albums/settings on upgrade, handle older tabs, and test transaction failure. This is a recommendation, not an implemented migration. Start with local persistence; document device-local behavior honestly until a deliberate merge/sync design is implemented. Unique event/session IDs and idempotent updates should permit future sync without double counting. Never put credentials into these stores.

## Saved-library eligibility: unresolved requirement

The cabinet collection is broader than Spotify's saved-album library. `Album.source === "spotify"` identifies the provider, not saved membership. `importOrigin.source` may be `saved`, `liked`, or `playlist:<id>`. There are also manual records, Spotify-link additions, and export records, including unresolved album identities.

`importOrigin` records one provenance, not an authoritative membership history. In `createSpotifyLibrary`, known album IDs are skipped before constructing an album/provenance update. Consequently, a playlist-imported album encountered later during a saved-albums import may still lack saved provenance. An old saved import also does not prove the user has not subsequently unsaved it. Cloud merge is additive and does not reconcile Spotify removals. `addedAt` means addition to this app, not necessarily the Spotify saved date.

Before Milestone 3/4, define an explicit saved-membership record with verification/source/time and unknown/removed handling. Reconcile membership without re-fetching known album details or deleting cabinet records. Exclude unknown, playlist-only, liked-only, manual, and demo albums from discovery eligibility unless saved membership is independently confirmed. Define how snapshots handle unsaved albums (filter invalid members while preserving remaining order). Do not silently broaden eligibility to the whole cabinet. No membership requests or changes are made in Milestone 0.

## Event capture design for the next milestone

### Inspection

Both pointer and keyboard handlers set the selected sleeve to lifting. `finishLift` transitions to the back and calls `loadSleeveTracks`. Introduce one deliberate-selection operation shared by these handlers; associate an interaction ID with the opening and record once when it reaches the back. Do not put logging into render, per-sleeve animation callbacks without a guard, metadata loaders, or a generic `pulled` effect. Continue-digging restoration and reduced-motion callbacks can otherwise create duplicate or synthetic inspections. Decide/document whether automatic restoration counts; recommended default: no.

### Play start

`playAlbum()` requests provider setup and may fail. Spotify `start()` and command acknowledgments may precede audible playback; `observe()` and the browser SDK provide actual state. Record one start per album session when playing is confirmed and the current track maps to the selected album. Resuming the same paused session should not add another start. Ignore unmatched tracks, duplicate SDK events, optimistic control states, buffering, failed commands, and external playback not attributable to this app session. Keep local/demo sessions separate or excluded.

### Listening and completion

Do not derive consumed time from maximum tonearm position, `elapsed`, wall time since first play, or the existing `ended`/`completed` transport latches. Seeking directly near the end is not completion. Use one small testable accumulator with confirmed-playing intervals, monotonic elapsed time, bounded periodic durable checkpoints, and flushes on pause, switch, end, or lifecycle transition. Resume from persisted checkpoints; crash recovery can only guarantee the last successful checkpoint, not unload delivery.

Reconcile progress with confirmed provider state; discard seek jumps and uncertain/stale gaps, stop accumulating on pause/device loss, and avoid overcounting suspended background tabs. Preserve state when ordinary route navigation occurs. Multiple tabs/devices need explicit session ownership/deduplication rather than summing optimistic clocks. Avoid new high-frequency Web API polling.

Persist listened seconds and the session's duration denominator, plus completion ratio and a once-only completion marker at the configurable 0.75 threshold. Current `albumDuration()` excludes unplayable tracks: decide whether completion means available duration or full printed duration and retain the chosen denominator for audit. Decide how replayed sections contribute; if unique coverage is desired, use interval unions rather than silently treating total repeated seconds as unique album consumption. Zero/unknown durations cannot qualify. The transport end guard must remain independent.

### Personal-bin actions

A `CustomSystem` contains arbitrary named bins and an `assignments: Record<albumId, binId>` map. An album can occupy one bin per system, and can be organized differently across systems. Current UI caps each system at five bins. Preserve that model. `fileAlbums` is a pure transformation; compare prior/next assignments at explicit successful user-save boundaries for add/remove/move events. Bulk filing, album-back filing, and bin deletion need coverage. Renaming/reordering, cloud restore, backup restore, and initial hydration must not fabricate organization actions. Record system/bin IDs rather than inferring meaning from labels. Storage failures should not be reported as persisted success.

## Proposed separation (not implemented)

- Engagement types/configuration and pure session accumulator under `app/lib/`.
- Account-scoped event/session repository; thin capture adapters at deliberate inspection and confirmed playback boundaries.
- Discovery scoring, eligibility, overlap assignment, snapshot persistence, and diagnostics in separate modules in later milestones.
- UI receives resolved ordered album IDs and blurbs; it does not own scoring.
- Milestone 3 supplies snapshot/assignment scaffolding only; Milestone 4 tunes cold-start selection; Milestone 5 adds behavioral scoring. No recommendation implementation belongs in Milestone 0 or 1.

## Future checks and open decisions

- Before enabling collection, review current Spotify developer terms for the proposed profiling/evaluation use; repository inspection alone does not establish provider approval. No legal/policy conclusion is made here.
- Milestone 1 precedes privacy-controls Milestone 2: keep initial behavior collection local and avoid publicly enabling new collection without the appropriate visibility/reset/export decisions.
- Specify retention/bounded history, concurrent-session handling, canonical IDs for hydrated exports, unavailable-track denominator, and reset semantics before relying on aggregates.
- Future synchronization must not resurrect reset history from another device; current additive album merge is inappropriate for this data.
- Reserve generated-bin feedback fields/types for later milestones, without collecting unused metadata now.
- No production-provider calls are required for Milestone 0 acceptance. Automated coverage cannot establish native background playback behavior.


## Milestone 1 foundation decision record (partial)

The first implementation boundary adds `app/lib/engagement.ts` and `app/lib/engagement-storage.ts`, with unit and real-IndexedDB browser checks. They are not imported by the live app. Milestone 1 remains incomplete; use `discovery-progress.md` as the authoritative handoff.

Use a separate native IndexedDB database `record-cabinet-engagement:<accountHash>` (v1, events/sessions stores), instead of the previously proposed upgrade to the live library database. This isolates history transactions and future deletion from existing albums/settings. It requires integration with account deletion before runtime collection; it does not automatically participate in library backup or cloud sync.

Completion uses unique verified coverage / frozen available album duration, with total consumed seconds retained separately. Pauses and repeated sections do not inflate unique coverage. Monotonic observation intervals over 30 seconds, seek jumps, unmatched observations, and explicit continuity interruptions earn no consumption credit. Reload recovers saved totals but not an unobserved time interval. The adapter must start only after confirmed playback, interrupt on seeking/uncertainty, and supply observations plus bounded periodic checkpoints. A configured 15-second checkpoint interval has no runtime scheduler yet.

Storage performs atomic session/event commits, whitelists fields, rejects account mismatches, deduplicates stable IDs, and prevents stale checkpoint regression. These safeguards do not constitute a multi-tab playback ownership protocol or a retention policy; both remain required before enabling instrumentation. No raw SDK payloads, OAuth credentials, recommendation scoring, discovery UI, export/reset controls, or collection-enable flag were added at this boundary.


## Milestone 1 integration decision record

Instrumentation is connected behind the explicit build-time `NEXT_PUBLIC_ENGAGEMENT_ENABLED=true` switch (default false). Deliberate sleeve opening records one canonical inspection; unresolved export identity is deferred to successful details hydration. Confirmed SDK state, not optimistic UI, feeds the accumulator. SDK-local state is sampled at the shared 15-second checkpoint interval, without Web API polling.

The runtime coordinator uses an account/origin Web Lock to avoid competing playback owners in tabs, bounded retry queues, and conservative interruption at seeks/errors/visibility changes. It retains a session through pause/resume and settings navigation. Reload preserves saved summaries without crediting downtime; a new explicit play starts a new session. Demo/manual/guest activity is excluded. Unsupported Web Locks suppress playback collection rather than risking duplicates.

History remains local. Retention runs on activation/hourly (one year; up to 10,000 events and 2,000 sessions at maintenance). Existing account removal includes history and drains active writes; dedicated history-only reset/export is reserved for Milestone 2. Enabled test builds explain local collection. Public activation/provider review is not part of this rollout and the production flag remains off.

See the current progress document for verified behavior and limitations, particularly conservative undercounting, canonical identity failures, retention boundaries, saved-membership eligibility, and lack of cross-device tracking synchronization.


## Milestone 2 export decision record (partial, 2026-10-14)

Download My Data is a separate version-1 `record-cabinet-personalization` JSON export, not the existing restorable `record-cabinet` collection backup. It reads this account's committed local history, album references and personal-bin memberships without provider/cloud requests, stopping playback or changing history. Event and session timestamps are UTC ISO strings; listening/coverage units are seconds. Unknown album-added/bin-created/membership-assigned times are null, never inferred from export time. Generated-bin history/feedback explicitly remain unimplemented. Account hashes, credentials, arbitrary metadata and raw player payloads are not exported. Fields are explicitly selected and mixed-account/malformed history fails closed.

Export is available with tracking enabled or disabled. It may omit pending/failed writes and unsaved current listening; independent local stores are not a globally atomic snapshot. The privacy UI states these limits and distinguishes it from Collection backup. No history-only reset or cross-tab reset fence has been added at this checkpoint. Milestone 2 remains incomplete; continue with reset according to discovery-progress.md and do not begin Milestone 3.


## Milestone 2 reset decision record (2026-10-15)

Milestone 2 is complete. Reset Personalization History deletes the current account’s device-local inspections, playback events and session summaries, discards pending tracking/debug state, and leaves albums, personal bins, genres, import progress, cloud copies, auth and audio intact. It does not delete previously downloaded files or data on other devices. A confirmation explains this scope.

Engagement IndexedDB schema v2 adds a generation marker. Reset advances it and clears both behavioral stores atomically. Writers capture the generation before collecting and compare it in their write transaction; late retries and suspended tabs cannot repopulate old history. Migration preserves rows, blocked upgrades report failure without later executing the reset, and legacy schema-v1 opens fail after upgrade. BroadcastChannel/local notifications accelerate tracker/UI invalidation; focus and periodic checks recover missed messages. Reset does not wait for playback ownership. Deferred sleeve inspections capture their original tracker.

Audio continues after reset, but its old tracking session is discarded. New inspections are accepted; explicit play/resume starts fresh listening history. Export/debug reads invalidate stale snapshots. Controls remain available with collection disabled; production collection remains default-off pending release review. See discovery-progress.md for tests and the Milestone 3 stopping boundary.


## Milestone 3 eligibility decision record (partial, 2026-10-16)

Added an explicit saved-membership prerequisite, separate from Album.source/importOrigin and from behavioral history. The supported [Check User's Saved Items endpoint](https://developer.spotify.com/documentation/web-api/reference/check-library-contains) accepts at most 40 URIs; the legacy albums/contains endpoint is removed for current development-mode use. The existing authenticated library route now exposes this bounded read. It uses established request coordination and does not load album tracks or mutate Spotify.

Store successful observations per account locally with canonical album ID, saved boolean, fixed provider-check source and request-start timestamp. Eligibility uses positive observations younger than seven days, excludes unknown/expired/future observations and known negatives, and does not remove albums from the cabinet. Manual/demo/unresolved albums remain excluded; resolved Spotify exports can qualify if explicitly confirmed. Fresh negatives are cached too, avoiding repeated pulls. A slow earlier check cannot overwrite newer membership, and malformed/failed requests cannot imply removal. No UI automatically requests membership at this checkpoint.

This is a Milestone 3 sub-boundary, not a complete discovery feature. Next implement cancellation-safe client reconciliation and the three stable generated snapshots/UI. Filter known removals while preserving order; recheck stale membership before generating and keep an honest unavailable/partial state on failures. Include generated data in export/reset when added. Preserve alphabetical/custom organization and stop before Milestone 4 heuristic tuning. See discovery-progress.md for exact next steps and verification.


## Milestone 3 reconciliation decision record (partial, 2026-10-17)

An explicit coordinator now checks at most three 40-album batches per run through account-context fetch, persists each successful batch, and resumes by skipping fresh positive and negative observations. It performs no mount/browse requests and no automatic retries; timeout, cancellation, account disposal, malformed results and storage errors stop the run with partial progress preserved. The React adapter remains unmounted until discovery UI is implemented.

Membership writers capture a library-settings generation before fetching. Broad local deletion advances it atomically with clearing data; stale writers are rejected within their write transaction, independently of notifications. This marker contains no behavioral history. Personalization reset continues to preserve provider membership metadata. Cross-tab request ownership and actual UI lifecycle checks remain required before mounting. Generated snapshots, bins and their reset/export integration are still next within Milestone 3; no later heuristics have begun.


## Milestone 3 snapshot decision record (partial, 2026-10-17)

The `framework-1` snapshot stores three ordered bins (maximum 20 each), canonical album IDs, account scope and seven-day timestamps. The separable assignment layer accepts caller-provided ordered candidates, verifies saved membership and assigns round-robin without overlap. It does not infer favorites or implement recommendation scores. Rendering must use the eligibility-filtered view; exclusions do not refill or shuffle the persisted snapshot.

The latest snapshot lives in the engagement database's existing metadata store and shares its reset generation. First current snapshot wins atomically across tabs; expiry permits replacement, and old writers cannot restore reset state or replace newer snapshots. Reset deletes generated state with history, preserving library membership metadata and personal bins. Download My Data includes the latest snapshot only, with allowlisted fields and readable timestamps; there is no historical archive or feedback yet. This extends privacy controls without activating collection.

This checkpoint does not mount a generator or discovery UI. Next wire bounded membership refresh with cross-tab ownership, a simple candidate generator and native bins, then test the full lifecycle. Stay within Milestone 3; cold-start tuning and scoring remain later milestones.


## Milestone 3 completion decision record (2026-10-19)

Discover is a separate shelf view using existing cabinet rendering and playback. Preparation is explicit and bounded to 120 membership checks per action, with resumable progress, cancellation and account-scoped Web Locks. Browsing/reload/focus never invokes provider membership checks. Generation waits for current membership observations for local Spotify album references; only positives enter a snapshot. Existing alphabetical and personal organization is unchanged.

The baseline generator shuffles Wander candidates, uses records with no retained plays/completions for Digging, and requires two distinct retained completions plus 30 days without interaction for Forgotten Favorites. Shared round-robin assignment enforces 20 caps and zero overlap; `framework-1` identifies these simple rules. Artist/genre diversity, richer cold-start handling and weighted scoring remain Milestones 4–5. No collection-enable change was made.

Persisted sets are stable for seven days. An explicit prepare can replace an expired set; neither opening bins nor periodic local reads regenerates it. Current eligibility filters the displayed set without refill. Reset/removal invalidates pending work and retires open discovery views while playback stays mounted. Read reconciliation runs locally on focus and every 15 seconds; no server polling added. Export/reset integration from the snapshot checkpoint is preserved. Only the latest snapshot is retained, device-locally.

Milestone 3 is complete and tested locally; see discovery-progress.md for evidence and real-account testing limits. Stop before Milestone 4 and do not infer authorization to activate tracking or deploy.


## Milestone 4 cold-start decision record (2026-10-19)

New `cold-start-1` snapshots use randomized, primary-artist-balanced Wander sampling. Each pick prefers a less represented artist, with random ties; there is no hard cap that empties single-artist libraries. Provider artist IDs group primary credits, normalized names are the fallback, and unknown credits share a group. No new metadata requests are made.

Reserve enough non-completed candidates for a useful Digging bin (up to 20, at most half the remaining collection); Wander cannot consume that whole pool. After Wander selection, Digging orders unassigned candidates by ascending play count then inspection count, leaving random ties. This gives untouched records priority over inspected-only records and lightly played records, without duration/recency weights or learned models. Favorites retain the conservative two-distinct-completions/30-days-absent rule. Only the 20 selected favorites are excluded elsewhere; overflow remains available to Wander. All bins stay saved-only, capped and disjoint.

The snapshot validator supports both `framework-1` and `cold-start-1`. Current snapshots keep their saved identity and order; the new rules apply when an expired/reset set is explicitly prepared. Export/reset/storage semantics remain unchanged. History collection remains disabled by default; no later scoring or feedback milestone started. See discovery-progress.md for fixture and real-browser verification and limitations. Milestone 4 is complete locally; stop before Milestone 5.

## Explicit preparation and tutorial follow-up (2026-10-20)

User authorized these usability changes before Milestone 5. The mounted discovery controller now runs all remaining membership batches from one explicit action, pausing 1.5 seconds between sequential requests. It retains the account Web Lock for the entire run, saves each batch, skips fresh positive/negative checks, and stops on cancellation, timeout, provider errors or rate limiting. It never restarts on mount/focus or retries errors unattended. The low-level coordinator retains its bounded default for other consumers; the discovery adapter explicitly enables continuous pacing. This supersedes the earlier three-request-per-click UI limit, not the batch size or server safeguards.

A five-step cabinet tutorial replaces the first-listen checklist, using existing account-scoped guide dismissal storage. It covers bins, browsing/dividers, flipping/returning sleeves, tapping vinyl, and turntable controls. It is a nonmodal guide with Previous/Next, close, optional persistent dismissal and Settings replay. It does not start playback or create artificial inspections. Milestone 5 remains untouched.

## Milestone 5 scoring decision record (2026-10-21)

`discovery-scoring.ts` supplies deterministic, inspectable contributions with `DISCOVERY_WEIGHTS` defaults and per-call overrides. For each eligible album:

- Behavior = 0.5 × log2(1 + inspections capped at 20) + 2 × log2(1 + distinct starts capped at 10) + 4 × log2(1 + distinct completions capped at 5) + 3 × listened album-equivalents capped at 5. Each validated session contributes at most one equivalent (`listenedSeconds / albumDurationSeconds`), so repeat loops within a session do not dominate. Latest valid session revision wins; session start/completion IDs deduplicate against events.
- Recency = 0.5 raised to days since the last retained interaction / 14. Future/foreign/invalid observations are ignored. Session checkpoints use their last observation timestamp. No retained history means zero recency, not inferred dislike.
- A valid personal-bin assignment adds 3 once, regardless of systems/bins. Labels have no semantic meaning, and multiple assignments do not amplify it. Albums with no bins are fully supported. Organization does not invent listening/completion evidence.
- Forgotten eligibility still requires two distinct completions and at least 30 quiet days, now configurable. Rank eligible records by (behavior + organization) × (1 − recency).
- Wander ranks by log2(1 + behavior) + organization − 4 × recency, inside the existing least-represented-primary-artist selection pass. Artist variety stays a guardrail; random order breaks equal-score ties. Reserve space for Digging as before.
- Digging ranks noncompleted records by 1 / (1 + behavior) − recency. Untouched records lead; recent and frequently explored records sink. It does not penalize filing or fill with completed records simply to reach 20.

New explicitly prepared sets use `behavioral-1`; current `framework-1` and `cold-start-1` sets retain their saved identity/order. Both previous versions remain readable/exportable/resettable. No database schema change. Shared assignment still enforces saved-only eligibility, maximum 20 per bin and no overlaps. The cold-start generator path remains available for regression comparisons; the app explicitly opts into scoring. No-history/no-organization scores tie and preserve cold-start output for the same random sequence.

Development inspection: call exported `scoreDiscovery` directly or pass `inspect` to `generateDiscovery`; the preparation hook prints score rows only in development builds when generating a new snapshot. Rows include raw bounded contributions, recency, eligibility, personal-bin presence and each bin score. No public ranking controls, telemetry, persistent score cache or production console output. Configuration is code-level rather than music UI settings. Tracking stays disabled by default; only retained first-party history and current organization are used. No inferred Spotify history, new provider requests, neural model, feedback actions, personal-bin label interpretation or Milestone 6 work.

## Milestone 6 foundation decision record (2026-10-22)

Started only the durable feedback/generation sub-boundary. Account-scoped metadata stores the latest explicit remove/move decision per album and Discover-bin type (maximum 10,000 pairs; overflow fails explicitly). Decisions include source snapshot, timestamp and allowlisted move destination IDs. Personal-bin names carry no semantics. These are explicit organization choices, separate from automatic listening collection.

A generation-bound writer validates that the source snapshot is current and contains the assignment, then atomically removes that assignment and saves feedback. Retries are idempotent, conflicting decisions fail, and a reset invalidates suspended writers. No refill or reordering occurs. Future generation excludes the record from that source bin only; other discovery bins and personal/library membership remain eligible. Snapshot writes re-read durable feedback inside the write transaction so regeneration based on stale inputs cannot resurrect a removed assignment. Export includes allowlisted feedback and reset removes it with the snapshot/history.

This is NOT a complete Milestone 6 implementation. No feedback UI is exposed yet. Move persistence across the existing localStorage personal organization and IndexedDB feedback requires a coordinated, retryable operation before exposing a Move button: confirm the destination assignment was saved, then finalize feedback/removal; if finalization fails, preserve the successful personal filing and explain/retry the pending removal, never claim the entire operation succeeded or blindly roll back concurrent edits. A searchable, bounded destination picker across systems is still required. Existing membership scoring already supplies the positive filing signal once a real assignment is saved. Pin is optional and not implemented. No Milestone 7 work.
