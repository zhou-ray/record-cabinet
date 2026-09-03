# Decision Log

This file records consequential product and technical decisions. It is not a
daily work log.

A decision may be revised when testing or technical evidence justifies it.

---

## 2026-09-03: Use albums as the primary object

### Status

Accepted

### Decision

The application will organize, select, and play albums rather than individual
tracks.

### Reason

The purpose of the product is to restore album-oriented discovery and
listening. Making tracks independently selectable would weaken that concept.

### Reconsider if

Spotify playback limitations make reliable album-context playback impossible.

---

## 2026-09-03: Remove text search

### Status

Accepted

### Decision

The primary experience will not include a text search function.

### Reason

Manual browsing and accidental rediscovery are central to the product
hypothesis.

### Reconsider if

Accessibility testing shows that the absence of any nonvisual navigation makes
the collection unusable for some users. Any accommodation should preserve the
intentional browsing model where possible.

---

## 2026-09-03: Use a record-store bin metaphor

### Status

Accepted

### Decision

Albums will appear as overlapping, front-facing sleeves that the listener
manually fingers through.

### Reason

This keeps album artwork recognizable on phones while recreating the physical
act of browsing records.

### Reconsider if

User testing shows that people cannot understand or comfortably control the
interaction.

---

## 2026-09-03: Design mobile first

### Status

Accepted

### Decision

The essential experience will be designed for a phone-sized touchscreen first,
then adapted for desktop.

### Reason

The initial user does most music listening on a phone, while desktop remains
important for the portfolio and broader usability.

### Reconsider if

Spotify's mobile browser limitations prevent a satisfactory playback
experience.

---

## 2026-09-03: Begin with a responsive web application

### Status

Provisional

### Decision

Begin with Next.js and evaluate an installable progressive web application
before considering native mobile development.

### Reason

A web application provides a fast route to testing both mobile and desktop
from one codebase.

### Reconsider if

The Spotify feasibility milestone finds that browser playback, background
operation, or mobile interaction constraints materially damage the experience.

---

## 2026-09-03: Prototype with sample data before Spotify

### Status

Accepted

### Decision

Build and test the core browsing interaction using sample albums before
integrating Spotify authentication or playback.

### Reason

The distinctive value of the project is the browsing experience. Sample data
lets us test that experience without external API complexity.

### Reconsider if

No reconsideration is currently expected; the Spotify feasibility experiment
will follow immediately after the interaction prototype.

---

## 2026-09-03: Allow album-level seeking

### Status

Accepted

### Decision

The listener may move through an album using a record-player-style interaction,
but conventional track-selection and skip controls will not be prominent.

### Reason

Physical records can be repositioned. The goal is intentional album listening,
not forced completion.

### Reconsider if

The interaction is too imprecise on mobile or Spotify cannot support reliable
cross-track seeking.