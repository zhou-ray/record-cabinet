import type { CustomSystem } from "../catalog";
export const MAX_CUSTOM_BINS = 5;
export function binNameError(labels: string[]): string | null {
  const names = labels.map(label => label.trim());
  if (!names.length || names.length > MAX_CUSTOM_BINS) return "Name between one and five bins.";
  if (names.some(name => !name)) return "Give each bin a name, or remove the empty row.";
  if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) return "Give each bin a different name.";
  return null;
}
export function fileAlbums(system: CustomSystem, albumIds: string[], binId: string): CustomSystem {
  if (binId && !system.bins.some(bin => bin.id === binId)) return system;
  const assignments = { ...system.assignments };
  for (const id of albumIds) {
    if (binId) assignments[id] = binId;
    else delete assignments[id];
  }
  return { ...system, assignments };
}
export function removeBin(system: CustomSystem, binId: string): CustomSystem {
  const assignments = Object.fromEntries(Object.entries(system.assignments).filter(([, assigned]) => assigned !== binId));
  return { ...system, bins: system.bins.filter(bin => bin.id !== binId), assignments };
}
export function shouldReturnRecord(dx: number, dy: number, velocityY: number, cancelled: boolean): boolean {
  return !cancelled && dy > Math.abs(dx) && (dy >= 55 || (dy >= 16 && velocityY > 550));
}

export function reorderBin(system: CustomSystem, binId: string, direction: -1 | 1): CustomSystem {
  const index = system.bins.findIndex(bin => bin.id === binId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= system.bins.length) return system;
  const bins = [...system.bins];
  [bins[index], bins[target]] = [bins[target], bins[index]];
  return { ...system, bins };
}
