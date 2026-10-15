export type SystemPlayback = { play: () => void; pause: () => void; seek: (seconds: number) => void; position: () => number; canPlay: () => boolean; canPause: () => boolean; canSeek: () => boolean };
const actions: MediaSessionAction[] = ["play", "pause", "stop", "seekto", "seekbackward", "seekforward", "previoustrack", "nexttrack"];
export function installMediaControls(session: MediaSession, controls: SystemPlayback) {
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    // Consume system track-navigation commands without changing the record.
    previoustrack: () => {},
    nexttrack: () => {},
    play: () => { if (controls.canPlay()) controls.play(); },
    pause: () => { if (controls.canPause()) controls.pause(); },
    stop: () => { if (controls.canPause()) controls.pause(); },
    seekto: event => { if (controls.canSeek() && Number.isFinite(event.seekTime)) controls.seek(event.seekTime!); },
    seekbackward: event => { if (controls.canSeek()) controls.seek(Math.max(0, controls.position() - (event.seekOffset ?? 10))); },
    seekforward: event => { if (controls.canSeek()) controls.seek(controls.position() + (event.seekOffset ?? 10)); },
  };
  for (const action of actions) { try { session.setActionHandler(action, handlers[action] ?? null); } catch { /* Older Safari versions support only some actions. */ } }
  return () => { for (const action of actions) { try { session.setActionHandler(action, null); } catch {} } };
}
export function updateSystemPosition(session: MediaSession, duration: number, position: number) {
  try {
    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(position)) session.setPositionState?.({ duration, playbackRate: 1, position: Math.max(0, Math.min(duration, position)) });
    else session.setPositionState?.();
  } catch { /* Position state is optional; metadata and transport still work. */ }
}
