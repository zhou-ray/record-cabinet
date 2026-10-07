export type PlaybackSource =
  | { kind: "local"; url: string; demo: boolean }
  | { kind: "spotify"; uri: string }
  | { kind: "spotify-pending"; trackUri: string }
  | { kind: "none" };

export type Track = {
  id: string;
  title: string;
  /** Seconds, independent of the source provider. */
  duration: number;
  disc: number;
  number: number;
  playable?: boolean;
  linkedFrom?: string;
};

export type Album = {
  id: string;
  source: "mock" | "spotify" | "spotify-export" | "manual";
  title: string;
  artist: string;
  artists: { id: string; name: string }[];
  year: string;
  genre: string;
  genres: string[];
  genresEdited?: boolean;
  addedAt?: number;
  availabilityCheckedAt?: number;
  importOrigin?: { source: string; trackId?: string; addedAt: number };
  color: string;
  note: string;
  catalogNumber: string;
  artworkUrl: string | null;
  externalUrl: string | null;
  tracks: Track[];
  playback: PlaybackSource;
};

export interface LibraryProvider {
  /** Complete collection; providers handle pagination before returning. */
  getAlbums(signal?: AbortSignal): Promise<Album[]>;
}
