import type { Album } from "./types";

const titles = [
  "Amber Window", "Between Stations", "Cedar House", "Distant Rooms", "Early Light",
  "Floating Gardens", "Gentle Weather", "Harbor Lights", "Inside the Afternoon", "Juniper",
  "Kindred", "Lantern Walk", "Morning Paper", "Near the Ocean", "Open Windows",
  "Paper Lanterns", "Quiet Company", "River Stones", "Small Hours", "Through the Trees",
  "Under the Awning", "Velvet Evening", "Warm Horizon", "Yesterday's Rain", "A Place to Stay",
  "Bright Corners", "Cloud Atlas", "Driftwood", "Empty Streets", "Far Shore",
  "Greenhouse", "Half Remembered", "In the Courtyard", "Last Light", "Maple Street",
  "Northern Windows", "Orchard", "Porchlight", "Rain on Glass", "Summer Kitchen",
  "Third Floor", "Unhurried", "Violet Sky", "Wild Garden", "After the Rain",
];

/** Fictional browsing samples reuse the original sketches, never provider audio. */
export function publicDemo(albums: Album[]): Album[] {
  if (!albums.length) return [];
  return [...albums, ...titles.map((title, index) => {
    const base = albums[index % albums.length];
    const id = `demo-extra-${index + 1}`;
    return {
      ...base, id, title, catalogNumber: `RC—${String(albums.length + index + 1).padStart(3, "0")}`,
      note: "A fictional sleeve for exploring the cabinet. Audio reuses an original demo sketch.",
      tracks: base.tracks.map((track, trackIndex) => ({ ...track, id: `${id}:${trackIndex}` })),
    };
  })];
}
