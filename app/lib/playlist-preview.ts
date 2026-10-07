export class PlaylistIdentityError extends Error {}
export type PlaylistPreview = { id: string; name: string; snapshotId: string; total: number | null; albums: { id: string; title: string; artist: string }[] };
export function playlistId(value: string): string {
  const text = value.trim();
  const uri = /^spotify:playlist:([a-zA-Z0-9]{1,64})$/.exec(text);
  if (uri) return uri[1];
  try { const url = new URL(text); const match = /^\/playlist\/([a-zA-Z0-9]{1,64})\/?$/.exec(url.pathname); if (url.protocol === "https:" && url.hostname === "open.spotify.com" && !url.port && !url.username && !url.password && match) return match[1]; } catch {}
  throw new Error("Paste a Spotify playlist link.");
}
export function checkPlaylistPage(page: { href?: string }, id: string) {
  if (!page.href) return;
  const url = new URL(page.href);
  if (url.origin !== "https://api.spotify.com" || ![`/v1/playlists/${id}/items`, `/v1/playlists/${id}/tracks`].includes(url.pathname)) throw new PlaylistIdentityError("Spotify returned a different playlist. Nothing from that page was imported.");
}
