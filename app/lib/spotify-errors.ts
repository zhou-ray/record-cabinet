import { SpotifyError } from "./spotify-requests";
export function spotifyFailure(error: unknown, context: "playback" | "import" = "playback") {
  const status = error instanceof SpotifyError ? error.status : 502;
  const dataCode = error instanceof Error && "code" in error ? String(error.code) : undefined;
  const reason = error instanceof SpotifyError ? error.reason : ["INVALID_PAGE", "INVALID_ALBUM", "INVALID_PAGINATION", "EMPTY_ALBUM"].includes(dataCode ?? "") ? dataCode : undefined;
  const retryAfter = error instanceof SpotifyError ? error.retryAfter : null;
  const numeric = retryAfter ? Number(retryAfter) : NaN;
  const retryAt = Number.isFinite(numeric) ? Date.now() + numeric * 1000 : null;
  const message = reason === "ACCOUNT_CHANGED" ? "The Spotify account changed in another tab. Reload before continuing."
    : reason === "LIMITER_UNAVAILABLE" ? "Spotify requests are temporarily paused while our connection recovers. Your saved records are safe."
    : reason === "QUOTA_EXCEEDED" ? "Our shared Spotify quota is exhausted. Your saved records are still available. Reconnecting will not reset it. Spotify has not provided a confirmed availability time."
    : status === 429 ? "Spotify is limiting requests. Your progress is saved; continue later."
    : context === "import" && reason === "SPOTIFY_TIMEOUT" ? "Spotify took too long to send the album data. Your import position is saved. Choose Try again to continue."
    : context === "import" && reason === "NETWORK_ERROR" ? "The connection to Spotify was interrupted. Your import position is saved. Choose Try again to continue."
    : context === "import" && ["INVALID_RESPONSE", "INVALID_PAGE", "INVALID_ALBUM"].includes(reason ?? "") ? "Spotify returned incomplete album data. Import paused without skipping the unfinished album. Your saved records are safe."
    : context === "import" && reason === "INVALID_PAGINATION" ? "Spotify returned an import link we could not safely follow. Your saved records are safe; the unfinished album was not skipped."
    : context === "import" && reason === "EMPTY_ALBUM" ? "This album has no available tracks in Spotify. Your other records are safe; the unfinished album was not skipped."
    : context === "import" && status === 404 ? "Spotify could not find the selected playlist or album. Check that it is still available to your account."
    : context === "playback" && ["TRACK_NOT_PLAYABLE", "NON_PLAYABLE"].includes(reason ?? "") ? "Spotify cannot play this track for your account right now."
    : status === 404 ? "The browser player is not ready. Put the record on again to reconnect playback."
    : status === 401 ? "Your Spotify session expired. Reconnect to continue."
    : status === 403 ? reason === "PREMIUM_REQUIRED" ? "Spotify Premium is required to play records here." : "Spotify denied access. This beta is invite-only: ask the owner to add your Spotify email in Users Management. If you are already invited, check the permissions granted to Record Cabinet."
    : context === "import" ? `Import interrupted${error instanceof SpotifyError ? ` (Spotify HTTP ${status})` : ""}. Your import position and saved records are kept. Choose Try again to continue.`
    : "Spotify did not confirm the request. Check playback in Spotify before trying again. Your saved records are still available.";
  return { status, error: message, message, reason, retryAt: reason === "QUOTA_EXCEEDED" ? null : retryAt, reconnect: status === 401 };
}
