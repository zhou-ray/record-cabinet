# Project Roadmap

This roadmap describes outcomes rather than fixed deadlines. Each milestone
should answer its main question before the project advances.

## Milestone 1: Interaction prototype

### Question

Does manually fingering through a digital record bin feel understandable and
enjoyable?

### Deliverables

- Mobile-first record-bin layout
- Approximately 20 albums using sample data
- Overlapping, front-facing album sleeves
- Touch, mouse, and keyboard navigation
- Focused album rising from the stack
- Album pull-out and inspection states
- Placeholder record-player screen

### Completion criteria

A new user can browse, select, inspect, and place an album on the player
without instructions.

---

## Milestone 2: Spotify feasibility

### Question

Can Spotify support the intended mobile playback experience?

### Deliverables

- Spotify developer application
- Authorization experiment
- Saved-album retrieval experiment
- Album-context playback experiment
- Shuffle and repeat behavior test
- Album completion detection
- Cross-track album seeking experiment
- Mobile Safari playback test
- Spotify Connect control test

### Completion criteria

We understand which playback architecture can reliably support the product
and have documented its limitations.

---

## Milestone 3: Connected MVP

### Question

Can someone use the complete experience with their real Spotify collection?

### Deliverables

- Spotify sign-in
- Saved-album import and synchronization
- Automatically generated bins
- Real album artwork and metadata
- Album-order playback
- Album-level progress tracking
- Needle-style seeking
- Pause, stop, and change-album behavior
- Remembered shelf position
- Basic error handling

### Completion criteria

A Spotify Premium user can sign in, browse their collection, select an album,
play it in order, reposition within it, and return to the shelf.

---

## Milestone 4: Usability testing

### Question

Does the deliberate friction encourage discovery without becoming annoying?

### Deliverables

- Test plan
- Three to five test participants
- Observation notes
- Identified usability problems
- Prioritized revisions
- At least one documented design iteration

### Completion criteria

The major interactions are understandable, and findings either support or
challenge the original product hypothesis.

---

## Milestone 5: Portfolio release

### Question

Does the project clearly communicate both product judgment and engineering
ability?

### Deliverables

- Responsive, polished application
- Public code repository
- Clear README and setup instructions
- Architecture overview
- Automated tests for important behavior
- Short demonstration video
- Portfolio case study
- Documented limitations and future work

### Completion criteria

A reviewer can understand the problem, use or watch the product, inspect the
code, and follow the reasoning behind major decisions.

---

# Future ideas

These ideas are intentionally outside the MVP:

- User-created crates
- Recently neglected albums
- Listening journal
- Personal album notes
- Multiple cabinet styles
- Social collection viewing
- Shared listening
- Liner notes and credits
- Listening statistics
- Additional music services
## Guided introduction

- Add a step-by-step tutorial for opening a bin, browsing records, flipping a sleeve, tapping the vinyl to play, pausing/scrubbing, and filing records or setting genres.
- Anchor each step to the relevant control; support touch and keyboard navigation.
- Include Skip, Back, Next, and a persistent “Don’t show again” preference, with a way to reopen the tutorial from settings.
