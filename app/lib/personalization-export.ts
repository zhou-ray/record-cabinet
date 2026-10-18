import { checkedDiscoverySnapshot, type DiscoverySnapshot } from "./discovery-snapshot";
import type { Album } from "../data/types";
import { parseOrganization, type Organization } from "./collection-backup";
import { checkedSession, engagementAccount, engagementAlbum, engagementAlbumId, inspection, type EngagementEvent, type PlaybackSession } from "./engagement";

function iso(value: number): string {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) throw new Error("Invalid export timestamp.");
  return new Date(value).toISOString();
}
const id = (value: string) => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);

/** Explicit fields only: never serialize storage/settings, SDK state or auth objects wholesale. */
export function createPersonalizationExport(input: {
  accountId: string; exportedAt: number; albums: Album[]; organization: Organization;
  events: EngagementEvent[]; sessions: PlaybackSession[]; discovery?: DiscoverySnapshot | null;
}) {
  const { accountId } = input;
  if (!engagementAccount(accountId)) throw new Error("Sign in to download your account data.");
  const events = input.events.map(event => {
    if (event.userId !== accountId || !engagementAlbum(event.albumId)) throw new Error("Invalid history account or album.");
    if (event.type === "album_inspected") {
      const checked = inspection(event.id, accountId, event.albumId, event.timestamp);
      return { id: checked.id, type: checked.type, albumId: checked.albumId, timestamp: iso(checked.timestamp) };
    }
    if ((event.type !== "album_play_started" && event.type !== "album_completed") || !id(event.sessionId)
      || event.id !== `playback:${event.sessionId}:${event.type === "album_play_started" ? "started" : "completed"}`) throw new Error("Invalid playback event.");
    return { id: event.id, type: event.type, albumId: event.albumId, timestamp: iso(event.timestamp), sessionId: event.sessionId };
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const sessions = input.sessions.map(value => {
    const session = checkedSession(value, accountId);
    return { id: session.id, albumId: session.albumId, startedAt: iso(session.startedAt), updatedAt: iso(session.updatedAt),
      endedAt: session.endedAt === null ? null : iso(session.endedAt),
      listenedSeconds: session.listenedSeconds, albumDurationSeconds: session.albumDurationSeconds,
      coveredSeconds: session.covered, completionRatio: session.completionRatio,
      completedAt: session.completedAt === null ? null : iso(session.completedAt) };
  }).sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const organization = parseOrganization(input.organization);
  const discovery = input.discovery ? checkedDiscoverySnapshot(input.discovery, accountId) : null;
  return {
    format: "record-cabinet-personalization", version: 1, exportedAt: iso(input.exportedAt),
    scope: "Current account, this browser's saved data only",
    notes: [
      "History contains saved checkpoints; in-progress or failed writes may not be included. Playback is not interrupted.",
      "Library references include imported albums, not a verified list of your current Spotify saved albums.",
      "Personal-bin creation and assignment timestamps were not recorded and are null. Album addedAt is null when unavailable.",
      "History retention may leave events without a retained session or albums no longer present in the library.",
      "Only the latest generated-bin snapshot is retained; older snapshots and feedback are not retained. This file is a data export, not a restorable collection backup.",
    ],
    library: input.albums.filter(album => album.source !== "mock").map(album => {
      if (!["spotify", "spotify-export", "manual"].includes(album.source)
        || ![album.id, album.title, album.artist].every(value => typeof value === "string")
        || !Array.isArray(album.genres) || !album.genres.every(genre => typeof genre === "string")) throw new Error("Invalid library reference.");
      return {
      id: album.id, spotifyAlbumId: engagementAlbumId(album), source: album.source,
      title: album.title, artist: album.artist, genres: [...album.genres],
      addedAt: album.addedAt === undefined ? null : iso(album.addedAt),
      };
    }).sort((a, b) => a.id.localeCompare(b.id)),
    events, sessions,
    organization: {
      arrangement: organization.arrangement, selectedSystemId: organization.systemId, genreBinCount: organization.genreBinCount ?? 0,
      systems: organization.systems.map(system => ({ id: system.id, name: system.name, createdAt: null,
        bins: system.bins.map(bin => ({ id: bin.id, label: bin.label, createdAt: null })),
        memberships: Object.entries(system.assignments).sort(([a], [b]) => a.localeCompare(b)).map(([albumId, binId]) => ({ albumId, binId, assignedAt: null })),
      })),
    },
    generatedBins: { status: "latest-snapshot-only", history: discovery ? [{ id: discovery.id,
      generatedAt: iso(discovery.generatedAt), expiresAt: iso(discovery.expiresAt), version: discovery.version,
      bins: discovery.bins.map(bin => ({ type: bin.type, albumIds: [...bin.albumIds] })),
    }] : [], feedback: [] },
  };
}
