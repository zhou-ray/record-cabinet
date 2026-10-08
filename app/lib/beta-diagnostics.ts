export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "development";
type Area = "import" | "playback" | "sync" | "account";
type Diagnostic = { time: string; area: Area; status: number; reference?: string };
const recent: Diagnostic[] = [];
const playbackEvents = ["engagement-storage-error","playing", "paused", "idle", "ended", "starting", "pause-request", "resume-request", "seek-request", "sdk-error", "device-lost", "status-timeout", "status-missing", "player-unmounted", "account-changed", "account-check-failed", "records-view", "settings-view", "offline", "online", "page-hidden", "page-visible"] as const;
type PlaybackEvent = typeof playbackEvents[number];
const timeline: { time: string; event: PlaybackEvent }[] = [];
let playerSnapshot = { source: "none", playing: false, busy: false, ended: false, positionSeconds: 0, durationSeconds: 0 };
export function recordPlaybackEvent(event: PlaybackEvent) {
  if (!playbackEvents.includes(event)) return;
  const previous = timeline.at(-1);
  if (previous?.event === event && Date.now() - Date.parse(previous.time) < 1000) return;
  timeline.push({ time: new Date().toISOString(), event });
  if (timeline.length > 40) timeline.shift();
}
export function setPlaybackSnapshot(value: { source: string; playing: boolean; busy: boolean; ended: boolean; positionSeconds: number; durationSeconds: number }) {
  const source = ["none", "local", "spotify"].includes(value.source) ? value.source : "none";
  const seconds = (number: number) => Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  const next = { source, playing: !!value.playing, busy: !!value.busy, ended: !!value.ended, positionSeconds: seconds(value.positionSeconds), durationSeconds: seconds(value.durationSeconds) };
  if (next.playing !== playerSnapshot.playing || next.source !== playerSnapshot.source || next.ended !== playerSnapshot.ended) recordPlaybackEvent(next.ended ? "ended" : next.playing ? "playing" : next.source === "none" ? "idle" : "paused");
  playerSnapshot = next;
}
let syncState = "Not checked";
export function setDiagnosticSync(state: "Syncing" | "Paused" | "Up to date" | "Check status") { syncState = state; }
export function recordDiagnostic(area: Area, status: number, message = "") {
  const reference = /\bReference: ([a-f0-9]{8})\b/i.exec(typeof message === "string" ? message : "")?.[1];
  recent.push({ time: new Date().toISOString(), area, status, ...(reference ? { reference } : {}) });
  if (recent.length > 10) recent.shift();
}
export function diagnosticArea(input: RequestInfo | URL): Area | null {
  const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(value, "https://record-cabinet.invalid").pathname;
  if (path === "/api/library/sync") return "sync";
  if (path === "/api/spotify/library") return "import";
  if (path === "/api/spotify/player" || path === "/api/spotify/player/token") return "playback";
  if (path === "/api/spotify/account" || path === "/api/spotify/logout") return "account";
  return null;
}
export function createDiagnosticReport(context: { connected: boolean; storageReady: boolean; storageError: boolean; importing: boolean; authError: string }, browser: { userAgent: string; width: number; height: number; online: boolean }) {
  // Whitelist environment fields; never include URLs, account IDs, raw errors or library data.
  const agent = browser.userAgent;
  const browserName = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /CriOS\/|Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other";
  const versionPattern = browserName === "Edge" ? /Edg\/(\d+)/ : browserName === "Firefox" ? /Firefox\/(\d+)/ : browserName === "Chrome" ? /(?:CriOS|Chrome)\/(\d+)/ : /Version\/(\d+)/;
  const browserVersion = versionPattern.exec(agent)?.[1] ?? "unknown";
  const device = /iPhone|iPad/.test(agent) ? "iOS/iPadOS" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS/iPadOS" : /Linux/.test(agent) ? "Linux" : "Other";
  return JSON.stringify({ app: "Record Cabinet", version: APP_VERSION, capturedAt: new Date().toISOString(), browser: `${browserName} ${browserVersion}`, device, viewport: `${browser.width} × ${browser.height}`, online: browser.online, spotify: context.connected ? "Connected session" : "Guest", signInResult: ["not-invited", "quota", "unavailable", "expired", "reconnect", "denied", "failed"].includes(context.authError) ? context.authError : "None", storage: context.storageError ? "Error" : context.storageReady ? "Ready" : "Loading", import: context.importing ? "Running" : "Idle", sync: context.connected ? syncState : "Unavailable for guests", recentErrors: recent, player: playerSnapshot, playbackHistory: timeline }, null, 2);
}
