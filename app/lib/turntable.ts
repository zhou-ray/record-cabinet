export const ARM = { x: 510, y: 70, outerAngle: 22, innerAngle: 44 };
export function clampPosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(duration, position));
}
export function positionToAngle(position: number, duration: number): number {
  return ARM.outerAngle + (duration > 0 ? clampPosition(position, duration) / duration : 0) * (ARM.innerAngle - ARM.outerAngle);
}
export function pointToPosition(x: number, y: number, duration: number): number {
  const angle = Math.atan2(ARM.x - x, y - ARM.y) * 180 / Math.PI;
  return clampPosition((angle - ARM.outerAngle) / (ARM.innerAngle - ARM.outerAngle) * duration, duration);
}
export function playbackPosition(progress: number, duration: number, playing: boolean, updatedAt: number, now: number): number {
  return clampPosition(progress + (playing && updatedAt > 0 ? Math.max(0, now - updatedAt) / 1000 : 0), duration);
}
