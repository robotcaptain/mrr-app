# MRR Radio — Track Identification Project

## Goal

MRR Radio episodes are DJ mixes (~55 min, 14–25 tracks). The tracklist (artist + title)
is published in the RSS feed, but no timestamps exist anywhere. The goal is to determine
the **start time (in seconds) of each track** so users can click directly to a song.

Once identified, `startTime` is stored on each track object in `episodes.json` and
propagated into the app's IndexedDB. Episodes with complete (or partial) timestamps
are flagged `indexed: true`.

---

## Source Data

### RSS feed
`https://www.maximumrocknroll.com/cat/mrr-radio/mrr-radio-podcast/feed/`

Each item contains:
- `<enclosure>` — MP3 URL (Blubrry CDN, redirects to maximumrocknroll.com)
- `<itunes:duration>` — total duration (h:mm:ss)
- `<content:encoded>` — full tracklist in HTML (two formats, see below)
- `<description>` — plain-text caption with host name

### Tracklist formats in `content:encoded`

**Newer episodes** (`<dl>/<dt>/<dd>`):
```html
<dl>
  <dt>Section Header</dt>
  <dd>ARTIST NAME – Song Title</dd>
  <dd>ARTIST NAME – Song Title</dd>
</dl>
```

**Older episodes** (`<strong>` + plain lines):
```html
<strong>Section Header</strong><br>
ARTIST NAME – Song Title<br>
ARTIST NAME – Song Title<br>
```

The scraper (`scripts/scrape.mjs`) handles both formats and normalizes artists to
uppercase. No timestamps exist in the RSS; only artist, title, section header, and
track order are available.

### MP3 files
Downloaded locally by `scripts/download-mp3.mjs`:
```
public/audio/mrr-radio-<episodeId>.mp3
```
Typical size: ~50–60 MB per episode at ~128 kbps, ~55 minutes.

---

## Data Structures

### Episode object (stored in IndexedDB `episodes` store, keyPath: `id`)

```json
{
  "id": 1975,
  "date": "2026-03-01",
  "host": "Cary",
  "caption": "On this week's MRR Radio, Cary plays a small sampling of...",
  "thumbnailUrl": null,
  "mp3Url": "https://media.blubrry.com/mrrradio/.../MRR1975.mp3",
  "durationSecs": 3444,
  "trackCount": 14,
  "localAudio": true,
  "indexed": true
}
```

- `thumbnailUrl` — always `null` (MRR has no per-episode images)
- `localAudio` — `true` if MP3 is in `public/audio/`, `false` if streaming from CDN
- `indexed` — `true` once `analyze-tracks.mjs` has been run on this episode

### Track object (stored in IndexedDB `tracks` store, keyPath: `id`)

```json
{
  "id": 19750001,
  "episodeId": 1975,
  "artist": "APPALACHIATARI",
  "title": "Rock 'n' Roll Kitty",
  "section": "Stright Kentucky Rock 'N' Roll",
  "trackIndex": 1,
  "startTime": 293.8
}
```

- `id` — `episodeId * 10000 + trackIndex`
- `artist` — uppercased (for consistent IndexedDB index searching)
- `section` — the DJ's section header this track falls under (e.g. "Intro", "Heavy")
- `trackIndex` — 0-based position within the episode
- `startTime` — seconds from start of MP3; **absent** if not yet identified

Track 0 always gets `startTime: 0`. Subsequent tracks get a value if a boundary was
detected, or no `startTime` field if the boundary could not be found.

### episodes.json (on disk, in `public/data/`)

```json
{
  "generated": "2026-03-02T...",
  "count": 19,
  "episodes": [
    {
      ...episode fields...,
      "tracks": [ ...track objects... ]
    }
  ]
}
```

Tracks are embedded in episodes.json for transport but stored separately in IndexedDB.
The data-loader splits them on import.

---

## Current Approach: ffmpeg Silence Detection

### Script
`scripts/analyze-tracks.mjs <episodeId>`

Requires the MP3 to be downloaded first:
```
node scripts/download-mp3.mjs 1975
node scripts/analyze-tracks.mjs 1975
```

### Algorithm

1. Run ffmpeg with `silencedetect=noise=-50dB:d=0.3` (detect audio below -50 dBFS
   for at least 0.3 seconds)
2. Parse `silence_end: <t>` values from ffmpeg stderr — each is the moment audio
   returns above threshold after a quiet gap
3. Skip any `silence_end` values in the first 10 seconds (intro noise)
4. **Cluster** consecutive points within 60 seconds of each other; take the **last**
   point in each cluster (the firmest track start — audio has clearly come up)
5. Map clusters to tracks: cluster[0] → track 1, cluster[1] → track 2, etc.
6. Track 0 always gets `startTime: 0`
7. Tracks beyond available clusters get no `startTime`

### Results on episode #1975

Episode duration: 57:24 (3444s), 14 tracks

| Track | startTime | Artist |
|-------|-----------|--------|
| 0 | 0:00 | NINE POUND HAMMER |
| 1 | 4:53 | APPALACHIATARI |
| 2 | 13:06 | BUZZ-HOUND |
| 3 | 19:37 | RABBY FEEBER |
| 4 | 23:04 | LAID BACK COUNTRY PICKER |
| 5 | 32:31 | KYARN |
| 6 | 42:15 | PINHEAD POISON |
| 7 | 53:31 | L.I.P.S. |
| 8–13 | — | (continuous mix, no silence detected) |

**8 of 14 tracks** identified. The second half of the show is crossfaded without
silence gaps, so silence detection cannot find those boundaries.

### Tuning parameters (in analyze-tracks.mjs)

```js
const NOISE_DB     = '-50dB';  // detection threshold
const MIN_DURATION = 0.3;      // min silence length (seconds)
const INTRO_SKIP   = 10;       // ignore silence_end values before this (seconds)
const CLUSTER_GAP  = 60;       // points within this many seconds = same boundary
```

---

## Limitations of Silence Detection

MRR Radio hosts typically DJ-mix their sets — tracks crossfade or are back-to-back
with no quiet gap. For episodes that mix continuously throughout, silence detection
will only catch the transitions that happen to have a brief dip.

Observed raw silence_end clusters for #1975:
```
276–293s  →  boundary at 293.8s  (track 1)
786s      →  boundary at 786.2s  (track 2)
1177s     →  boundary at 1177.2s (track 3)
1384s     →  boundary at 1384.3s (track 4)
1936–1951s → boundary at 1951.2s (track 5)
2500–2535s → boundary at 2535.8s (track 6)
3118–3211s → boundary at 3211.7s (track 7)
```

The second half of the show (tracks 8–13, from ~53:31 onward, ~3.5 tracks/6 min)
produced no detectable silence at any threshold tested.

---

## Ideas for Better Identification

### Audio fingerprinting against a music database
- Use **Chromaprint/AcoustID** to generate a fingerprint for short segments of the MP3
- Query **AcoustID API** or **MusicBrainz** to identify which track is playing at a
  given offset
- Pros: high accuracy, works on crossfaded mixes
- Cons: requires API calls per segment, coverage gaps for punk/underground releases

### Spectral novelty / onset detection
- ffmpeg or librosa: detect sudden spectral changes (energy bursts, beat onset)
- More sensitive than silence detection — catches crossfades and cuts
- Produces many false positives; needs filtering against expected track count

### Compare against known track durations
- If we can identify any tracks in the mix via fingerprinting, we know their duration
- Work forward/backward from confirmed anchor points

### Manual correction UI
- Show waveform + tracklist; user drags markers
- Store corrections back to episodes.json

---

## File Locations

```
scripts/
  scrape.mjs           — RSS scraper → episodes.json
  download-mp3.mjs     — download one episode's MP3 to public/audio/
  analyze-tracks.mjs   — ffmpeg silence analysis → writes startTime to episodes.json

public/
  audio/               — downloaded MP3s (gitignored)
  data/episodes.json   — source of truth for all episode + track data

js/
  db.js                — IndexedDB schema + helpers
  data-loader.js       — imports episodes.json → IndexedDB; refreshes indexed episodes
  ui/player-ui.js      — renders tracklist; tracks with startTime are seekable
```

---

## Extending to More Episodes

```bash
# Download and analyze any episode
node scripts/download-mp3.mjs <id>
node scripts/analyze-tracks.mjs <id>

# Batch (bash loop)
for id in 1974 1973 1972; do
  node scripts/download-mp3.mjs $id
  node scripts/analyze-tracks.mjs $id
done
```

The app auto-detects newly indexed episodes on next sync and updates IndexedDB tracks.
