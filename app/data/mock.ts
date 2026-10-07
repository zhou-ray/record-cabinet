import type { Album, LibraryProvider } from "./types";

const records = [
  { id: "album-1", title: "Sunroom", artist: "The Sunday Service", year: "1974", genre: "Soul / Jazz", color: "sun", note: "Loose grooves, golden light, and nowhere in particular to be.", tracks: [{ id: "rc-1-1", title: "Windows Open", duration: 242 }, { id: "rc-1-2", title: "A Little Longer", duration: 318 }, { id: "rc-1-3", title: "Sunday, Slowly", duration: 276 }] },
  { id: "album-2", title: "Blue Hours", artist: "Alice & the Satellites", year: "1982", genre: "Ambient / Jazz", color: "blue", note: "For the quiet stretch between the last train and the first light.", tracks: [{ id: "rc-2-1", title: "Night Bus", duration: 301 }, { id: "rc-2-2", title: "Soft Focus", duration: 254 }, { id: "rc-2-3", title: "Before Dawn", duration: 367 }] },
  { id: "album-3", title: "Earth Tones", artist: "Moss Ensemble", year: "1971", genre: "Folk / Psych", color: "moss", note: "Wandering melodies with their feet planted firmly in the soil.", tracks: [{ id: "rc-3-1", title: "Fern", duration: 218 }, { id: "rc-3-2", title: "Weather Patterns", duration: 285 }, { id: "rc-3-3", title: "Coming Home", duration: 246 }] },
  { id: "album-4", title: "Afterimage", artist: "Studio Violet", year: "1996", genre: "Electronic", color: "violet", note: "A late-night transmission of warm machines and hazy memories.", tracks: [{ id: "rc-4-1", title: "Frequency", duration: 326 }, { id: "rc-4-2", title: "Purple Room", duration: 294 }, { id: "rc-4-3", title: "Echo Location", duration: 381 }] },
  { id: "album-5", title: "Soft Landing", artist: "Luca Sol", year: "1978", genre: "Bossa / Soul", color: "coral", note: "An easy exhale. A little rhythm to take the long way home.", tracks: [{ id: "rc-5-1", title: "Coast Road", duration: 237 }, { id: "rc-5-2", title: "No Hurry", duration: 263 }, { id: "rc-5-3", title: "Good Company", duration: 309 }] },
  {"id": "album-6", "title": "Golden Days", "artist": "The Sunday Service", "year": "1976", "genre": "Soul / Jazz", "color": "coral", "note": "A roomful of voices, a patient bass line, and the last warmth of the afternoon.", "tracks": [{"id": "rc-6-1", "title": "Open Door", "duration": 341}, {"id": "rc-6-2", "title": "Honey Light", "duration": 220}, {"id": "rc-6-3", "title": "Stay for Supper", "duration": 249}]},
  {"id": "album-7", "title": "Common Ground", "artist": "The Sunday Service", "year": "1979", "genre": "Soul", "color": "moss", "note": "Handclaps and warm harmonies from a band that sounds like old friends.", "tracks": [{"id": "rc-7-1", "title": "Meet Me There", "duration": 358}, {"id": "rc-7-2", "title": "Kitchen Table", "duration": 237}, {"id": "rc-7-3", "title": "All Together", "duration": 266}]},
  {"id": "album-8", "title": "Moon Letters", "artist": "Alice & the Satellites", "year": "1985", "genre": "Ambient / Jazz", "color": "violet", "note": "Piano notes drift between soft synthesizers and distant radio signals.", "tracks": [{"id": "rc-8-1", "title": "Postmarked Midnight", "duration": 225}, {"id": "rc-8-2", "title": "Faraway Signal", "duration": 254}, {"id": "rc-8-3", "title": "Silver Ink", "duration": 283}]},
  {"id": "album-9", "title": "Still Water", "artist": "Alice & the Satellites", "year": "1988", "genre": "Ambient", "color": "moss", "note": "An unhurried set of small melodies reflected in a very large silence.", "tracks": [{"id": "rc-9-1", "title": "Low Tide", "duration": 242}, {"id": "rc-9-2", "title": "Glass Lake", "duration": 271}, {"id": "rc-9-3", "title": "Nothing Moving", "duration": 300}]},
  {"id": "album-10", "title": "Field Notes", "artist": "Moss Ensemble", "year": "1973", "genre": "Folk / Psych", "color": "sun", "note": "Acoustic strings and wandering flute lines gathered along the edge of town.", "tracks": [{"id": "rc-10-1", "title": "Footpath", "duration": 259}, {"id": "rc-10-2", "title": "Wildflowers", "duration": 288}, {"id": "rc-10-3", "title": "North Meadow", "duration": 317}]},
  {"id": "album-11", "title": "Woodsmoke", "artist": "Moss Ensemble", "year": "1976", "genre": "Folk", "color": "coral", "note": "Close harmonies and worn guitar strings for the first cold evening of the year.", "tracks": [{"id": "rc-11-1", "title": "Kindling", "duration": 276}, {"id": "rc-11-2", "title": "Old Pines", "duration": 305}, {"id": "rc-11-3", "title": "Embers", "duration": 334}]},
  {"id": "album-12", "title": "Night Circuit", "artist": "Studio Violet", "year": "1999", "genre": "Electronic / Ambient", "color": "blue", "note": "Soft pulses travel through empty streets long after the shop lights go out.", "tracks": [{"id": "rc-12-1", "title": "Side Street", "duration": 293}, {"id": "rc-12-2", "title": "Night Circuit", "duration": 322}, {"id": "rc-12-3", "title": "Last Connection", "duration": 351}]},
  {"id": "album-13", "title": "Slow Signal", "artist": "Studio Violet", "year": "2003", "genre": "Electronic", "color": "sun", "note": "Tape-worn rhythms and little bursts of melody from a makeshift home studio.", "tracks": [{"id": "rc-13-1", "title": "Warm Machines", "duration": 310}, {"id": "rc-13-2", "title": "Signal Drift", "duration": 339}, {"id": "rc-13-3", "title": "Power Down", "duration": 218}]},
  {"id": "album-14", "title": "Salt Air", "artist": "Luca Sol", "year": "1980", "genre": "Bossa / Soul", "color": "blue", "note": "Light percussion and sun-faded guitar chords carried in from the waterfront.", "tracks": [{"id": "rc-14-1", "title": "Harbor Steps", "duration": 327}, {"id": "rc-14-2", "title": "Sea Glass", "duration": 356}, {"id": "rc-14-3", "title": "Afternoon Ferry", "duration": 235}]},
  {"id": "album-15", "title": "Balcony Songs", "artist": "Luca Sol", "year": "1983", "genre": "Bossa / Jazz", "color": "violet", "note": "A small ensemble playing quietly enough to hear the city outside.", "tracks": [{"id": "rc-15-1", "title": "Window Seat", "duration": 344}, {"id": "rc-15-2", "title": "Two Cups", "duration": 223}, {"id": "rc-15-3", "title": "Evening Breeze", "duration": 252}]},
];


export const mockAlbums: Album[] = records.map((record) => ({
  ...record,
  source: "mock",
  artists: [{ id: `mock:${record.artist}`, name: record.artist }],
  genres: record.genre.split(" / "),
  catalogNumber: `RC—${record.id.split("-")[1].padStart(3, "0")}`,
  artworkUrl: null,
  externalUrl: null,
  tracks: record.tracks.map((track, i) => ({ ...track, disc: 1, number: i + 1 })),
  playback: { kind: "local", url: `/audio/${record.id}.wav`, demo: true },
}));

export const mockLibrary: LibraryProvider = {
  async getAlbums() { return structuredClone(mockAlbums); },
};
