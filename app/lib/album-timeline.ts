import type { Album, Track } from "../data/types";
export const trackPlayable = (track: Track) => track.playable !== false && track.duration > 0;
export const lastPlayableTrackIndex = (album: Pick<Album, "tracks">) => album.tracks.reduce((last, track, index) => trackPlayable(track) ? index : last, -1);
const length = (track: Track) => trackPlayable(track) ? Math.max(0, track.duration) : 0;
export function albumDuration(album: Pick<Album, "tracks">): number {
  return album.tracks.reduce((sum, track) => sum + length(track), 0);
}
export function albumCue(album: Pick<Album, "tracks">, seconds: number): { trackIndex: number; positionMs: number; position: number } {
  const duration = albumDuration(album);
  const position = Math.max(0, Math.min(Math.max(0, duration - .001), Number.isFinite(seconds) ? seconds : 0));
  let offset = 0;
  for (let index = 0; index < album.tracks.length; index++) {
    const duration = length(album.tracks[index]);
    if (duration > 0 && position < offset + duration) return { trackIndex: index, positionMs: Math.round((position - offset) * 1000), position };
    offset += duration;
  }
  return { trackIndex: -1, positionMs: 0, position: 0 };
}
export function albumProgress(album: Pick<Album, "tracks">, trackUri: string | null, seconds: number): number | null {
  const index = album.tracks.findIndex(track => track.id.replace(/^spotify:(?!track:)/, "spotify:track:") === trackUri);
  if (index < 0 || !trackPlayable(album.tracks[index])) return null;
  return album.tracks.slice(0, index).reduce((sum, track) => sum + length(track), 0) + Math.max(0, Math.min(album.tracks[index].duration, seconds));
}

export function playbackTrackIndex(album: Pick<Album, "tracks" | "playback">, value: import("./spotify-browser").BrowserPlayback): number {
  const track = value.track_window.current_track;
  const uris = [track.uri, track.linked_from?.uri, track.linked_from_uri];
  const exact = album.tracks.findIndex(item => [item.id, item.linkedFrom].some(id => !!id && uris.includes(id.startsWith("spotify:track:") ? id : id.replace(/^spotify:(?!track:)/, "spotify:track:"))));
  if (exact >= 0) return exact;
  const albumUri = album.playback.kind === "spotify" ? album.playback.uri : "";
  if (!albumUri || (track.album?.uri !== albumUri && value.context?.uri !== albumUri)) return -1;
  const matches = album.tracks.map((item, index) => ({ item, index })).filter(({ item }) => item.title?.trim().toLowerCase() === track.name?.trim().toLowerCase() && Number.isFinite(value.duration) && value.duration > 0 && Math.abs(item.duration * 1000 - value.duration) <= 2000);
  return matches.length === 1 ? matches[0].index : -1;
}
