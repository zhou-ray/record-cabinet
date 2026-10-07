export const RECORD_STEP = 170;

/** Settle where the hand released, with at most a little extra momentum. */
export function recordReleaseTarget(position: number, velocity: number, count: number, cancelled = false, loop = false): number {
  const momentum = cancelled ? 0 : Math.max(-0.65, Math.min(0.65, velocity * 0.12 / RECORD_STEP));
  const target = Math.round(position + momentum);
  return loop && count > 1 ? target : Math.max(0, Math.min(count - 1, target));
}
