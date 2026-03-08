# Player Visibility + Artist Track Names Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the mini player visible over the artist side panel during playback, hide it when the keyboard is up, and show track titles for each episode in the artist view.

**Architecture:** Feature 1 uses a `has-player` body class (set in `PlayerUI.setEpisode`) plus a `visualViewport` resize listener for keyboard detection — pure CSS toggles do the work. Feature 2 adds `getTracksByArtist()` to `db.js`, passes an optional `tracksByEpisode` map through `renderList` → `buildCard`, and wires the data fetch into `ArtistView.open()`.

**Tech Stack:** Vanilla JS ESM, IndexedDB (existing `db.js`), no build step.

---

### Task 1: Mini player visibility — body classes + CSS

**Files:**
- Modify: `js/ui/player-ui.js`
- Modify: `js/app.js`
- Modify: `app.css`

**Step 1: Add `has-player` class in `PlayerUI.setEpisode` (player-ui.js line 80)**

```js
setEpisode(episode) {
  this._currentEpisode = episode;
  document.body.classList.add('has-player');
  this._updateMiniInfo(episode);
  this._updateSheetInfo(episode);
  this._loadTracklist(episode.id);
}
```

**Step 2: Add `visualViewport` keyboard listener in `app.js` (after DOM refs block, around line 90)**

Add after the `searchInput` event listeners block:

```js
// Hide mini player when soft keyboard is visible
if ('visualViewport' in window) {
  window.visualViewport.addEventListener('resize', () => {
    const keyboardUp = window.visualViewport.height < window.innerHeight - 150;
    document.body.classList.toggle('keyboard-open', keyboardUp);
  });
}
```

**Step 3: Add CSS rules to `app.css` (append after artist index styles)**

```css
/* ── Player visibility ──────────────────────────────────────────────────── */
/* Shrink side panel to expose mini player when an episode is loaded */
body.has-player .side-panel {
  height: calc(100% - var(--player-h) - var(--safe-bottom));
}

/* Hide mini player when soft keyboard is up */
body.keyboard-open .mini-player {
  display: none;
}
```

**Step 4: Commit**
```bash
git add js/ui/player-ui.js js/app.js app.css
git commit -m "feat: keep mini player visible over artist panel; hide when keyboard open"
```

---

### Task 2: Add `getTracksByArtist()` to db.js

**Files:**
- Modify: `js/db.js`

**Step 1: Add export after `getEpisodesByArtist` (after line 263)**

```js
/**
 * Get all tracks by a specific artist, across all episodes.
 * Returns [{ episodeId, title }]
 */
export function getTracksByArtist(artistName) {
  const normalized = artistName.toUpperCase().trim();
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readonly');
    const req = tx.objectStore('tracks').index('artist').getAll(normalized);
    req.onsuccess = () => {
      resolve((req.result || []).map((t) => ({ episodeId: t.episodeId, title: t.title })));
    };
    req.onerror = () => reject(req.error);
  }));
}
```

**Step 2: Commit**
```bash
git add js/db.js
git commit -m "feat: add getTracksByArtist() to db.js"
```

---

### Task 3: Show track names in ArtistView episode cards

**Files:**
- Modify: `js/ui/episode-list.js`
- Modify: `js/ui/artist-view.js`
- Modify: `app.css`

**Step 1: Add optional `tracks` param to `buildCard` in `episode-list.js`**

Change signature and add track row at the end of the body (before `card.appendChild(body)`):

```js
export function buildCard(ep, isPlayed, onClick, tracks) {
```

After the caption block (after line 87, before `card.appendChild(body)`):

```js
  if (tracks && tracks.length > 0) {
    const tracksEl = document.createElement('div');
    tracksEl.className = 'ep-artist-tracks';
    tracksEl.textContent = tracks.join(' · ');
    body.appendChild(tracksEl);
  }
```

**Step 2: Thread `tracksByEpisode` through `renderList` in `episode-list.js`**

Change `renderList` signature and pass tracks to `buildCard`:

```js
export function renderList(container, episodes, playedSet, onEpisodeClick, tracksByEpisode) {
  const frag = document.createDocumentFragment();
  for (const ep of episodes) {
    frag.appendChild(buildCard(ep, playedSet.has(ep.id), onEpisodeClick, tracksByEpisode?.get(ep.id)));
  }
  container.replaceChildren(frag);
}
```

**Step 3: Update `ArtistView.open()` in `artist-view.js`**

Update import at top:
```js
import { getEpisodesByArtist, getEpisodes, getTracksByArtist } from '../db.js';
```

Replace the `open()` method body:
```js
async open(artistName) {
  this._nameEl.textContent = artistName;
  this._listEl.replaceChildren();

  this._panel.classList.add('open');
  this._panel.setAttribute('aria-hidden', 'false');

  const [episodeIds, allTracks] = await Promise.all([
    getEpisodesByArtist(artistName),
    getTracksByArtist(artistName),
  ]);

  // Build map: episodeId → [title, ...]
  const tracksByEpisode = new Map();
  for (const { episodeId, title } of allTracks) {
    if (!tracksByEpisode.has(episodeId)) tracksByEpisode.set(episodeId, []);
    tracksByEpisode.get(episodeId).push(title);
  }

  const episodes = episodeIds.length ? await getEpisodes({ episodeIds }) : [];

  if (episodes.length === 0) {
    const msg = document.createElement('p');
    msg.style.cssText = 'padding:24px 16px;color:var(--muted);font-size:14px;';
    msg.textContent = 'No episodes found.';
    this._listEl.appendChild(msg);
  } else {
    renderList(this._listEl, episodes, this._playedSet, (id) => {
      this._onEpisodeClick(id);
    }, tracksByEpisode);
  }
}
```

**Step 4: Add CSS for track names in `app.css` (append after player visibility styles)**

```css
/* Track names in artist episode cards */
.ep-artist-tracks {
  font-size: 12px;
  color: var(--accent);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

**Step 5: Commit and push**
```bash
git add js/ui/episode-list.js js/ui/artist-view.js app.css
git commit -m "feat: show artist track names on episode cards in artist view"
git push
```

---

### Verification checklist
- Load an episode → mini player appears at bottom
- Open artist view → mini player still visible at bottom of panel
- Tap search bar (keyboard opens) → mini player disappears
- Dismiss keyboard → mini player reappears
- Tap an artist → artist view opens showing their episodes
- Each episode card shows track title(s) in accent color below the caption
- An artist with 2 tracks on one episode shows both titles separated by ` · `
