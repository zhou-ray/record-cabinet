import type { Album } from "../data/types";
import { hydratedAlbum, needsAlbumDetails } from "./spotify-export";
import { recordDiagnostic } from "./beta-diagnostics";
export async function loadAlbumDetails(album: Album, request: typeof fetch, signal: AbortSignal, refresh = false): Promise<Album> {
  if (!refresh && !needsAlbumDetails(album)) return album;
  const payload = album.playback.kind === "spotify-pending" ? { trackUri: album.playback.trackUri } : album.playback.kind === "spotify" ? { albumLink: album.playback.uri } : null;
  if (!payload) throw new Error("This record is not linked to Spotify.");
  const response = await request("/api/spotify/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  if (!response.ok) throw new Error((await response.json()).error || "Album details could not load. Try again later.");
  if (!response.body) throw new Error("The album connection could not open.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", result: Album | undefined, complete = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") { recordDiagnostic("import", 0, event.message || event.error || ""); throw new Error(event.message || event.error || "Album details could not load."); }
    if (event.album) result = event.album;
    if (event.type === "complete") complete = true;
  };
  try {
    while (!complete) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (chunk.done) { consume(buffer); break; }
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (!complete || !result) throw new Error("The album did not finish loading. Your saved record is unchanged.");
  return hydratedAlbum(album, result);
}
