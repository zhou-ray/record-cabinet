export function spotifyAlbumId(input: string): string {
  const value = input.trim();
  const uri = /^spotify:album:([a-zA-Z0-9]{1,64})$/.exec(value);
  if (uri) return uri[1];
  try {
    const url = new URL(value);
    const match = /^\/(?:intl-[a-zA-Z-]+\/)?album\/([a-zA-Z0-9]{1,64})\/?$/.exec(url.pathname);
    if (url.protocol === "https:" && url.hostname === "open.spotify.com" && !url.port && !url.username && !url.password && match) return match[1];
  } catch { /* Report the same actionable message for invalid links. */ }
  throw new Error("Paste a Spotify album link or spotify:album URI, not a song or playlist link.");
}
