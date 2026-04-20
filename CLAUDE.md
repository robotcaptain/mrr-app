# MRR Radio — Claude Context

## What this is
A PWA for browsing and playing Maximum Rock N Roll Radio episodes. Deployed on Netlify (auto-deploy disabled — use `npx netlify deploy --prod`). GitHub Actions scrapes new episodes every Tuesday.

## Tech stack
- Vanilla JS ESM modules — no framework, no build step, no npm deps
- IndexedDB for local episode/track storage (via `js/db.js`)
- Service worker (`sw.js`) — network-first caching, cache v3
- `"type": "module"` in package.json

## Key files
```
index.html              — app shell (two-column layout grid)
app.css                 — all styles (768px breakpoint for desktop/mobile)
js/app.js               — bootstrap, wires all modules, browse-then-play flow
js/db.js                — IndexedDB: episodes, tracks, playback state
js/data-loader.js       — fetches episodes.json, seeds IndexedDB, version checking
js/player.js            — audio engine (HTMLAudioElement wrapper)
js/ui/player-ui.js      — mini player bar + expanded drawer
js/ui/episode-list.js   — episode card renderer (buildCard, renderList)
js/ui/episode-detail.js — right-column episode detail (artwork, tracklist, play button)
js/ui/nav-stack.js      — mobile navigation stack (back/home buttons)
js/ui/filters.js        — host/year dropdowns + search input (debounced)
js/ui/artist-view.js    — slide-in panel: episodes by artist
js/ui/artist-index.js   — overlay: alphabetical artist list
public/data/episodes.json  — 789 episodes (#1181–#1975), ~17500 tracks
public/data/episodes-version.json — lightweight version check (~60 bytes)
public/images/thumbs/   — locally cached episode thumbnails (391 episodes)
public/audio/           — downloaded MP3s (mrr-radio-<id>.mp3)
scripts/scrape.mjs      — RSS scraper (node scripts/scrape.mjs [--all] [--since N] [--slow] [--download])
scripts/download-thumbs.mjs — downloads episode thumbnails locally
scripts/find-onsets.mjs — track timestamp detection via ffmpeg astats
tools/artist-review.html — interactive artist consolidation review tool
```

## Layout architecture
- **Desktop (>=768px):** Two-column — left (350px, episode list/search/artist views) + right (episode detail)
- **Mobile (<768px):** Single column with NavStack (back/home navigation)
- **Browse-then-play:** Clicking episode shows detail; explicit "Play Episode" button starts playback
- **Player drawer:** Overlays right column (desktop) / full screen (mobile)
- **Artist index/view:** Scoped to left column on desktop

## CSS z-index layers
| Layer | z-index (mobile) | z-index (desktop) |
|-------|-------------------|-------------------|
| Artist side panel (.side-panel) | 400 | 95 |
| Player sheet (#player-sheet) | 300 | 300 |
| Sheet backdrop | 290 | 290 |
| Mini player (.mini-player) | 200 | 200 |
| Header (#app-header) | 100 | 100 |
| Filter bar (#filter-bar) | 90 | 10 (sticky) |
| Artist index overlay (#artist-index-overlay) | 85 | absolute in left-column |

## CSS custom properties
- `--header-h: 48px`, `--filter-h: 88px`, `--player-h: 64px`
- `--safe-bottom`, `--bg`, `--surface`, `--border`, `--text`, `--muted`, `--accent`

## Body classes (set dynamically)
- `has-player` — added by PlayerUI.setEpisode(); shrinks .side-panel to expose mini player
- `keyboard-open` — toggled by visualViewport resize listener; hides mini player
- `mobile-detail` — added when episode detail is shown on mobile (hides left column)

## Data model
**Episode:** `{ id, date, host, caption, thumbnailUrl, mp3Url, durationSecs, trackCount, localAudio, indexed?, tracks[] }`
**Track:** `{ id, episodeId, artist, title, section, trackIndex, startTime?, startTimeMethod?, startTimeConfidence?, durationSecs? }`
- `artist` is always uppercase (normalized at scrape time)
- `startTime` fields only present on indexed episodes (#1956–#1975)
- `indexed: true` on 19 episodes — scraper doesn't preserve this; must be restored manually after bulk scrapes
- Thumbnail paths: `/public/images/thumbs/<id>.ext` (publish dir is `.`)

## Sync behavior
- `checkForUpdate()` on boot fetches tiny version file, turns sync button yellow if newer data available
- Sync always re-renders UI after completion (not just when new episodes added)
- `txPutBulk` resolves on `tx.oncomplete` to ensure reads see writes

## Track timestamp detection
Uses `scripts/find-onsets.mjs` — ffmpeg astats RMS + first-derivative onset detection.
- Results are CANDIDATES requiring manual listening verification

## npm scripts
```
npm run scrape           # scrape 15 most recent episodes
npm run scrape:all       # full archive
npm run scrape:download  # also download MP3s
node scripts/scrape.mjs --since 1700 --slow   # episodes after #1700, 5s delay
node scripts/find-onsets.mjs <episodeId> [--dry-run] [--all-candidates]
```

## Deployment
- Netlify auto-deploy is DISABLED (`stop_builds: true`)
- Deploy manually: `npx netlify deploy --prod`
- ALWAYS get user approval before deploying

## Backlog
1. **Artist view full-height on desktop** — should fill entire left column (no episode list peeking through)
2. **Mini player click-to-expand** — click anywhere on mini player to open drawer
3. **Player drawer click-to-close** — click anywhere on drawer top area to close
4. **Indexed timestamps not showing** — track timestamps stopped displaying on indexed episodes
5. **Player drawer visual distinction** — stronger top border and/or lighter background shade
6. **Post-scrape cleanup** — fix .5 episode IDs, improve host detection, add --local-rss mode
7. **Download MP3s** — download episodes for local indexing
8. **Index track timestamps** — run find-onsets.mjs on downloaded MP3s, verify manually
9. **Favorites list** — requires user tracking (localStorage or login). Backburner.
