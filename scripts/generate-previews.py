"""Generate original, deterministic ten-second musical sketches (no external audio)."""
import math
import re
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'public' / 'audio'
ROOT.mkdir(parents=True, exist_ok=True)
RATE = 16000
SECONDS = 10
# Read stable album IDs so additions to the catalog are included automatically.
catalog = (ROOT.parent.parent / "app" / "data" / "mock.ts").read_text()
ALBUM_IDS = sorted({int(id) for id in re.findall(r'"album-(\d+)"', catalog)})
for album in ALBUM_IDS:
    for track in range(1, 4):
        root = 45 + album * 2 + track
        notes = [0, 7, 12, 16, 14, 7, 19, 12]
        frames = bytearray()
        for sample in range(RATE * SECONDS):
            t = sample / RATE
            beat = t * (2 + album * .12)
            phase = beat % 1
            midi = root + notes[(int(beat) + track) % len(notes)]
            frequency = 440 * 2 ** ((midi - 69) / 12)
            envelope = min(1, phase * 35) * math.exp(-phase * 4)
            melody = math.sin(2 * math.pi * frequency * t) + .18 * math.sin(4 * math.pi * frequency * t)
            bass = math.sin(2 * math.pi * (440 * 2 ** ((root - 12 - 69) / 12)) * t)
            fade = min(1, t / .2, (SECONDS - t) / .7)
            value = fade * (.22 * melody * envelope + .075 * bass)
            frames.extend(struct.pack('<h', int(value * 32767)))
        with wave.open(str(ROOT / f'rc-{album}-{track}.wav'), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(frames)

# Each record plays as one continuous file, always in its printed track order.
for album in ALBUM_IDS:
    with wave.open(str(ROOT / f'album-{album}.wav'), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        for track in range(1, 4):
            with wave.open(str(ROOT / f'rc-{album}-{track}.wav'), 'rb') as source:
                output.writeframes(source.readframes(source.getnframes()))
