# How Record Cabinet works

Record Cabinet recreates browsing a physical record collection while removing its space and cost constraints. The interaction centers on albums, sleeves, dividers, and a turntable rather than a search-results list.

## Persistent listening room

The shared App Router layout mounts the account provider and library screen. Records and settings change visibility without unmounting the player. Local navigation preserves playback, the selected sleeve, and bin position. Explicit collection/account switches remain separate operations.

## Physical browsing

Motion values drive sleeve position, depth, and rotation. A small visible slice of a bin is rendered, with extra sleeves around upcoming dividers. Divider groups target approximately twenty records while preserving artist runs where possible. Input supports touch, dragging, arrow keys, and reduced motion. Continue digging stores album identity rather than an index, so reordering does not silently change the selected record.

## Library storage and imports

Normalized albums separate provider data from presentation. IndexedDB stores the library, organization, metadata, and import checkpoints. Imported records and their next checkpoint commit in one transaction. Existing album IDs suppress duplicate metadata loads; playlist version receipts avoid rescanning unchanged playlists. Export-file parsing provides an initial local import without Spotify API requests. Resolving missing artwork/tracks and streaming still require provider access.

Cloud synchronization is scoped to the signed-in account. Account changes use separate local storage namespaces. Backups contain collection metadata and organizational systems, not credentials or audio.

## Playback and provider boundaries

Local demo audio and Spotify playback share the turntable interface. The tonearm maps position across the whole album. Spotify's browser SDK supplies playback events; server routes handle authenticated Web API commands and imports. Shared request pacing coordinates deployed instances. Interrupted requests retain saved records; playback commands are not blindly retried.

## Genre metadata

Automatic genre enrichment runs separately from saving albums so provider failure cannot discard an import. Cached results reduce repeated lookups. Broad categories and manual overrides remain available because artist-level metadata is not always a reliable album classification.

## Verification and limitations

Node tests cover data transformations, persistence, recovery, and provider failure cases. Standalone browser scripts exercise gestures, mobile layouts, and mocked playback. These do not establish that protected Spotify audio or native lock-screen integration works on every device. Those require invited testers and physical-device checks.

The public demo is a portfolio and usability-testing experience. Live Spotify access remains subject to Spotify's authorization and quota rules.
