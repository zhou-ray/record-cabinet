export type BrowserPlayback = { paused: boolean; context?: { uri?: string }; position: number; duration: number; disallows?: Record<string, boolean>; track_window: { current_track: { uri: string; linked_from?: { uri?: string }; linked_from_uri?: string; name: string; album: { uri: string } } } };
export type BrowserPlayer = {
  addListener(event: string, callback: (value: never) => void): boolean;
  connect(): Promise<boolean>; disconnect(): void; activateElement(): Promise<void>;
  pause(): Promise<void>; resume(): Promise<void>; seek(position: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getCurrentState(): Promise<BrowserPlayback | null>;
};
declare global {
  interface Window {
    Spotify?: { Player: new (options: { name: string; volume: number; enableMediaSession: boolean; getOAuthToken: (callback: (token: string) => void) => void }) => BrowserPlayer };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}
let loading: Promise<void> | null = null;
function loadSDK(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => { script.remove(); reject(new Error("The browser player could not load. Try again.")); }, 20000);
    window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timer); resolve(); };
    script.src = "https://sdk.scdn.co/spotify-player.js"; script.async = true;
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("The browser player could not load. Try again.")); };
    document.head.appendChild(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
export async function connectBrowserPlayer(onState: (state: BrowserPlayback | null) => void, onError: (message: string, reconnect?: boolean, disconnected?: boolean) => void, signal: AbortSignal, apiFetch: typeof fetch = fetch, volume = .7): Promise<{ player: BrowserPlayer; deviceId: string }> {
  await loadSDK(); signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let ready = false;
    // Safari may choose the SDK's audio frame as its Now Playing source.
    // Publish native metadata there as well as our album-level parent session.
    // The app owns album metadata and transport handlers; SDK handlers can override them.
    const player = new window.Spotify!.Player({ name: "Record Cabinet", volume, enableMediaSession: false, getOAuthToken: callback => {
      void apiFetch("/api/spotify/player/token", { cache: "no-store", signal }).then(async response => {
        const data = await response.json();
        if (!response.ok) { onError(data.error || "Reconnect Spotify to play here.", true); throw new Error(data.error || "Reconnect Spotify to play here."); }
        callback(data.accessToken);
      }).catch(error => fail(error instanceof Error ? error.message : "Spotify sign-in failed."));
    } });
    const timer = setTimeout(() => fail("Spotify could not connect this browser. Try again."), 25000);
    const stop = () => { clearTimeout(timer); player.disconnect(); signal.removeEventListener("abort", stop); if (!ready) reject(new Error("Browser playback cancelled.")); };
    const fail = (message: string, reconnect = false) => {
      onError(message, reconnect);
      if (!ready) { clearTimeout(timer); player.disconnect(); signal.removeEventListener("abort", stop); reject(new Error(message)); }
    };
    signal.addEventListener("abort", stop, { once: true });
    player.addListener("ready", ({ device_id }: { device_id: string }) => { clearTimeout(timer); ready = true; resolve({ player, deviceId: device_id }); });
    player.addListener("not_ready", () => onError("This browser disconnected from Spotify. Put the record on again to reconnect.", false, true));
    player.addListener("player_state_changed", onState);
    player.addListener("initialization_error", () => fail("This browser cannot play protected Spotify audio. Try a supported browser with protected content enabled."));
    player.addListener("authentication_error", () => fail("Reconnect Spotify to enable playback in this browser.", true));
    player.addListener("account_error", () => fail("Spotify Premium is required for playback in this app."));
    player.addListener("playback_error", () => fail("Spotify could not play this record. Try putting it on again."));
    player.addListener("autoplay_failed", () => onError("Your browser needs another tap. Press Play record to enable audio."));
    void player.connect().then(connected => { if (!connected) fail("Spotify could not connect this browser. Try again."); }).catch(() => fail("Spotify could not connect this browser. Try again."));
  });
}
