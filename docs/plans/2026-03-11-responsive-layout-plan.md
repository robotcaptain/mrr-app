# Responsive Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the MRR Radio PWA with a two-column desktop layout and navigation-stack mobile layout, separating browse (episode detail) from playback (player drawer).

**Architecture:** The HTML gains a two-column grid wrapper (`#app-layout`). The left column holds the episode list, filters, artist index, and artist view. The right column holds a new `EpisodeDetail` component. The existing player sheet becomes the player drawer (overlay only). A `NavStack` module manages mobile screen transitions. CSS media queries at 768px switch between side-by-side and stacked layouts.

**Tech Stack:** Vanilla JS ESM, CSS Grid, CSS media queries. No new dependencies.

---

### Task 1: Add EpisodeDetail component

The new right-column component shows a single episode's artwork, metadata, "Play Episode" button, and tracklist. This is the core new piece — everything else wires into it.

**Files:**
- Create: `js/ui/episode-detail.js`

**Step 1: Create EpisodeDetail class**

```js
/**
 * episode-detail.js — Right-column episode detail view
 *
 * Shows episode artwork, metadata, "Play Episode" button, and tracklist.
 * Does NOT control playback — emits callbacks for play and artist clicks.
 */

import { getTracks } from '../db.js';

function fmtTime(secs) {
  if (!secs || !isFinite(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class EpisodeDetail {
  /**
   * @param {HTMLElement} containerEl — the #episode-detail element
   * @param {object} callbacks — { onPlay(episodeId), onArtistClick(artistName) }
   */
  constructor(containerEl, callbacks) {
    this._el = containerEl;
    this._onPlay = callbacks.onPlay;
    this._onArtistClick = callbacks.onArtistClick;
    this._currentEpisode = null;
  }

  get episodeId() {
    return this._currentEpisode?.id ?? null;
  }

  /** Show episode detail. Pass null to show empty state. */
  async show(episode) {
    this._currentEpisode = episode;
    this._el.replaceChildren();

    if (!episode) {
      this._renderEmpty();
      return;
    }

    this._renderDetail(episode);
    await this._renderTracklist(episode.id);
  }

  clear() {
    this._currentEpisode = null;
    this._el.replaceChildren();
    this._renderEmpty();
  }

  _renderEmpty() {
    const div = document.createElement('div');
    div.className = 'detail-empty';
    div.textContent = 'Select an episode to view its tracklist';
    this._el.appendChild(div);
  }

  _renderDetail(ep) {
    // Header: art + info
    const header = document.createElement('div');
    header.className = 'detail-header';

    const art = document.createElement('div');
    art.className = 'detail-art';
    if (ep.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = ep.thumbnailUrl;
      img.alt = `MRR Radio #${ep.id}`;
      img.onerror = () => { img.remove(); art.appendChild(this._buildPlaceholder(ep.id)); };
      art.appendChild(img);
    } else {
      art.appendChild(this._buildPlaceholder(ep.id));
    }
    header.appendChild(art);

    const info = document.createElement('div');
    info.className = 'detail-info';

    const title = document.createElement('div');
    title.className = 'detail-title';
    title.textContent = `MRR RADIO #${ep.id}`;
    info.appendChild(title);

    if (ep.host) {
      const host = document.createElement('div');
      host.className = 'detail-host';
      host.textContent = ep.host;
      info.appendChild(host);
    }

    if (ep.date) {
      const date = document.createElement('div');
      date.className = 'detail-date';
      const d = new Date(ep.date + 'T12:00:00Z');
      date.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      info.appendChild(date);
    }

    header.appendChild(info);
    this._el.appendChild(header);

    if (ep.caption) {
      const caption = document.createElement('div');
      caption.className = 'detail-caption';
      caption.textContent = ep.caption;
      this._el.appendChild(caption);
    }

    // Play button
    const playBtn = document.createElement('button');
    playBtn.className = 'detail-play-btn';
    playBtn.textContent = 'Play Episode';
    playBtn.addEventListener('click', () => this._onPlay(ep.id));
    this._el.appendChild(playBtn);
  }

  async _renderTracklist(episodeId) {
    const tracks = await getTracks(episodeId);
    if (tracks.length === 0) return;

    const section = document.createElement('div');
    section.className = 'detail-tracklist';

    const hdr = document.createElement('div');
    hdr.className = 'tracklist-header';
    hdr.textContent = 'TRACKLIST';
    section.appendChild(hdr);

    let lastSection = null;
    for (const track of tracks) {
      if (track.section && track.section !== lastSection) {
        lastSection = track.section;
        const sh = document.createElement('div');
        sh.className = 'track-section-header';
        sh.textContent = track.section;
        section.appendChild(sh);
      }

      const item = document.createElement('div');
      item.className = 'track-item';

      if (track.startTime !== undefined && track.startTime !== null) {
        const ts = document.createElement('span');
        ts.className = 'track-timestamp';
        ts.textContent = fmtTime(track.startTime);
        item.appendChild(ts);
      }

      const artistEl = document.createElement('span');
      artistEl.className = 'track-artist';
      artistEl.textContent = track.artist;
      artistEl.setAttribute('role', 'button');
      artistEl.setAttribute('tabindex', '0');
      artistEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._onArtistClick(track.artist);
      });

      const sep = document.createTextNode(' \u2013 ');
      const titleEl = document.createElement('span');
      titleEl.className = 'track-title';
      titleEl.textContent = track.title;

      item.appendChild(artistEl);
      item.appendChild(sep);
      item.appendChild(titleEl);
      section.appendChild(item);
    }

    this._el.appendChild(section);
  }

  _buildPlaceholder(id) {
    const div = document.createElement('div');
    div.className = 'detail-art-placeholder';
    const strong = document.createElement('strong');
    strong.textContent = `#${id}`;
    div.appendChild(strong);
    return div;
  }
}
```

**Step 2: Commit**

```bash
git add js/ui/episode-detail.js
git commit -m "feat: add EpisodeDetail component for browse-mode episode view"
```

---

### Task 2: Add NavStack module for mobile navigation

Manages a stack of screens on mobile. Each entry has a type and optional data. Provides push, back, home, and a callback when the stack changes.

**Files:**
- Create: `js/ui/nav-stack.js`

**Step 1: Create NavStack class**

```js
/**
 * nav-stack.js — Mobile navigation stack
 *
 * Manages a stack of screen states for mobile single-column navigation.
 * Desktop doesn't use this — the left panel replaces content in-place.
 */

export class NavStack {
  /**
   * @param {function} onChange — (currentEntry, stackDepth) => void
   */
  constructor(onChange) {
    this._stack = [{ type: 'episode-list' }];
    this._onChange = onChange;
  }

  get current() {
    return this._stack[this._stack.length - 1];
  }

  get depth() {
    return this._stack.length;
  }

  push(entry) {
    this._stack.push(entry);
    this._emit();
  }

  back() {
    if (this._stack.length <= 1) return;
    this._stack.pop();
    this._emit();
  }

  home() {
    if (this._stack.length <= 1) return;
    this._stack = [this._stack[0]];
    this._emit();
  }

  _emit() {
    this._onChange(this.current, this.depth);
  }
}
```

**Step 2: Commit**

```bash
git add js/ui/nav-stack.js
git commit -m "feat: add NavStack module for mobile screen navigation"
```

---

### Task 3: Restructure HTML for two-column layout

Wrap the existing content in a grid container. Add the right-column episode detail panel. Move filters inside the left column. Add mobile nav buttons to the header.

**Files:**
- Modify: `index.html`

**Step 1: Update index.html**

Key structural changes:
- Add `#app-layout` grid wrapper inside `#app-main`
- Left column: `#left-column` containing `#filter-bar`, `#episode-list`, `#artist-index-overlay`, `#artist-view`
- Right column: `#right-column` containing `#episode-detail`, mini player (repositioned on desktop via CSS)
- Add back/home buttons to header (hidden by default, shown via nav-stack on mobile)
- Move `#filter-bar` from fixed positioning into the left column flow

Replace the `<main>` and content sections with:

```html
  <!-- Mobile nav buttons (hidden on desktop and at root level) -->
  <!-- Add to #app-header, before .header-right -->
  <div id="nav-buttons" class="nav-buttons" hidden>
    <button id="nav-back-btn" class="back-btn" aria-label="Back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>
    <button id="nav-home-btn" class="back-btn" aria-label="Home" hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"></path>
      </svg>
    </button>
  </div>

  <!-- Main layout wrapper -->
  <main id="app-main">
    <div id="app-layout">

      <!-- Left column: lists & search -->
      <div id="left-column">
        <!-- Filter bar moves here (no longer position:fixed on desktop) -->
        <div id="filter-bar"> ... (existing filter bar content) ... </div>

        <div id="loading-view" class="status-view"> ... </div>
        <div id="empty-view" class="status-view" hidden> ... </div>
        <div id="episode-list" hidden></div>
      </div>

      <!-- Right column: episode detail -->
      <div id="right-column">
        <div id="episode-detail"></div>
      </div>

    </div>
  </main>
```

The artist index overlay, artist view side panel, mini player, player sheet, and backdrop remain outside the grid (they're overlays/fixed elements).

**Step 2: Update app.js import**

Add `EpisodeDetail` import and wire it up (detailed in Task 5).

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: restructure HTML with two-column layout grid"
```

---

### Task 4: CSS layout — desktop grid and mobile stack

The biggest CSS task. Add the two-column grid for desktop, reposition elements for mobile nav stack, and style the new episode detail component.

**Files:**
- Modify: `app.css`

**Step 1: Add desktop grid layout**

Add at the end of the Main Content section:

```css
/* ─── Two-Column Layout ────────────────────────────────────────────────── */
#app-layout {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

#left-column {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
}

#right-column {
  display: none; /* hidden on mobile by default */
}

@media (min-width: 768px) {
  #app-layout {
    flex-direction: row;
    height: calc(100vh - var(--header-h) - env(safe-area-inset-top, 0px));
  }

  #left-column {
    width: 350px;
    min-width: 350px;
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }

  #right-column {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    position: relative;
  }

  /* Filter bar: static inside left column on desktop */
  #filter-bar {
    position: sticky;
    top: 0;
    left: auto;
    right: auto;
    z-index: 10;
  }

  /* Main content: no extra padding on desktop (grid handles it) */
  #app-main {
    padding-top: calc(var(--header-h) + env(safe-area-inset-top, 0px));
    padding-bottom: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Mini player: positioned at bottom of right column */
  .mini-player {
    position: absolute;
    bottom: 0;
    left: 350px; /* offset by left column width */
    right: 0;
  }

  /* Episode list padding to account for mini player */
  #right-column {
    padding-bottom: calc(var(--player-h) + var(--safe-bottom) + 16px);
  }

  /* Player drawer: overlays right column only */
  .player-sheet {
    left: 350px;
  }
  .sheet-backdrop {
    left: 350px;
  }

  /* Artist view and artist index: overlay left column only */
  .side-panel {
    width: 350px;
    z-index: 95; /* above filter bar, below player */
  }

  #artist-index-overlay {
    left: 0;
    right: auto;
    width: 350px;
  }

  /* Hide mobile nav buttons on desktop */
  .nav-buttons { display: none !important; }
}
```

**Step 2: Add episode detail styles**

```css
/* ─── Episode Detail (Right Column) ────────────────────────────────────── */
.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 40px;
}

.detail-header {
  display: flex;
  gap: 16px;
  padding: 24px 20px 16px;
  align-items: flex-start;
}

.detail-art {
  width: 120px;
  height: 120px;
  background: var(--surface);
  border: 1px solid var(--border);
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.detail-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detail-art-placeholder {
  font-size: 13px;
  font-weight: 700;
  color: var(--muted);
  text-align: center;
}
.detail-art-placeholder strong {
  display: block;
  font-size: 28px;
  color: var(--text);
}

.detail-info {
  flex: 1;
  min-width: 0;
}
.detail-title {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.03em;
  margin-bottom: 4px;
}
.detail-host {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 2px;
}
.detail-date {
  font-size: 12px;
  color: var(--muted);
}

.detail-caption {
  padding: 0 20px 16px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

.detail-play-btn {
  display: block;
  margin: 0 20px 20px;
  padding: 12px 24px;
  background: var(--text);
  color: var(--bg);
  font-size: 14px;
  font-weight: 700;
  border-radius: 6px;
  cursor: pointer;
  text-align: center;
  transition: opacity 0.15s;
}
.detail-play-btn:active {
  opacity: 0.8;
}

.detail-tracklist {
  border-top: 1px solid var(--border);
}
```

**Step 3: Add mobile nav styles**

```css
/* ─── Mobile Navigation ────────────────────────────────────────────────── */
.nav-buttons {
  display: flex;
  align-items: center;
  gap: 0;
}

/* Mobile screen transitions */
@media (max-width: 767px) {
  /* When viewing episode detail on mobile, hide left column and show right */
  body.mobile-detail #left-column,
  body.mobile-detail #filter-bar { display: none; }
  body.mobile-detail #right-column { display: block; }

  /* When viewing artist view on mobile */
  .side-panel {
    /* keep existing styles — full screen slide-in */
  }

  /* Header title changes handled by JS */
  #nav-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
}
```

**Step 4: Commit**

```bash
git add app.css
git commit -m "feat: add CSS for two-column desktop grid and mobile nav"
```

---

### Task 5: Wire everything together in app.js

The biggest JS change. Restructure app.js to:
- Episode card click → show detail (not play)
- EpisodeDetail "Play" button → start playback
- NavStack manages mobile screens
- Artist click from detail tracklist → push artist view onto nav stack
- Header updates for mobile nav (back/home buttons, title)

**Files:**
- Modify: `js/app.js`

**Step 1: Update imports**

```js
import { EpisodeDetail } from './ui/episode-detail.js';
import { NavStack } from './ui/nav-stack.js';
```

**Step 2: Add DOM refs for new elements**

```js
const appLayout     = document.getElementById('app-layout');
const leftColumn    = document.getElementById('left-column');
const rightColumn   = document.getElementById('right-column');
const detailEl      = document.getElementById('episode-detail');
const navBackBtn    = document.getElementById('nav-back-btn');
const navHomeBtn    = document.getElementById('nav-home-btn');
const navButtonsEl  = document.getElementById('nav-buttons');
const appTitle      = document.querySelector('.app-title');
```

**Step 3: Initialize EpisodeDetail**

```js
const episodeDetail = new EpisodeDetail(detailEl, {
  onPlay: handlePlayClick,
  onArtistClick: handleArtistClick,
});
episodeDetail.clear(); // show empty state initially
```

**Step 4: Change handleEpisodeClick to browse (not play)**

```js
async function handleEpisodeClick(episodeId) {
  const episode = state.allEpisodes.find((e) => e.id === episodeId)
    || await getEpisode(episodeId);
  if (!episode) return;

  state.selectedEpisodeId = episodeId;
  setActiveCard(episodeList, episodeId);
  await episodeDetail.show(episode);

  // On mobile, push to nav stack
  if (window.innerWidth < 768) {
    navStack.push({ type: 'episode-detail', episodeId, title: `#${episodeId}` });
  }
}
```

**Step 5: Add handlePlayClick (new — starts playback)**

```js
async function handlePlayClick(episodeId) {
  const episode = state.allEpisodes.find((e) => e.id === episodeId)
    || await getEpisode(episodeId);
  if (!episode) return;

  state.currentEpisodeId = episodeId;
  playerUI.setEpisode(episode);
  await player.play(episode);
}
```

**Step 6: Initialize NavStack for mobile**

```js
const isMobile = () => window.innerWidth < 768;

const navStack = new NavStack((entry, depth) => {
  if (!isMobile()) return; // desktop ignores nav stack

  // Update header
  if (depth <= 1) {
    // Root — show app title, hide nav buttons
    navButtonsEl.hidden = true;
    appTitle.textContent = 'MRR RADIO';
    appTitle.hidden = false;
    document.body.classList.remove('mobile-detail');
  } else {
    // Deeper — show back, maybe home
    navButtonsEl.hidden = false;
    navBackBtn.hidden = false;
    navHomeBtn.hidden = depth <= 2;
    appTitle.hidden = true;

    if (entry.type === 'episode-detail') {
      document.body.classList.add('mobile-detail');
    } else {
      document.body.classList.remove('mobile-detail');
    }
  }
});

navBackBtn.addEventListener('click', () => navStack.back());
navHomeBtn.addEventListener('click', () => navStack.home());
```

**Step 7: Update handleArtistClick for nav stack**

```js
function handleArtistClick(artistName) {
  playerUI.closeSheet();
  artistView.open(artistName);

  if (isMobile()) {
    navStack.push({ type: 'artist-view', artist: artistName, title: artistName });
  }
}
```

**Step 8: Update artist view episode click to push detail**

The artist view's `onEpisodeClick` callback should also go through `handleEpisodeClick` (which now browses, not plays).

**Step 9: Commit**

```bash
git add js/app.js
git commit -m "feat: wire two-column layout, nav stack, and browse-then-play flow"
```

---

### Task 6: Update ArtistView for left-column behavior on desktop

On desktop, the artist view should overlay the left column (350px wide) instead of being full-screen. The CSS in Task 4 handles width, but we need to make sure the artist view's episode click goes through the detail panel.

**Files:**
- Modify: `js/ui/artist-view.js`

**Step 1: Update constructor to accept the new callback pattern**

The `onEpisodeClick` callback already goes through `handleEpisodeClick` in app.js, which now browses instead of playing. No change needed in artist-view.js itself — the behavior change is in the callback.

**Step 2: Ensure back button on mobile pops nav stack**

Add a callback for the back button so app.js can hook into it:

```js
// In constructor, change:
this._backBtn.addEventListener('click', () => this.close());
// To:
this._backBtn.addEventListener('click', () => {
  this.close();
  if (this._onBack) this._onBack();
});

// Add to constructor params:
constructor(onEpisodeClick, playedSet, onBack) {
  this._onBack = onBack;
  // ... rest unchanged
}
```

**Step 3: Commit**

```bash
git add js/ui/artist-view.js
git commit -m "feat: update ArtistView with back callback for nav stack"
```

---

### Task 7: Test and polish

Manual testing checklist — verify each on both a narrow (<768px) and wide (>=768px) viewport:

1. **Desktop: initial load** — left column shows episode list, right column shows empty state
2. **Desktop: click episode** — right column shows detail with play button and tracklist
3. **Desktop: click Play** — playback starts, mini player appears at bottom of right column
4. **Desktop: browse other episode while playing** — right column changes, mini player persists
5. **Desktop: click mini player** — player drawer slides up over right column
6. **Desktop: click artist in tracklist** — left column shows artist's episodes
7. **Desktop: click episode from artist list** — right column shows that episode's detail
8. **Mobile: initial load** — full-screen episode list
9. **Mobile: tap episode** — pushes to full-screen detail view, back button in header
10. **Mobile: tap Play** — playback starts, mini player at bottom
11. **Mobile: back button** — returns to episode list
12. **Mobile: deep navigation** — artist → episode → artist → episode, back works, home works
13. **Mobile: tap mini player** — player drawer slides up full screen
14. **Player drawer: close** — returns to wherever you were (not affected by browse state)

**Files:**
- Modify: `app.css` (any polish tweaks)
- Modify: `js/app.js` (any wiring fixes)

**Step 1: Test each item above**

**Step 2: Fix any issues found**

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: polish responsive layout after testing"
```

---

### Task 8: Deploy

**Step 1: Push to GitHub**

```bash
git push origin main
```

**Step 2: Deploy to Netlify**

```bash
npx netlify deploy --prod
```

**Step 3: Test on actual mobile device and desktop browser**
