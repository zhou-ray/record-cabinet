import type { Organization } from "./collection-backup";
import { fileAlbums } from "./bin-organization";

export type DiscoveryDestination = { systemId: string; binId: string };
/** No await between reading the latest organization and writing the one changed assignment.
 * Never roll back a filed album if the separate feedback transaction fails. */
export async function moveDiscoveryRecord<T>(input: {
  albumId: string; destination: DiscoveryDestination;
  read: () => Organization; write: (value: Organization) => void;
  finish: () => Promise<T>;
}): Promise<{ status: "complete"; value: T } | { status: "filed"; retry: () => Promise<T> }> {
  const organization = input.read();
  const system = organization.systems.find(item => item.id === input.destination.systemId);
  if (!system?.bins.some(bin => bin.id === input.destination.binId)) throw new Error("That bin no longer exists. Choose another destination.");
  const next = { ...organization, systems: organization.systems.map(item => item.id === system.id ? fileAlbums(item, [input.albumId], input.destination.binId) : item) };
  input.write(next);
  const confirmed = input.read().systems.find(item => item.id === system.id);
  if (confirmed?.assignments[input.albumId] !== input.destination.binId) throw new Error("Could not confirm filing. The record remains in Discover; check your personal bin before retrying.");
  try { return { status: "complete", value: await input.finish() }; }
  catch { return { status: "filed", retry: input.finish }; }
}
