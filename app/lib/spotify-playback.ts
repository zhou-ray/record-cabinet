export type SpotifyDevice = { id: string; name: string; type: string; active: boolean; restricted: boolean };
export type PlaybackState = {
  playing: boolean; progress: number; duration: number; track: string | null; trackUri: string | null;
  albumUri: string | null; externalUrl: string | null; device: SpotifyDevice | null;
  disallowed: Record<string, boolean>;
};
export type PlaybackCommand =
  | { action: "play"; albumUri: string; trackIndex: number; positionMs?: number; deviceId?: string }
  | { action: "resume" | "pause" | "shuffle-off" | "repeat-off"; deviceId?: string }
  | { action: "transfer"; deviceId: string }
  | { action: "seek"; positionMs: number; deviceId?: string };
export function parsePlaybackCommand(value: unknown): PlaybackCommand {
  if (!value || typeof value !== "object") throw new Error("Invalid playback command.");
  const body = value as Record<string, unknown>;
  if (body.deviceId !== undefined && (typeof body.deviceId !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(body.deviceId))) throw new Error("Invalid Spotify device.");
  const deviceId = body.deviceId as string | undefined;
  if (body.action === "transfer" && deviceId) return { action: "transfer", deviceId };
  if (body.action === "pause" || body.action === "resume" || body.action === "shuffle-off" || body.action === "repeat-off") return { action: body.action, deviceId };
  if (body.action === "play" && typeof body.albumUri === "string" && /^spotify:album:[a-zA-Z0-9]{1,64}$/.test(body.albumUri) && Number.isInteger(body.trackIndex) && Number(body.trackIndex) >= 0 && Number(body.trackIndex) <= 10000) {
    if (body.positionMs !== undefined && (!Number.isInteger(body.positionMs) || Number(body.positionMs) < 0 || Number(body.positionMs) > 86400000)) throw new Error("Invalid album position.");
    return { action: "play", ...(body.positionMs !== undefined ? { positionMs: Number(body.positionMs) } : {}), albumUri: body.albumUri, trackIndex: Number(body.trackIndex), deviceId };
  }
  if (body.action === "seek" && Number.isInteger(body.positionMs) && Number(body.positionMs) >= 0 && Number(body.positionMs) <= 86400000) return { action: "seek", positionMs: Number(body.positionMs), deviceId };
  throw new Error("Invalid playback command.");
}
export function playbackRequest(command: PlaybackCommand): { path: string; body?: string } {
  if (command.action === "transfer") return { path: "/me/player", body: JSON.stringify({ device_ids: [command.deviceId], play: false }) };
  const params = new URLSearchParams();
  if (command.deviceId) params.set("device_id", command.deviceId);
  if (command.action === "seek") params.set("position_ms", String(command.positionMs));
  if (command.action === "shuffle-off") params.set("state", "false");
  if (command.action === "repeat-off") params.set("state", "off");
  const endpoint = command.action === "play" || command.action === "resume" ? "play" : command.action === "shuffle-off" ? "shuffle" : command.action === "repeat-off" ? "repeat" : command.action;
  return {
    path: `/me/player/${endpoint}${params.size ? `?${params}` : ""}`,
    ...(command.action === "play" ? { body: JSON.stringify({ context_uri: command.albumUri, offset: { position: command.trackIndex }, position_ms: command.positionMs ?? 0 }) } : {}),
  };
}
type RawDevice = { id?: string | null; name?: string; type?: string; is_active?: boolean; is_restricted?: boolean };
export function normalizeDevice(device?: RawDevice | null): SpotifyDevice | null {
  return device?.id ? { id: device.id, name: device.name || "Spotify device", type: device.type || "device", active: !!device.is_active, restricted: !!device.is_restricted } : null;
}
export function normalizePlayback(value: {
  is_playing?: boolean; progress_ms?: number | null; device?: RawDevice;
  item?: { name?: string; uri?: string; duration_ms?: number; album?: { uri?: string }; external_urls?: { spotify?: string } } | null;
  actions?: { disallows?: Record<string, boolean> } & Record<string, unknown>;
} | null): PlaybackState {
  return {
    playing: !!value?.is_playing, progress: Math.max(0, (value?.progress_ms ?? 0) / 1000), duration: Math.max(0, (value?.item?.duration_ms ?? 0) / 1000),
    track: value?.item?.name ?? null, trackUri: value?.item?.uri ?? null, albumUri: value?.item?.album?.uri ?? null,
    externalUrl: value?.item?.external_urls?.spotify ?? null, device: normalizeDevice(value?.device),
    disallowed: Object.fromEntries(Object.entries(value?.actions?.disallows ?? value?.actions ?? {}).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")),
  };
}
