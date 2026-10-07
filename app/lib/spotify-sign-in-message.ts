export function spotifySignInMessage(code: string): string {
  if (code === "not-invited") return "Spotify denied access. This beta is invite-only: ask your inviter to add your Spotify email in Spotify’s Users Management. If you are already invited, check the account you used and the permissions you granted.";
  if (code === "quota") return "Spotify has paused requests for this shared beta. Try later; reconnecting will not reset the allowance. Your saved records and the demo remain available.";
  if (code === "unavailable") return "The Spotify connection is temporarily unavailable. Try again later. Your saved collection is safe.";
  if (code === "expired") return "Your Spotify session expired. Reconnect Spotify to continue; your saved records are safe.";
  if (code === "reconnect") return "Reconnect Spotify once to give your collection its own account space. Your previous collection has been kept. Recover it from Account and privacy below.";
  if (code === "denied") return "Spotify sign-in was cancelled or its link expired. Choose Connect Spotify to start again.";
  return code && code !== "mobile-setup" ? "Spotify sign-in did not complete. Choose Connect Spotify to try again." : "";
}
