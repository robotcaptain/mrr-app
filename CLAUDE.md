# MRR Radio — Claude Context

## What this is
A PWA for browsing and playing Maximum Rock N Roll Radio episodes. Deployed on Netlify, auto-deploys on push to `main`. GitHub Actions scrapes new episodes every Tuesday.

## Tech stack
- Vanilla JS ESM modules — no framework, no build step, no npm deps
- IndexedDB for local episode/track storage (via `js/db.js`)
- Service worker (`sw.js`) — network-first caching strategy
- `"type": "module"` in package.json

## Key files
```
index.html              — app shell
app.css                 — all styles
js/app.js               — bootstrap, wires all modules together
js/db.js                — IndexedDB: episodes, tracks, playback state
js/data-loader.js       — fetches episodes.json, seeds IndexedDB
js/player.js            — audio engine (HTMLAudioElement wrapper)
js/ui/player-ui.js      — mini player bar + expanded sheet
js/ui/episode-list.js   — episode card renderer (buildCard, renderList)
js/ui/filters.js        — host/year dropdowns + search input (debounced)
js/ui/artist-view.js    — slide-in panel: episodes by artist
js/ui/artist-index.js   — full-screen overlay: alphabetical artist list
public/data/episodes.json  — 273 episodes (#1701–#1975), 6129 tracks
public/audio/           — downloaded MP3s (mrr-radio-<id>.mp3)
scripts/scrape.mjs      — RSS scraper (node scripts/scrape.mjs [--all] [--since N] [--slow] [--download])
scripts/find-onsets.mjs — track timestamp detection via ffmpeg astats
```

## CSS z-index layers
| Layer | z-index |
|-------|---------|
| Artist side panel (.side-panel) | 400 |
| Player sheet (#player-sheet) | 300 |
| Sheet backdrop | 290 |
| Mini player (.mini-player) | 200 |
| Header (#app-header) | 100 |
| Filter bar (#filter-bar) | 90 |
| Artist index overlay (#artist-index-overlay) | 85 |

## CSS custom properties
- `--header-h: 48px`, `--filter-h: 44px`, `--player-h: 64px`
- `--safe-bottom`, `--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`

## Body classes (set dynamically)
- `has-player` — added by PlayerUI.setEpisode(); shrinks .side-panel to expose mini player
- `keyboard-open` — toggled by visualViewport resize listener; hides mini player

## Data model
**Episode:** `{ id, date, host, caption, thumbnailUrl, mp3Url, durationSecs, trackCount, localAudio, tracks[] }`
**Track:** `{ id, episodeId, artist, title, section, trackIndex, startTime?, startTimeMethod?, startTimeConfidence?, durationSecs? }`
- `artist` is always uppercase (normalized at scrape time)
- `startTime` fields only present on indexed episodes

## Track timestamp detection
Uses `scripts/find-onsets.mjs` — ffmpeg astats RMS + first-derivative onset detection.
- Results are CANDIDATES requiring manual listening verification
- `scripts/analyze-tracks.mjs` is deprecated (unreliable silence detection)

## npm scripts
```
npm run scrape           # scrape 15 most recent episodes
npm run scrape:all       # full archive
npm run scrape:download  # also download MP3s
node scripts/scrape.mjs --since 1700 --slow   # episodes after #1700, 10s delay
node scripts/find-onsets.mjs <episodeId> [--dry-run] [--all-candidates]
```

## Backlog
1. **Player sheet z-index bug** — expanded sheet opens behind the artist side panel. Should stay minimized when artist panel opens; expand on top when explicitly tapped.
2. **Download MP3s** — download episodes for local indexing (start with recent ones).
3. **Index track timestamps** — run find-onsets.mjs on downloaded MP3s, verify manually.
4. **Scrape pre-#1700** — extend archive further back with `--since <N>`.
